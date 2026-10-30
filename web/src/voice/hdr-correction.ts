/**
 * Correction for screen captures taken from a Windows desktop running in HDR.
 *
 * With HDR enabled, Windows hands the browser capture an SDR image without a
 * proper HDR-to-SDR conversion, so viewers see a washed-out, overexposed
 * picture (the same happens in Zoom, Teams, OBS and Windows screenshots).
 * The browser offers no option for it, so the sharer's frames are corrected
 * on their GPU before they are sent: the image is taken to linear light and
 * each channel goes through a power curve, which deepens lifted shadows and
 * mid-tones and, applied per channel, also restores the lost saturation.
 * Clipped highlights cannot be recovered; the washed-out look can.
 *
 * Uses MediaStreamTrackProcessor/Generator (Chromium: Chrome, Edge, Yandex,
 * Opera). Other browsers report it as unsupported and share unmodified.
 *
 * The GPU applies a 256-entry lookup table per channel. It is built either
 * from the manual curve below or from a measured calibration
 * (hdr-calibration.ts), and `strength` blends it with the unchanged picture.
 */
import type { HdrCalibrationCurve } from "./hdr-calibration.js";

/** Default strength; adjustable live from 0 (off) to 1. */
export const DEFAULT_HDR_CORRECTION_STRENGTH = 0.5;

/** Exponent added at full strength: linear light ^ (1 + 0.8). */
export const HDR_GAMMA_BOOST = 0.8;

interface TrackProcessorInit { track: MediaStreamTrack; maxBufferSize?: number }
type TrackProcessorConstructor = new (init: TrackProcessorInit) => { readable: ReadableStream<VideoFrame> };
type TrackGeneratorConstructor = new (init: { kind: "video" }) => MediaStreamTrack & { writable: WritableStream<VideoFrame> };

interface Environment {
  Processor: TrackProcessorConstructor;
  Generator: TrackGeneratorConstructor;
  createCanvas(): OffscreenCanvas;
  createFrame(source: OffscreenCanvas, init: VideoFrameInit): VideoFrame;
}

function browserEnvironment(): Environment | null {
  const scope = globalThis as Record<string, unknown>;
  const Processor = scope.MediaStreamTrackProcessor as TrackProcessorConstructor | undefined;
  const Generator = scope.MediaStreamTrackGenerator as TrackGeneratorConstructor | undefined;
  if (typeof Processor !== "function" || typeof Generator !== "function" || typeof OffscreenCanvas !== "function" || typeof VideoFrame !== "function") return null;
  return {
    Processor,
    Generator,
    createCanvas: () => new OffscreenCanvas(1, 1),
    createFrame: (source, init) => new VideoFrame(source, init),
  };
}

/** Whether this browser can correct shared frames. */
export function isHdrCorrectionSupported(): boolean {
  return browserEnvironment() !== null;
}

export interface HdrCorrection {
  /** The corrected track to send instead of the captured one. */
  readonly track: MediaStreamTrack;
  setStrength(strength: number): void;
  readonly strength: number;
  /** Use a measured curve instead of the manual one; null returns to the manual curve. */
  setCalibration(calibration: HdrCalibrationCurve | null): void;
  /** Stops processing and the corrected track; the source track is left to its owner. */
  dispose(): void;
}

export const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  // Texture row 0 is the top of the frame; GL's y axis points up.
  v_uv = vec2(a_position.x * 0.5 + 0.5, 0.5 - a_position.y * 0.5);
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

export const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D u_frame;
uniform sampler2D u_lut;
varying vec2 v_uv;
// The LUT is 256x1: entry k sits at the centre of texel k.
float lookup(float value, int channel) {
  vec4 entry = texture2D(u_lut, vec2((floor(value * 255.0 + 0.5) + 0.5) / 256.0, 0.5));
  return channel == 0 ? entry.r : channel == 1 ? entry.g : entry.b;
}
void main() {
  vec3 color = texture2D(u_frame, v_uv).rgb;
  gl_FragColor = vec4(lookup(color.r, 0), lookup(color.g, 1), lookup(color.b, 2), 1.0);
}`;

/**
 * The per-channel table the GPU applies (RGBA, 256 entries). With a
 * calibration it is that curve blended with the identity by `strength`;
 * without one it is the manual curve at that strength.
 */
export function buildCorrectionLut(strength: number, calibration: HdrCalibrationCurve | null): Uint8Array {
  const lut = new Uint8Array(256 * 4);
  for (let value = 0; value < 256; value++) {
    if (calibration) {
      lut[value * 4] = Math.round(value + (calibration.r[value]! - value) * strength);
      lut[value * 4 + 1] = Math.round(value + (calibration.g[value]! - value) * strength);
      lut[value * 4 + 2] = Math.round(value + (calibration.b[value]! - value) * strength);
    } else {
      const corrected = Math.round(correctChannel(value / 255, strength) * 255);
      lut[value * 4] = lut[value * 4 + 1] = lut[value * 4 + 2] = corrected;
    }
    lut[value * 4 + 3] = 255;
  }
  return lut;
}

/** The same curve as the shader, for one 0..1 sRGB channel value (used by tests and docs). */
export function correctChannel(value: number, strength: number): number {
  const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  const curved = linear ** (1 + HDR_GAMMA_BOOST * strength);
  const clamped = Math.min(1, Math.max(0, curved));
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

interface Renderer {
  /** `lut` is uploaded only when `lutVersion` changes. */
  render(frame: VideoFrame, lut: Uint8Array, lutVersion: number): void;
  dispose(): void;
}

function createRenderer(canvas: OffscreenCanvas): Renderer {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false }) as WebGLRenderingContext | null;
  if (!gl) throw new Error("WEBGL_UNAVAILABLE");
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`SHADER_COMPILE_FAILED: ${gl.getShaderInfoLog(shader) ?? ""}`);
    return shader;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`SHADER_LINK_FAILED: ${gl.getProgramInfoLog(program) ?? ""}`);
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const createTexture = (unit: number, filter: number) => {
    const created = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, created);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return created;
  };
  const lutTexture = createTexture(1, gl.NEAREST);
  const texture = createTexture(0, gl.LINEAR);
  gl.uniform1i(gl.getUniformLocation(program, "u_frame"), 0);
  gl.uniform1i(gl.getUniformLocation(program, "u_lut"), 1);
  let uploadedLut = -1;
  return {
    render(frame, lut, lutVersion) {
      const width = frame.displayWidth, height = frame.displayHeight;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      if (uploadedLut !== lutVersion) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, lutTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut);
        uploadedLut = lutVersion;
      }
      gl.viewport(0, 0, width, height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame as unknown as TexImageSource);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    dispose() {
      try { gl.deleteTexture(texture); gl.deleteTexture(lutTexture); gl.deleteBuffer(buffer); gl.deleteProgram(program); } catch { /* context may be lost */ }
      try { gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* optional */ }
    },
  };
}

/**
 * Wrap a captured video track. Throws if the browser cannot process frames;
 * a GPU failure later on falls back to passing frames through unchanged.
 */
export function createHdrCorrection(
  source: MediaStreamTrack,
  initialStrength = DEFAULT_HDR_CORRECTION_STRENGTH,
  options: {
    onFailure?(error: unknown): void;
    environment?: Environment;
    renderer?: (canvas: OffscreenCanvas) => Renderer;
    calibration?: HdrCalibrationCurve | null;
  } = {},
): HdrCorrection {
  const environment = options.environment ?? browserEnvironment();
  if (!environment) throw new Error("HDR_CORRECTION_UNSUPPORTED");
  const processor = new environment.Processor({ track: source, maxBufferSize: 2 });
  const generator = new environment.Generator({ kind: "video" });
  const reader = processor.readable.getReader();
  const writer = generator.writable.getWriter();
  const canvas = environment.createCanvas();
  let renderer: Renderer | null = null;
  let rendererFailed = false;
  let strength = clampStrength(initialStrength);
  let calibration = options.calibration ?? null;
  let lut = buildCorrectionLut(strength, calibration);
  let lutVersion = 0;
  let disposed = false;
  const rebuildLut = () => { lut = buildCorrectionLut(strength, calibration); lutVersion++; };

  function process(frame: VideoFrame): VideoFrame {
    if (strength <= 0.001 || rendererFailed) return frame;
    try {
      renderer ??= (options.renderer ?? createRenderer)(canvas);
      renderer.render(frame, lut, lutVersion);
      const corrected = environment!.createFrame(canvas, {
        timestamp: frame.timestamp,
        ...(frame.duration !== null && frame.duration !== undefined ? { duration: frame.duration } : {}),
      });
      frame.close();
      return corrected;
    } catch (error: unknown) {
      // Keep the share alive: send the original picture from now on.
      rendererFailed = true;
      renderer?.dispose();
      renderer = null;
      options.onFailure?.(error);
      return frame;
    }
  }

  void (async () => {
    try {
      while (!disposed) {
        const { value: frame, done } = await reader.read();
        if (done || !frame) break;
        if (disposed) { frame.close(); break; }
        // The generator takes ownership of written frames and closes them.
        await writer.write(process(frame));
      }
    } catch {
      // Reader/writer errors end processing; the corrected track then ends.
    } finally {
      try { await writer.close(); } catch { /* already closed or errored */ }
    }
  })();

  return {
    track: generator,
    get strength() { return strength; },
    setStrength(value: number) {
      const next = clampStrength(value);
      if (next === strength) return;
      strength = next;
      rebuildLut();
    },
    setCalibration(value: HdrCalibrationCurve | null) {
      calibration = value;
      rebuildLut();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      void reader.cancel().catch(() => undefined);
      try { generator.stop(); } catch { /* already stopped */ }
      renderer?.dispose();
      renderer = null;
    },
  };
}

function clampStrength(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : DEFAULT_HDR_CORRECTION_STRENGTH;
}
