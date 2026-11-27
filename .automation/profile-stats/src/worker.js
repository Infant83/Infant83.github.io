const ORIGIN = "https://infant83.io";
const PATH = "/v1/profile";
const MAX_BYTES = 1024;
const DAILY_BROWSER_LIMIT = 300;
const DAY = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LANGUAGE = new Set(["en", "ko"]);
let hashKey, hashKeySource;

class ApiError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

export function periodWindow(now = Date.now()) {
  const local = new Date(now + 9 * 60 * 60 * 1000);
  const end = local.toISOString().slice(0, 10);
  local.setUTCDate(local.getUTCDate() - 29);
  return { start: local.toISOString().slice(0, 10), end };
}

function statement(env, sql, ...values) { return env.DB.prepare(sql).bind(...values); }

function json(value, status = 200, cache = "private, no-store") {
  return Response.json(value, { status, headers: {
    "Access-Control-Allow-Origin": ORIGIN,
    "Vary": "Origin",
    "Cache-Control": cache,
    "X-Content-Type-Options": "nosniff"
  } });
}

async function boundedBody(request) {
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BYTES) throw new ApiError("body_too_large", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("invalid_json", 400);
  const chunks = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BYTES) {
      await reader.cancel();
      throw new ApiError("body_too_large", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

async function digest(env, value) {
  if (typeof env.VISITOR_HASH_KEY !== "string" || env.VISITOR_HASH_KEY.length < 32) {
    throw new ApiError("stats_unavailable", 503);
  }
  if (!hashKey || hashKeySource !== env.VISITOR_HASH_KEY) {
    hashKeySource = env.VISITOR_HASH_KEY;
    hashKey = crypto.subtle.importKey("raw", new TextEncoder().encode(hashKeySource),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  }
  const bytes = await crypto.subtle.sign("HMAC", await hashKey, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function validateEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some(key => !["type", "visitorId", "eventId", "page", "cvLanguage"].includes(key))
      || !["pageview", "cv_download"].includes(value.type)
      || typeof value.visitorId !== "string" || !UUID.test(value.visitorId)
      || typeof value.eventId !== "string" || !UUID.test(value.eventId)
      || !LANGUAGE.has(value.page)
      || (value.type === "cv_download" && !LANGUAGE.has(value.cvLanguage))
      || (value.type === "pageview" && Object.hasOwn(value, "cvLanguage"))) {
    throw new ApiError("invalid_event", 400);
  }
  return { ...value, visitorId: value.visitorId.toLowerCase(), eventId: value.eventId.toLowerCase() };
}

export async function summary(env, now = Date.now()) {
  const { start, end } = periodWindow(now);
  // One batch keeps the totals and the period-wide DISTINCT browser count on
  // the same database snapshot. Summing daily uniques would overcount readers.
  const results = await env.DB.batch([
    statement(env, "SELECT started_at FROM profile_meta WHERE id=1"),
    statement(env, "SELECT COALESCE(SUM(pageviews),0) AS pageviews, COALESCE(SUM(cv_downloads),0) AS cv_downloads FROM profile_daily WHERE day>=? AND day<=?", start, end),
    statement(env, "SELECT COUNT(DISTINCT visitor_hash) AS visitors FROM profile_visitor_days WHERE day>=? AND day<=?", start, end)
  ]);
  const started = results[0].results[0]?.started_at;
  const counts = results[1].results[0];
  const visitors = results[2].results[0]?.visitors;
  if (typeof started !== "string" || !Number.isFinite(Date.parse(started))
      || [counts?.pageviews, counts?.cv_downloads, visitors].some(number => !Number.isSafeInteger(number) || number < 0)) {
    throw new ApiError("stats_unavailable", 503);
  }
  return { ok: true, periodDays: 30, since: started, startedAt: started,
    periodStart: start, periodEnd: end, timezone: "Asia/Seoul",
    visitors, pageviews: counts.pageviews, cvDownloads: counts.cv_downloads };
}

export async function recordEvent(env, input, now = Date.now()) {
  const event = validateEvent(input);
  const visitor = await digest(env, "profile-visitor:" + event.visitorId);
  const identifier = await digest(env, "profile-event:" + event.visitorId + ":" + event.eventId);
  const day = periodWindow(now).end;
  const results = await env.DB.batch([
    // A new event is admitted only below this browser's daily bound. A retry
    // reuses the existing event, so it neither consumes quota nor adds counts.
    statement(env, `INSERT OR IGNORE INTO profile_events(event_hash,visitor_hash,day,kind,created_at)
      SELECT ?,?,?,?,? WHERE COALESCE((SELECT event_count FROM profile_visitor_days WHERE day=? AND visitor_hash=?),0)<?`,
      identifier, visitor, day, event.type, now, day, visitor, DAILY_BROWSER_LIMIT),
    statement(env, `INSERT INTO profile_visitor_days(day,visitor_hash,event_count)
      SELECT day,visitor_hash,1 FROM profile_events WHERE event_hash=? AND processed=0
      ON CONFLICT(day,visitor_hash) DO UPDATE SET event_count=event_count+1`, identifier),
    statement(env, `INSERT INTO profile_daily(day,pageviews,cv_downloads)
      SELECT day,CASE WHEN kind='pageview' THEN 1 ELSE 0 END,CASE WHEN kind='cv_download' THEN 1 ELSE 0 END
      FROM profile_events WHERE event_hash=? AND processed=0
      ON CONFLICT(day) DO UPDATE SET pageviews=pageviews+excluded.pageviews,cv_downloads=cv_downloads+excluded.cv_downloads`, identifier),
    statement(env, "UPDATE profile_events SET processed=1 WHERE event_hash=? AND processed=0", identifier),
    statement(env, "SELECT processed,kind FROM profile_events WHERE event_hash=?", identifier)
  ]);
  if (results[4].results[0]?.processed !== 1) throw new ApiError("browser_daily_limit", 429);
  if (results[4].results[0].kind !== event.type) throw new ApiError("event_conflict", 409);
  return summary(env, now);
}

export async function cleanup(env, now = Date.now()) {
  const oldestDay = new Date(now + 9 * 60 * 60 * 1000 - 35 * DAY).toISOString().slice(0, 10);
  await env.DB.batch([
    statement(env, "DELETE FROM profile_events WHERE created_at<?", now - 7 * DAY),
    statement(env, "DELETE FROM profile_visitor_days WHERE day<?", oldestDay)
  ]);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const origin = request.headers.get("Origin");
      if (origin && origin !== ORIGIN) throw new ApiError("origin_not_allowed", 403);
      if (url.pathname !== PATH) throw new ApiError("not_found", 404);
      const params = [...url.searchParams];
      if (params.length > 1 || (params.length === 1 && (params[0][0] !== "periodDays" || params[0][1] !== "30"))) {
        throw new ApiError("invalid_period", 400);
      }
      if (request.method === "OPTIONS") {
        if (origin !== ORIGIN) throw new ApiError("origin_not_allowed", 403);
        return new Response(null, { status: 204, headers: {
          "Access-Control-Allow-Origin": ORIGIN, "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600", "Vary": "Origin"
        } });
      }
      if (request.method === "GET") return json(await summary(env), 200, "public, max-age=30");
      if (request.method !== "POST") throw new ApiError("method_not_allowed", 405);
      if (origin !== ORIGIN) throw new ApiError("origin_not_allowed", 403);
      if (request.headers.get("DNT") === "1" || request.headers.get("Sec-GPC") === "1") {
        return json(await summary(env));
      }
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("Content-Type") || "")) {
        throw new ApiError("json_required", 415);
      }
      const body = await boundedBody(request);
      let data;
      try { data = JSON.parse(body); } catch (_) { throw new ApiError("invalid_json", 400); }
      return json(await recordEvent(env, data));
    } catch (error) {
      return json({ ok: false, error: error instanceof ApiError ? error.code : "stats_unavailable" },
        error instanceof ApiError ? error.status : 503);
    }
  },
  async scheduled(_event, env, context) { context.waitUntil(cleanup(env)); }
};
