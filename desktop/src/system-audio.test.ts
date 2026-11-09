import { test } from "node:test";
import assert from "node:assert/strict";
import { windowHandleOf } from "./system-audio.js";

test("a window source names its handle; screens have none", () => {
  assert.equal(windowHandleOf("window:132456:0"), "132456");
  assert.equal(windowHandleOf("window:0:0"), null);
  assert.equal(windowHandleOf("screen:0:0"), null);
  assert.equal(windowHandleOf("window:abc:0"), null);
  assert.equal(windowHandleOf(""), null);
});
