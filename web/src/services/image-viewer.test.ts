import assert from "node:assert/strict";
import test from "node:test";
import { IMAGE_VIEWER_MAX_SCALE, clampPan, closeImageViewer, imageViewer, openImageViewer, stepImageViewer, zoomAround } from "./image-viewer.js";

test("zooming keeps the point under the cursor in place and stays in bounds", () => {
  const view = { scale: 0.5, x: 0, y: 0 };
  const zoomed = zoomAround(view, 1, 100, -40, 0.5);
  // The image point under (100, -40) was (100 - 0) / 0.5 = 200 px from the centre; it must stay at 100.
  assert.equal(zoomed.x + 200 * zoomed.scale, 100);
  assert.equal(zoomed.y + -80 * zoomed.scale, -40);
  assert.equal(zoomAround(view, 100, 0, 0, 0.5).scale, IMAGE_VIEWER_MAX_SCALE);
  assert.equal(zoomAround(view, 0.1, 0, 0, 0.5).scale, 0.5, "never smaller than the fitted size");
});

test("panning stops at the image edges and centres an image that fits", () => {
  assert.deepEqual(clampPan({ scale: 2, x: 900, y: -900 }, 1000, 500, 1000, 800), { scale: 2, x: 500, y: -100 });
  assert.deepEqual(clampPan({ scale: 0.5, x: 40, y: 40 }, 1000, 500, 1000, 800), { scale: 0.5, x: 0, y: 0 });
});

test("the gallery opens on the clicked picture and wraps around", () => {
  const gallery = [{ src: "a", name: "A" }, { src: "b", name: "B" }, { src: "c", name: "C" }];
  openImageViewer({ src: "b", name: "B" }, gallery);
  assert.equal(imageViewer.index, 1);
  stepImageViewer(1); stepImageViewer(1);
  assert.equal(imageViewer.images[imageViewer.index].src, "a");
  stepImageViewer(-1);
  assert.equal(imageViewer.images[imageViewer.index].src, "c");
  openImageViewer({ src: "z", name: "Z" }, gallery);
  assert.equal(imageViewer.images[imageViewer.index].src, "z", "a picture missing from the gallery is still shown");
  closeImageViewer();
  assert.equal(imageViewer.open, false);
  assert.deepEqual(imageViewer.images, []);
});
