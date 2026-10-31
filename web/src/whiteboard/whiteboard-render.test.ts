import assert from "node:assert/strict";
import test from "node:test";
import { elementBounds, hitTest, scaleElement, translateElement } from "./whiteboard-render.js";
import type { WhiteboardElement } from "../../../src/shared/whiteboard.js";

const base = { z: 1, stroke: "#000000", strokeWidth: 2 } as const;

test("hit testing follows the drawn shape", () => {
  const line: WhiteboardElement = { ...base, id: "l", type: "line", x: 0, y: 0, w: 100, h: 0 };
  assert.ok(hitTest(line, 50, 3, 3));
  assert.ok(!hitTest(line, 50, 10, 3));
  const outline: WhiteboardElement = { ...base, id: "r", type: "rect", x: 0, y: 0, w: 100, h: 50, fill: null };
  assert.ok(hitTest(outline, 0, 25, 3), "on the border");
  assert.ok(!hitTest(outline, 50, 25, 3), "an unfilled rectangle is hollow");
  assert.ok(hitTest({ ...outline, fill: "#ff0000" }, 50, 25, 3));
  const ellipse: WhiteboardElement = { ...base, id: "e", type: "ellipse", x: 0, y: 0, w: 100, h: 50, fill: null };
  assert.ok(hitTest(ellipse, 100, 25, 3));
  assert.ok(!hitTest(ellipse, 50, 25, 3));
  const pen: WhiteboardElement = { ...base, id: "p", type: "pen", x: 10, y: 10, w: 0, h: 0, points: [0, 0, 20, 0, 20, 20] };
  assert.ok(hitTest(pen, 30, 20, 2));
  assert.ok(!hitTest(pen, 15, 25, 2));
  assert.deepEqual(elementBounds(pen), { x: 10, y: 10, w: 20, h: 20 });
});

test("moving and group resizing keep shapes consistent", () => {
  const arrow: WhiteboardElement = { ...base, id: "a", type: "arrow", x: 0, y: 0, w: 10, h: 10 };
  assert.deepEqual(elementBounds(translateElement(arrow, 5, -5)), { x: 5, y: -5, w: 10, h: 10 });
  const text: WhiteboardElement = { ...base, id: "t", type: "text", x: 0, y: 0, w: 100, h: 25, text: "hi", fontSize: 20 };
  const scaled = scaleElement(text, { x: 0, y: 0, w: 100, h: 25 }, { x: 0, y: 0, w: 200, h: 50 });
  assert.equal(scaled.fontSize, 40);
  const pen: WhiteboardElement = { ...base, id: "p", type: "pen", x: 0, y: 0, w: 0, h: 0, points: [0, 0, 10, 10] };
  assert.deepEqual(elementBounds(scaleElement(pen, { x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 10, w: 30, h: 20 })), { x: 10, y: 10, w: 30, h: 20 });
});
