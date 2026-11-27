import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Miniflare } from "miniflare";
import { periodWindow, recordEvent, summary, cleanup } from "../src/worker.js";

const ORIGIN = "https://infant83.io";
const NOW = Date.parse("2026-11-28T01:00:00Z");
const KEY = "isolated-test-key-only-not-a-production-secret";
const migration = await readFile(new URL("../migrations/0001_profile_stats.sql", import.meta.url), "utf8");

async function fixture(t) {
  const mf = new Miniflare({ modules: true,
    scriptPath: fileURLToPath(new URL("../src/worker.js", import.meta.url)),
    compatibilityDate: "2026-08-06", d1Databases: ["DB"],
    bindings: { VISITOR_HASH_KEY: KEY } });
  t.after(() => mf.dispose());
  const DB = await mf.getD1Database("DB");
  for (const sql of migration.split(";").map(sql => sql.trim()).filter(Boolean)) await DB.prepare(sql).run();
  const env = { DB, VISITOR_HASH_KEY: KEY };
  return { DB, env, mf,
    request(body, options = {}) {
      return mf.dispatchFetch("https://stats.infant83.io" + (options.path || "/v1/profile"), {
        method: body === undefined ? "GET" : "POST",
        headers: { Origin: ORIGIN, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...options.headers },
        ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) })
      });
    } };
}

function event(visitorId = randomUUID(), extra = {}) {
  return { type: "pageview", visitorId, eventId: randomUUID(), page: "en", ...extra };
}

test("30 inclusive Korean dates handle KST midnight and month transitions", () => {
  assert.deepEqual(periodWindow(Date.parse("2026-11-27T14:59:59Z")), { start: "2026-10-29", end: "2026-11-27" });
  assert.deepEqual(periodWindow(Date.parse("2026-11-27T15:00:00Z")), { start: "2026-10-30", end: "2026-11-28" });
});

test("public summary starts at real initialization, sets CORS/cache and never a cookie", async t => {
  const f = await fixture(t);
  const r = await f.request(); const d = await r.json();
  assert.equal(r.status, 200); assert.equal(d.periodDays, 30);
  assert.equal(d.since, d.startedAt); assert.ok(Number.isFinite(Date.parse(d.startedAt)));
  assert.equal(d.visitors, 0); assert.equal(d.pageviews, 0); assert.equal(d.cvDownloads, 0);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(r.headers.get("Cache-Control"), "public, max-age=30");
  assert.equal(r.headers.get("Set-Cookie"), null);
});

test("same event retries and concurrent requests count once; Korean and English share one browser", async t => {
  const f = await fixture(t), visitor = randomUUID(), first = event(visitor);
  await Promise.all(Array.from({ length: 12 }, () => recordEvent(f.env, first, NOW)));
  await recordEvent(f.env, event(visitor, { page: "ko" }), NOW);
  const d = await recordEvent(f.env, event(visitor, { type: "cv_download", cvLanguage: "ko" }), NOW);
  assert.equal(d.visitors, 1); assert.equal(d.pageviews, 2); assert.equal(d.cvDownloads, 1);
  assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM profile_events").first()).n, 3);
});

test("period-wide distinct visitors are not sums of daily uniques and expired days are excluded", async t => {
  const f = await fixture(t), visitor = randomUUID();
  await recordEvent(f.env, event(visitor), NOW - 86_400_000);
  await recordEvent(f.env, event(visitor), NOW);
  await recordEvent(f.env, event(), NOW - 31 * 86_400_000);
  const d = await summary(f.env, NOW);
  assert.equal(d.visitors, 1); assert.equal(d.pageviews, 2);
});

test("Origin, exact endpoint, periods and input fields are constrained before collection", async t => {
  const f = await fixture(t), valid = event();
  assert.equal((await f.request(valid, { headers: { Origin: "https://other.example" } })).status, 403);
  assert.equal((await f.request(valid, { headers: { Origin: "null" } })).status, 403);
  assert.equal((await f.request(undefined, { path: "/v1/profile?periodDays=7" })).status, 400);
  assert.equal((await f.request(undefined, { path: "/v1/profile?periodDays=30&periodDays=30" })).status, 400);
  assert.equal((await f.request(valid, { path: "/v1/atr-metrics" })).status, 404);
  assert.equal((await f.request({ ...valid, referrer: "private-example" })).status, 400);
  assert.equal((await f.request({ ...valid, visitorId: "not-a-random-id" })).status, 400);
  assert.equal((await f.request({ ...valid, type: "cv_download" })).status, 400);
  assert.equal((await summary(f.env)).pageviews, 0);
});

test("DNT and GPC retain public summary access but omit POST collection", async t => {
  const f = await fixture(t);
  for (const headers of [{ DNT: "1" }, { "Sec-GPC": "1" }]) {
    const r = await f.request(event(), { headers });
    assert.equal(r.status, 200); assert.equal((await r.json()).pageviews, 0);
  }
  assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM profile_events").first()).n, 0);
});

test("body limits reject JSON and streaming oversized bodies without recording events", async t => {
  const f = await fixture(t);
  assert.equal((await f.request("{")).status, 400);
  assert.equal((await f.request("x".repeat(2048))).status, 413);
  assert.equal((await f.request(event(), { headers: { "Content-Type": "text/plain" } })).status, 415);
  assert.equal((await summary(f.env)).pageviews, 0);
});

test("browser daily cap rejects new events while existing retries remain idempotent", async t => {
  const f = await fixture(t), input = event();
  await recordEvent(f.env, input, NOW);
  await f.DB.prepare("UPDATE profile_visitor_days SET event_count=300").run();
  assert.equal((await recordEvent(f.env, input, NOW)).pageviews, 1);
  await assert.rejects(recordEvent(f.env, event(input.visitorId), NOW), error => error.code === "browser_daily_limit");
  assert.equal((await summary(f.env, NOW)).pageviews, 1);
});

test("the final daily slot is atomic across two different concurrent events", async t => {
  const f = await fixture(t), visitor = randomUUID();
  await recordEvent(f.env, event(visitor), NOW);
  await f.DB.prepare("UPDATE profile_visitor_days SET event_count=299").run();
  const results = await Promise.allSettled([recordEvent(f.env, event(visitor), NOW), recordEvent(f.env, event(visitor), NOW)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected" && result.reason.code === "browser_daily_limit").length, 1);
  assert.equal((await summary(f.env, NOW)).pageviews, 2);
});

test("a retry after KST midnight keeps the original event day and does not add a second visit", async t => {
  const f = await fixture(t), input = event();
  const before = Date.parse("2026-11-30T14:59:59Z");
  await recordEvent(f.env, input, before);
  const d = await recordEvent(f.env, input, before + 2000);
  assert.equal(d.periodEnd, "2026-12-01"); assert.equal(d.pageviews, 1); assert.equal(d.visitors, 1);
  assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM profile_visitor_days").first()).n, 1);
});

test("stored application rows contain keyed hashes, never raw browser/event IDs or request metadata", async t => {
  const f = await fixture(t), input = event();
  await recordEvent(f.env, input, NOW);
  const events = (await f.DB.prepare("SELECT * FROM profile_events").all()).results;
  const days = (await f.DB.prepare("SELECT * FROM profile_visitor_days").all()).results;
  const serialized = JSON.stringify([events, days]);
  assert.ok(!serialized.includes(input.visitorId)); assert.ok(!serialized.includes(input.eventId));
  assert.match(events[0].visitor_hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(events[0]).sort(), ["created_at", "day", "event_hash", "kind", "processed", "visitor_hash"]);
});

test("a failed aggregate write rolls the event and visitor changes back atomically", async t => {
  const f = await fixture(t);
  await f.DB.exec("CREATE TRIGGER fail_counter BEFORE INSERT ON profile_daily BEGIN SELECT RAISE(ABORT,'isolated failure'); END;");
  await assert.rejects(recordEvent(f.env, event(), NOW));
  assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM profile_events").first()).n, 0);
  assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM profile_visitor_days").first()).n, 0);
});

test("cleanup bounds hash retention while preserving the full rolling period and daily aggregates", async t => {
  const f = await fixture(t);
  await recordEvent(f.env, event(), NOW - 40 * 86_400_000);
  await recordEvent(f.env, event(), NOW - 29 * 86_400_000);
  await recordEvent(f.env, event(), NOW);
  const before = await summary(f.env, NOW); await cleanup(f.env, NOW);
  assert.deepEqual(await summary(f.env, NOW), before);
  assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM profile_events").first()).n, 1);
  assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM profile_visitor_days").first()).n, 2);
  assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM profile_daily").first()).n, 3);
});
