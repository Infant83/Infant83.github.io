import test from "node:test";
import assert from "node:assert/strict";
import { nextHeaderState, parseStats, trackingAllowed, cvLanguageForHref } from "../profile.js";

const start = () => nextHeaderState({}, 0, { reset: true });
test("header hides after leaving its original space and returns on a deliberate upward scroll", () => {
  let state = nextHeaderState(start(), 90);
  assert.equal(state.hidden, false);
  state = nextHeaderState(state, 180);
  assert.equal(state.hidden, true);
  state = nextHeaderState(state, 178);
  assert.equal(state.hidden, true);
  state = nextHeaderState(state, 172);
  assert.equal(state.hidden, false);
});
test("mobile header leaves no empty space before hiding; top, focus and restored pages reveal it", () => {
  let state = nextHeaderState(start(), 160, { height: 190 });
  assert.equal(state.hidden, false);
  state = nextHeaderState(state, 240, { height: 190 });
  assert.equal(state.hidden, true);
  assert.equal(nextHeaderState(state, 22).hidden, false);
  assert.equal(nextHeaderState(state, 260, { keyboardFocus: true }).hidden, false);
  const restored = nextHeaderState(state, 500, { reset: true });
  assert.equal(restored.hidden, false);
  assert.equal(nextHeaderState(restored, 500), restored);
});
test("scroll jitter does not flash the hidden menu", () => {
  let state = nextHeaderState(start(), 300);
  for (const y of [298, 300, 297, 299, 296]) {
    state = nextHeaderState(state, y);
    assert.equal(state.hidden, true);
  }
});
test("privacy signals skip collection", () => {
  assert.equal(trackingAllowed({}), true);
  assert.equal(trackingAllowed({ globalPrivacyControl: true }), false);
  assert.equal(trackingAllowed({ doNotTrack: "1" }), false);
  assert.equal(trackingAllowed({ doNotTrack: 1 }), false);
});
test("metrics accept true zero and reject malformed or misleading counters", () => {
  const payload = { ok: true, periodDays: 30, startedAt: "2026-11-27T22:00:00Z", visitors: 0, pageviews: 1, cvDownloads: 0 };
  assert.equal(parseStats(payload).visitors, 0);
  for (const invalid of [{ visitors: -1 }, { pageviews: "2" }, { cvDownloads: null }, { periodDays: 7 }, { startedAt: "invalid" }]) {
    assert.throws(() => parseStats({ ...payload, ...invalid }));
  }
});
test("CV clicks use existing PDF paths regardless of version query, without counting external links", () => {
  assert.equal(cvLanguageForHref("Hyun-Jung_Kim_CV.pdf?v=b2511afafbc9", "https://infant83.io"), "en");
  assert.equal(cvLanguageForHref("/Hyun-Jung_Kim_CV_Korean.pdf?v=26ffb2a8d0ad", "https://infant83.io"), "ko");
  assert.equal(cvLanguageForHref("https://example.org/Hyun-Jung_Kim_CV.pdf", "https://infant83.io"), null);
  assert.equal(cvLanguageForHref("https://infant83.io/AI_Tech_Review/", "https://infant83.io"), null);
});
