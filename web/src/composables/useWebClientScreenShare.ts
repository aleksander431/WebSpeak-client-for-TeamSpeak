import { computed, onMounted, onBeforeUnmount, ref, watch, type Ref } from "vue";
import type { ChannelMember, ScreenShareOutputSettings, ScreenShareStream } from "./useVoiceWebSocket.js";
import { DEFAULT_HDR_CORRECTION_STRENGTH, isHdrCorrectionSupported } from "../voice/hdr-correction.js";
import { HdrCalibrationError, parseHdrCalibration, type CalibrationDisplay, type HdrCalibrationErrorCode, type HdrCalibrationResult } from "../voice/hdr-calibration.js";
import { openCalibrationOverlay, type CalibrationOverlay, type CalibrationOverlayTexts } from "../voice/hdr-calibration-overlay.js";

const CALIBRATION_STORAGE_KEY = "webspeak:screen-share-hdr-calibration";

export type ScreenShareResolutionPreset = "source" | "720p" | "1080p" | "1440p";

export type ScreenSharePriority = "auto" | "detail" | "motion";

export type ScreenShareBitratePreset = "auto" | "1.5" | "3" | "5" | "8" | "12";

interface ScreenShareResolutionOption {
  value: ScreenShareResolutionPreset;
  width?: number;
  height?: number;
  label: string;
}

interface ScreenShareBitrateOption {
  value: ScreenShareBitratePreset;
  bitrate?: number;
  label: string;
}

interface UseWebClientScreenShareOptions {
  streams: ScreenShareStream[];
  viewing: Ref<boolean>;
  viewingStreamId: Ref<string>;
  remoteStream: Ref<MediaStream | null>;
  remoteVolume: Ref<number>;
  error: Ref<string>;
  errorCode: Ref<string>;
  startScreenShare: (audio?: boolean, settings?: ScreenShareOutputSettings) => Promise<void>;
  /** Re-applies output settings to a running share; optional for older callers. */
  updateScreenShareOutputSettings?: (settings: ScreenShareOutputSettings) => Promise<void>;
  /** True while this browser is sharing. */
  sharing?: Readonly<Ref<boolean>>;
  /** Measures the running capture; see screen-share.ts. */
  measureHdrCalibration?: (display: CalibrationDisplay, signal?: AbortSignal) => Promise<HdrCalibrationResult>;
  /** Replaceable for tests; must open synchronously inside the click handler. */
  openCalibrationDisplay?: (texts: CalibrationOverlayTexts) => CalibrationOverlay;
  joinScreenShare: (streamId: string) => void;
  leaveScreenShare: () => void;
  nickname: Ref<string>;
  avatarStyle: (name: string, isSelf?: boolean, avatar?: string) => Record<string, string>;
  /** Resolves a member's avatar from the local directory by TeamSpeak client id. */
  memberAvatar: (clientId: number) => string;
  t: (key: string) => string;
}

export function useWebClientScreenShare({
  streams,
  viewing,
  viewingStreamId,
  remoteStream,
  remoteVolume,
  error,
  errorCode,
  startScreenShare,
  updateScreenShareOutputSettings,
  sharing,
  measureHdrCalibration,
  openCalibrationDisplay = openCalibrationOverlay,
  joinScreenShare,
  leaveScreenShare,
  nickname,
  avatarStyle,
  memberAvatar,
  t,
}: UseWebClientScreenShareOptions) {
  const videoElement = ref<HTMLVideoElement | null>(null);
  const playerElement = ref<HTMLElement | null>(null);
  const fullscreen = ref(false);
  const resolutionOptions: ScreenShareResolutionOption[] = [
    { value: "source", label: "screenShareResolutionSource" },
    { value: "720p", width: 1280, height: 720, label: "screenShareResolution720p" },
    { value: "1080p", width: 1920, height: 1080, label: "screenShareResolution1080p" },
    { value: "1440p", width: 2560, height: 1440, label: "screenShareResolution1440p" },
  ];
  const frameRateOptions = [5, 10, 15, 24, 30, 60];
  const bitrateOptions: ScreenShareBitrateOption[] = [
    { value: "auto", label: "screenShareBitrateAuto" },
    { value: "1.5", bitrate: 1_500_000, label: "screenShareBitrate1_5M" },
    { value: "3", bitrate: 3_000_000, label: "screenShareBitrate3M" },
    { value: "5", bitrate: 5_000_000, label: "screenShareBitrate5M" },
    { value: "8", bitrate: 8_000_000, label: "screenShareBitrate8M" },
    { value: "12", bitrate: 12_000_000, label: "screenShareBitrate12M" },
  ];
  const storedResolution = localStorage.getItem("webspeak:screen-share-resolution") as ScreenShareResolutionPreset | null;
  const resolutionPreset = ref<ScreenShareResolutionPreset>(resolutionOptions.some((option) => option.value === storedResolution) ? storedResolution! : "1080p");
  const storedFrameRate = Number(localStorage.getItem("webspeak:screen-share-framerate"));
  const frameRate = ref(frameRateOptions.includes(storedFrameRate) ? storedFrameRate : 30);
  const storedBitrate = localStorage.getItem("webspeak:screen-share-bitrate") as ScreenShareBitratePreset | null;
  const bitratePreset = ref<ScreenShareBitratePreset>(bitrateOptions.some((option) => option.value === storedBitrate) ? storedBitrate! : "auto");
  const priorityOptions: Array<{ value: ScreenSharePriority; label: string }> = [
    { value: "auto", label: "screenSharePriorityAuto" },
    { value: "detail", label: "screenSharePriorityDetail" },
    { value: "motion", label: "screenSharePriorityMotion" },
  ];
  const storedPriority = localStorage.getItem("webspeak:screen-share-priority") as ScreenSharePriority | null;
  const priority = ref<ScreenSharePriority>(priorityOptions.some((option) => option.value === storedPriority) ? storedPriority! : "auto");
  const hdrSupported = isHdrCorrectionSupported();
  const hdrEnabled = ref(hdrSupported && localStorage.getItem("webspeak:screen-share-hdr") === "1");
  const storedHdrStrength = Number(localStorage.getItem("webspeak:screen-share-hdr-strength"));
  /** Slider value in percent. */
  const hdrStrength = ref(Number.isFinite(storedHdrStrength) && storedHdrStrength >= 5 && storedHdrStrength <= 100
    ? Math.round(storedHdrStrength)
    : Math.round(DEFAULT_HDR_CORRECTION_STRENGTH * 100));
  const hdrCalibration = ref<HdrCalibrationResult | null>(readCalibration());
  const calibrationState = ref<"idle" | "running" | "done" | "failed">("idle");
  const calibrationError = ref<HdrCalibrationErrorCode | "">("");
  const calibrationProgress = ref(0);
  const settingsOpen = ref(false);
  const activeStream = computed<ScreenShareStream | null>(() => streams.find((stream) => stream.streamId === viewingStreamId.value) ?? null);
  const viewers = computed(() =>
    (activeStream.value?.viewers.slice(-5) ?? []).map(viewer => ({
      ...viewer,
      // The gateway sends a client id; resolve the avatar from the directory the
      // client already holds instead of shipping the image in every roster
      // update. An older gateway may still include the avatar inline.
      avatar: viewer.avatar ?? (typeof viewer.clientId === "number" ? memberAvatar(viewer.clientId) : ""),
    })),
  );
  const viewerCount = computed(() => activeStream.value?.viewerCount ?? activeStream.value?.viewers.length ?? 0);
  const ownerName = computed(() => activeStream.value?.ownerNickname ?? t("screenShare"));
  const errorText = computed(() => errorCode.value === "SCREEN_SHARE_NATIVE_BRIDGE_REQUIRED" ? t("screenShareNativeUnavailable") : error.value);

  function setVideoElement(element: unknown): void {
    if (videoElement.value && videoElement.value !== element) videoElement.value.srcObject = null;
    videoElement.value = element instanceof HTMLVideoElement ? element : null;
  }

  function setPlayerElement(element: unknown): void {
    const previous = playerElement.value;
    if (previous && previous !== element && document.fullscreenElement === previous) {
      void document.exitFullscreen().catch(() => undefined);
    }
    playerElement.value = element instanceof HTMLElement ? element : null;
    syncFullscreen();
  }

  function streamForMember(member: ChannelMember): ScreenShareStream | null {
    return streams.find((stream) => {
      if (typeof stream.ownerClientId === "number") return stream.ownerClientId === member.id;
      if (stream.source === "teamspeak" && /^ts-\d+$/.test(stream.ownerPeerId)) return stream.ownerPeerId === `ts-${member.id}`;
      return stream.ownerNickname === member.nickname;
    }) ?? null;
  }

  function toggleForMember(member: ChannelMember): void {
    const stream = streamForMember(member);
    if (!stream) return;
    if (viewingStreamId.value === stream.streamId) leaveScreenShare();
    else joinScreenShare(stream.streamId);
  }

  function viewerStyle(viewer: { nickname: string; avatar?: string }) {
    return avatarStyle(viewer.nickname, viewer.nickname === nickname.value, viewer.avatar ?? "");
  }

  function setVolume(event: Event): void {
    remoteVolume.value = Math.max(0, Math.min(1, Number((event.target as HTMLInputElement).value) / 100));
  }

  function syncFullscreen(): void {
    fullscreen.value = Boolean(playerElement.value && document.fullscreenElement === playerElement.value);
  }

  async function toggleFullscreen(): Promise<void> {
    const player = playerElement.value;
    if (!player) return;
    try {
      if (document.fullscreenElement === player) await document.exitFullscreen();
      else if (player.requestFullscreen) await player.requestFullscreen();
    } catch {
      syncFullscreen();
    }
  }

  function currentSettings(): ScreenShareOutputSettings {
    const preset = resolutionOptions.find((option) => option.value === resolutionPreset.value);
    const bitrateOption = bitrateOptions.find((option) => option.value === bitratePreset.value);
    return {
      ...(preset?.width && preset.height ? { maxWidth: preset.width, maxHeight: preset.height } : {}),
      maxFrameRate: frameRate.value,
      ...(bitrateOption?.bitrate ? { maxBitrate: bitrateOption.bitrate } : {}),
      ...(priority.value !== "auto" ? { priority: priority.value } : {}),
      // Omitted when off; a missing value also switches correction off live.
      ...(hdrSupported && hdrEnabled.value ? { hdrCorrection: hdrStrength.value / 100 } : {}),
      ...(hdrSupported && hdrEnabled.value && hdrCalibration.value ? { hdrCalibration: hdrCalibration.value } : {}),
    };
  }

  function persistSettings(): void {
    try {
      localStorage.setItem("webspeak:screen-share-resolution", resolutionPreset.value);
      localStorage.setItem("webspeak:screen-share-framerate", String(frameRate.value));
      localStorage.setItem("webspeak:screen-share-bitrate", bitratePreset.value);
      localStorage.setItem("webspeak:screen-share-priority", priority.value);
      localStorage.setItem("webspeak:screen-share-hdr", hdrEnabled.value ? "1" : "0");
      localStorage.setItem("webspeak:screen-share-hdr-strength", String(hdrStrength.value));
    } catch { /* settings still apply to this share */ }
  }

  async function startWithSettings(): Promise<void> {
    persistSettings();
    settingsOpen.value = false;
    await startScreenShare(true, currentSettings());
  }

  // While sharing, every change in the dialog applies at once, including the
  // HDR slider, so the sharer can tune it while watching the result.
  function readCalibration(): HdrCalibrationResult | null {
    try {
      const stored = localStorage.getItem(CALIBRATION_STORAGE_KEY);
      return stored ? parseHdrCalibration(JSON.parse(stored)) : null;
    } catch { return null; }
  }

  /**
   * Show grey levels full-screen and measure the live capture. Call from the
   * click handler directly: the overlay needs the gesture for fullscreen.
   */
  async function calibrateHdr(): Promise<void> {
    if (!sharing?.value || !measureHdrCalibration || !hdrSupported || calibrationState.value === "running") return;
    const overlay = openCalibrationDisplay({ progress: (done, total) => `${t("screenShareHdrCalibrating")} ${done}/${total} · Esc` });
    calibrationState.value = "running";
    calibrationError.value = "";
    calibrationProgress.value = 0;
    const display: CalibrationDisplay = {
      show: (level) => overlay.show(level),
      setProgress: (done, total) => { overlay.setProgress?.(done, total); calibrationProgress.value = Math.round(done / total * 100); },
    };
    try {
      const result = await measureHdrCalibration(display, overlay.signal);
      hdrCalibration.value = result;
      try {
        localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify({ ...result, r: Array.from(result.r), g: Array.from(result.g), b: Array.from(result.b) }));
      } catch { /* applies to this share even if it cannot be remembered */ }
      // A measured curve is meant to be applied fully.
      hdrEnabled.value = true;
      hdrStrength.value = 100;
      calibrationState.value = "done";
    } catch (error: unknown) {
      calibrationError.value = error instanceof HdrCalibrationError ? error.code : "NO_FRAMES";
      calibrationState.value = calibrationError.value === "CANCELLED" ? "idle" : "failed";
    } finally {
      overlay.close();
    }
  }

  function resetHdrCalibration(): void {
    hdrCalibration.value = null;
    calibrationState.value = "idle";
    calibrationError.value = "";
    try { localStorage.removeItem(CALIBRATION_STORAGE_KEY); } catch { /* nothing stored */ }
  }

  watch([resolutionPreset, frameRate, bitratePreset, priority, hdrEnabled, hdrStrength, hdrCalibration], () => {
    if (!sharing?.value || !updateScreenShareOutputSettings) return;
    persistSettings();
    void updateScreenShareOutputSettings(currentSettings());
  });

  watch([videoElement, remoteStream, remoteVolume], ([video, stream, volume]) => {
    if (!video) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    video.volume = Math.max(0, Math.min(1, volume ?? 1));
    if (stream) void video.play().catch(() => undefined);
  }, { flush: "post", immediate: true });
  watch(viewing, (isViewing) => {
    if (!isViewing && playerElement.value && document.fullscreenElement === playerElement.value) void document.exitFullscreen().catch(() => undefined);
  });

  onMounted(() => document.addEventListener("fullscreenchange", syncFullscreen));
  onBeforeUnmount(() => {
    document.removeEventListener("fullscreenchange", syncFullscreen);
    setVideoElement(null);
    setPlayerElement(null);
  });

  return {
    hdrCalibration,
    calibrationState,
    calibrationError,
    calibrationProgress,
    canCalibrate: computed(() => Boolean(hdrSupported && measureHdrCalibration && sharing?.value)),
    calibrateHdr,
    resetHdrCalibration,
    priorityOptions,
    priority,
    hdrSupported,
    hdrEnabled,
    hdrStrength,
    sharing,
    videoElement,
    playerElement,
    fullscreen,
    resolutionOptions,
    frameRateOptions,
    bitrateOptions,
    resolutionPreset,
    frameRate,
    bitratePreset,
    settingsOpen,
    activeStream,
    viewers,
    viewerCount,
    ownerName,
    errorText,
    setVideoElement,
    setPlayerElement,
    streamForMember,
    toggleForMember,
    viewerStyle,
    setVolume,
    syncFullscreen,
    toggleFullscreen,
    startWithSettings,
  };
}
