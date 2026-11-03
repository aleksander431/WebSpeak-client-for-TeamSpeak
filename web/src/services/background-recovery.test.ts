import assert from "node:assert/strict";
import test from "node:test";
import { BACKGROUND_RECOVERY_DELAYS_MS, createBackgroundRecovery, type BackgroundRecoveryVisibility } from "./background-recovery.js";

class TestVisibility extends EventTarget implements BackgroundRecoveryVisibility {
  visibilityState = "visible";
  set(state: string): void {
    this.visibilityState = state;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

function harness({ phone = true } = {}) {
  const visibility = new TestVisibility();
  const page = new EventTarget();
  const timers: { callback: () => void; ms: number; cleared: boolean }[] = [];
  const state = { phone, connected: false, resumes: 0, wakes: 0, canResume: true };
  const recovery = createBackgroundRecovery(visibility, page, {
    enabled: () => state.phone,
    canResume: () => state.canResume && !state.connected,
    resume: () => { state.resumes += 1; },
    wakeAudio: () => { state.wakes += 1; },
  }, {
    setTimeout(callback, ms) { const timer = { callback, ms, cleared: false }; timers.push(timer); return timer; },
    clearTimeout(handle) { (handle as { cleared: boolean }).cleared = true; },
  });
  const fire = () => { const timer = timers.filter(item => !item.cleared).at(-1); assert.ok(timer); timer.cleared = true; timer.callback(); };
  return { visibility, page, timers, state, recovery, fire };
}

test("a drop in the background rejoins when the page returns, and wakes audio", () => {
  const { visibility, state, recovery, timers } = harness();
  visibility.set("hidden");
  recovery.dropped();
  assert.equal(state.resumes, 0);
  assert.equal(timers.length, 0);
  visibility.set("visible");
  assert.equal(state.wakes, 1);
  assert.equal(state.resumes, 1);
  recovery.dispose();
});

test("a visible drop retries on a bounded schedule", () => {
  const { state, recovery, timers, fire } = harness();
  for (let index = 0; index < BACKGROUND_RECOVERY_DELAYS_MS.length; index++) {
    recovery.dropped();
    assert.equal(timers.at(-1)?.ms, BACKGROUND_RECOVERY_DELAYS_MS[index]);
    fire();
    assert.equal(state.resumes, index + 1);
  }
  recovery.dropped();
  assert.equal(timers.filter(timer => !timer.cleared).length, 0, "no fourth automatic attempt");
  recovery.dispose();
});

test("success, leaving and desktop never rejoin", () => {
  const leaving = harness();
  leaving.visibility.set("hidden");
  leaving.recovery.dropped();
  leaving.recovery.cancel();
  leaving.visibility.set("visible");
  assert.equal(leaving.state.resumes, 0);
  assert.equal(leaving.state.wakes, 1, "audio still wakes");

  const desktop = harness({ phone: false });
  desktop.visibility.set("hidden");
  desktop.recovery.dropped();
  desktop.visibility.set("visible");
  assert.equal(desktop.state.resumes, 0);

  const back = harness();
  back.visibility.set("hidden");
  back.recovery.dropped();
  back.state.canResume = false;
  back.visibility.set("visible");
  assert.equal(back.state.resumes, 0);
});

test("coming online retries while visible", () => {
  const { page, state, recovery } = harness();
  recovery.dropped();
  page.dispatchEvent(new Event("online"));
  assert.equal(state.resumes, 1);
  recovery.connected();
  page.dispatchEvent(new Event("online"));
  assert.equal(state.resumes, 1);
  recovery.dispose();
});
