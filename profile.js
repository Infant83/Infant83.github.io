const STATS_ENDPOINTS = [
  "https://stats.infant83.io/v1/profile",
  "https://infant83-profile-stats.infant83.workers.dev/v1/profile",
];
const VISITOR_KEY = "profile.anonymous-visitor.v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function nextHeaderState(previous, position, { height = 88, keyboardFocus = false, reset = false } = {}) {
  const y = Math.max(0, position);
  if (reset || keyboardFocus || y <= 24) {
    return { lastY: y, anchorY: y, direction: 0, hidden: false };
  }
  const delta = y - previous.lastY;
  if (!delta) return previous;
  const direction = Math.sign(delta);
  let anchorY = direction === previous.direction ? previous.anchorY : previous.lastY;
  const distance = Math.abs(y - anchorY);
  let hidden = previous.hidden;
  if (direction > 0 && y > Math.max(96, height + 24) && distance >= 14) hidden = true;
  if (direction < 0 && distance >= 8) hidden = false;
  if (hidden !== previous.hidden) anchorY = y;
  return { lastY: y, anchorY, direction, hidden };
}

export function trackingAllowed(navigatorValue) {
  return navigatorValue.globalPrivacyControl !== true && String(navigatorValue.doNotTrack) !== "1";
}

export function parseStats(payload) {
  if (payload?.ok !== true || payload.periodDays !== 30) throw new Error("Invalid statistics response");
  for (const key of ["visitors", "pageviews", "cvDownloads"]) {
    if (!Number.isSafeInteger(payload[key]) || payload[key] < 0) throw new Error("Invalid statistics count");
  }
  const startedAt = new Date(payload.startedAt || payload.since);
  if (!Number.isFinite(startedAt.getTime())) throw new Error("Invalid statistics start date");
  return { visitors: payload.visitors, pageviews: payload.pageviews, cvDownloads: payload.cvDownloads, startedAt };
}

export function cvLanguageForHref(href, origin) {
  try {
    const url = new URL(href, origin);
    if (url.origin !== origin) return null;
    if (url.pathname === "/Hyun-Jung_Kim_CV.pdf") return "en";
    if (url.pathname === "/Hyun-Jung_Kim_CV_Korean.pdf") return "ko";
  } catch { /* An invalid or non-HTTP link is not a CV event. */ }
  return null;
}

export function installHeader(documentValue, windowValue) {
  const header = documentValue.querySelector(".site-header");
  if (!header) return;
  let height = header.getBoundingClientRect().height;
  let keyboardModality = false;
  let scheduled = false;
  const position = () => Math.max(0, Math.min(windowValue.scrollY,
    Math.max(0, documentValue.documentElement.scrollHeight - windowValue.innerHeight)));
  let state = nextHeaderState({}, position(), { reset: true });
  const apply = (reset = false) => {
    state = nextHeaderState(state, position(), {
      height, reset,
      keyboardFocus: keyboardModality && header.contains(documentValue.activeElement),
    });
    header.classList.toggle("is-hidden", state.hidden);
  };
  const measure = () => {
    const nextHeight = header.getBoundingClientRect().height;
    documentValue.documentElement.style.setProperty("--site-header-height", `${nextHeight}px`);
    if (Math.abs(nextHeight - height) > 1) {
      height = nextHeight;
      apply(true);
    }
  };
  measure();
  windowValue.addEventListener("scroll", () => {
    if (scheduled) return;
    scheduled = true;
    windowValue.requestAnimationFrame(() => { scheduled = false; apply(); });
  }, { passive: true });
  documentValue.addEventListener("keydown", () => { keyboardModality = true; }, true);
  documentValue.addEventListener("pointerdown", () => { keyboardModality = false; }, true);
  header.addEventListener("focusin", () => apply(true));
  windowValue.addEventListener("hashchange", () => apply(true));
  windowValue.addEventListener("pageshow", () => apply(true));
  if (windowValue.ResizeObserver) new windowValue.ResizeObserver(measure).observe(header);
  else windowValue.addEventListener("resize", measure, { passive: true });
}

function randomId(cryptoValue) {
  if (cryptoValue?.randomUUID) return cryptoValue.randomUUID();
  if (!cryptoValue?.getRandomValues) return null;
  const bytes = cryptoValue.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function visitorId(windowValue) {
  try {
    const stored = windowValue.localStorage.getItem(VISITOR_KEY);
    if (UUID_PATTERN.test(stored || "")) return stored;
    const id = randomId(windowValue.crypto);
    if (!id) return null;
    windowValue.localStorage.setItem(VISITOR_KEY, id);
    return windowValue.localStorage.getItem(VISITOR_KEY) === id ? id : null;
  } catch { return null; }
}

export function installActivity(documentValue, windowValue) {
  const activity = documentValue.querySelector("[data-site-activity]");
  if (!activity) return;
  activity.hidden = false;
  const korean = documentValue.documentElement.lang === "ko";
  const note = activity.querySelector("[data-activity-note]");
  const labels = korean ? {
    period: "최근 30일", since: "집계 시작", failure: "통계를 잠시 불러올 수 없습니다.",
  } : {
    period: "Last 30 days", since: "Since", failure: "Statistics are temporarily unavailable.",
  };
  const locale = korean ? "ko-KR" : "en-US";
  const numberFormat = new Intl.NumberFormat(locale);
  const dateFormat = new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Seoul",
  });
  let rendered = false;
  let latestRequest = 0;
  let preferredEndpoint = 0;
  const render = payload => {
    const stats = parseStats(payload);
    for (const key of ["visitors", "pageviews", "cvDownloads"]) {
      activity.querySelector(`[data-activity-value="${key}"]`).textContent = numberFormat.format(stats[key]);
    }
    note.textContent = `${labels.period} · ${labels.since} ${dateFormat.format(stats.startedAt)}`;
    rendered = true;
  };
  const fetchPayload = async event => {
    // Both hostnames serve the same database. Reuse the exact event on a
    // transport retry so a lost response cannot double-count the visit.
    const body = event ? JSON.stringify(event) : null;
    const order = [preferredEndpoint, 1 - preferredEndpoint];
    for (const index of order) {
      const controller = new windowValue.AbortController();
      const timer = windowValue.setTimeout(() => controller.abort(), 5000);
      try {
        const response = await windowValue.fetch(STATS_ENDPOINTS[index], {
          method: event ? "POST" : "GET",
          mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store",
          signal: controller.signal,
          ...(event ? { headers: { "Content-Type": "application/json" }, body, keepalive: true } : {}),
        });
        if (!response.ok) throw Object.assign(new Error("Statistics request failed"), { apiResponse: true });
        const payload = await response.json();
        preferredEndpoint = index;
        return payload;
      } catch (error) {
        if (error.apiResponse || index === order[order.length - 1]) throw error;
      } finally {
        windowValue.clearTimeout(timer);
      }
    }
  };
  const request = async event => {
    const currentRequest = ++latestRequest;
    activity.setAttribute("aria-busy", "true");
    try {
      const payload = await fetchPayload(event);
      if (currentRequest === latestRequest) render(payload);
    } catch {
      if (event && currentRequest === latestRequest && !rendered) {
        await request();
      } else if (currentRequest === latestRequest && !rendered) {
        note.textContent = `${labels.period} · ${labels.failure}`;
      }
    } finally {
      if (currentRequest === latestRequest) activity.setAttribute("aria-busy", "false");
    }
  };
  const id = trackingAllowed(windowValue.navigator) ? visitorId(windowValue) : null;
  const eventFor = (type, cvLanguage) => {
    const eventId = randomId(windowValue.crypto);
    return id && eventId ? {
      type, visitorId: id, eventId, page: korean ? "ko" : "en",
      ...(cvLanguage ? { cvLanguage } : {}),
    } : null;
  };
  void request(eventFor("pageview"));
  const onClick = event => {
    if (!id || !trackingAllowed(windowValue.navigator) || event.defaultPrevented || (event.type === "click" ? event.button !== 0 : event.button !== 1)) return;
    const anchor = event.target?.closest?.("a[href]");
    if (!anchor) return;
    const language = cvLanguageForHref(anchor.href, windowValue.location.origin);
    if (language) void request(eventFor("cv_download", language));
  };
  documentValue.addEventListener("click", onClick);
  documentValue.addEventListener("auxclick", onClick);
  windowValue.addEventListener("pageshow", event => { if (event.persisted) void request(); });
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  const initialize = () => {
    installHeader(document, window);
    installActivity(document, window);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
}
