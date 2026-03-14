import { createCodexTranscriptPresenter } from "./codex-transcript-presenter.js";

const promptPanel = document.getElementById("prompt-panel");
const settingsPanel = document.getElementById("settings-panel");
const promptForm = document.getElementById("prompt-form");
const settingsForm = document.getElementById("settings-form");
const promptInput = document.getElementById("prompt-input");
const editTab = document.getElementById("game-tab-edit");
const annotationButton = document.getElementById("game-tab-annotation");
const settingsTab = document.getElementById("game-tab-settings");
const favoriteButton = document.getElementById("game-tab-favorite");
const recordButton = document.getElementById("prompt-record-button");
const tileCaptureButton = document.getElementById("game-tab-capture-tile");
const codexToggle = document.getElementById("game-codex-toggle");
const deleteButton = document.getElementById("game-tab-delete");
const promptOverlay = document.getElementById("prompt-overlay");
const promptDrawingCanvas = document.getElementById("prompt-drawing-canvas");
const gameCanvas = document.getElementById("game-canvas");
const codexTranscript = document.getElementById("game-codex-transcript");
const gameSessionView = document.getElementById("game-codex-session-view");

const promptInputIsTextEntry =
  promptInput instanceof HTMLInputElement ||
  (typeof HTMLTextAreaElement === "function" &&
    promptInput instanceof HTMLTextAreaElement);

if (
  !(promptPanel instanceof HTMLElement) ||
  !(settingsPanel instanceof HTMLElement) ||
  !(promptForm instanceof HTMLFormElement) ||
  !(settingsForm instanceof HTMLElement) ||
  !promptInputIsTextEntry ||
  !(editTab instanceof HTMLButtonElement) ||
  !(annotationButton instanceof HTMLButtonElement) ||
  !(settingsTab instanceof HTMLButtonElement) ||
  !(favoriteButton instanceof HTMLButtonElement) ||
  !(recordButton instanceof HTMLButtonElement) ||
  !(tileCaptureButton instanceof HTMLButtonElement) ||
  !(codexToggle instanceof HTMLButtonElement) ||
  !(deleteButton instanceof HTMLButtonElement) ||
  !(codexTranscript instanceof HTMLElement) ||
  !(gameSessionView instanceof HTMLElement) ||
  !(promptDrawingCanvas instanceof HTMLCanvasElement)
) {
  throw new Error("Game view controls missing from page");
}

const versionId = document.body.dataset.versionId;
const csrfToken = document.body.dataset.csrfToken;
const initialFavorite = document.body.dataset.gameFavorited === "true";
const codegenProvider =
  document.body.dataset.codegenProvider === "claude" ? "claude" : "codex";
const transcriptProviderLabel =
  codegenProvider === "claude" ? "Claude" : "Codex";
const transcriptPresenter = createCodexTranscriptPresenter(gameSessionView, {
  transcriptTitle: `${transcriptProviderLabel} Transcript`,
});
const transcriptPollIntervalMs = 2000;
const generatingClassName = "game-view-tab--generating";
const gameRuntimeControlsChangedEvent = "game-runtime-controls-changed";
const settingsSaveDebounceMs = 120;
const annotationStrokeColor = "rgba(250, 204, 21, 0.95)";
const annotationStrokeWidth = 4;
let transcriptStatusKey = "";
let transcriptSignature = "";
let transcriptRequestInFlight = false;
let favoriteRequestInFlight = false;
let deleteRequestInFlight = false;
let tileCaptureInFlight = false;
let settingsSaveTimerId = null;
let settingsSaveInFlight = false;
let pendingSettingsSave = false;
const initialUiState = Object.freeze({
  activeDrawer: null,
  codexPanelExpanded: false,
  gameFavorited: initialFavorite,
  annotationEnabled: false,
  recordingInProgress: false,
  transcriptionInFlight: false,
});
const promptDraftStorageKeyPrefix = "game-space:prompt-draft:";

let uiState = initialUiState;

function promptDraftStorageKey() {
  if (typeof versionId !== "string" || versionId.length === 0) {
    return null;
  }

  return `${promptDraftStorageKeyPrefix}${versionId}`;
}

function promptDraftStorage() {
  if (
    typeof window !== "object" ||
    window === null ||
    !("localStorage" in window)
  ) {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function writePromptDraftToStorage(promptDraft) {
  const storageKey = promptDraftStorageKey();
  const storage = promptDraftStorage();
  if (!storageKey || !storage) {
    return;
  }

  try {
    if (typeof promptDraft === "string" && promptDraft.length > 0) {
      storage.setItem(storageKey, promptDraft);
      return;
    }

    storage.removeItem(storageKey);
  } catch {
    // Keep draft persistence non-blocking if storage is unavailable.
  }
}

function clearPromptDraftFromStorage() {
  writePromptDraftToStorage("");
}

function restorePromptDraftFromStorage() {
  const storageKey = promptDraftStorageKey();
  const storage = promptDraftStorage();
  if (!storageKey || !storage) {
    return;
  }

  try {
    const storedDraft = storage.getItem(storageKey);
    if (typeof storedDraft !== "string" || storedDraft.length === 0) {
      return;
    }

    promptInput.value = storedDraft;
  } catch {
    // Keep draft persistence non-blocking if storage is unavailable.
  }
}

function reduceUiState(state, action) {
  switch (action.type) {
    case "set-active-drawer":
      if (state.activeDrawer === action.drawer) {
        return state;
      }
      return {
        ...state,
        activeDrawer: action.drawer,
      };
    case "set-codex-panel-expanded":
      if (state.codexPanelExpanded === action.expanded) {
        return state;
      }
      return {
        ...state,
        codexPanelExpanded: action.expanded,
      };
    case "set-game-favorited":
      if (state.gameFavorited === action.favorited) {
        return state;
      }
      return {
        ...state,
        gameFavorited: action.favorited,
      };
    case "set-annotation-enabled":
      if (state.annotationEnabled === action.enabled) {
        return state;
      }
      return {
        ...state,
        annotationEnabled: action.enabled,
      };
    case "set-recording-in-progress":
      if (state.recordingInProgress === action.inProgress) {
        return state;
      }
      return {
        ...state,
        recordingInProgress: action.inProgress,
      };
    case "set-transcription-in-flight":
      if (state.transcriptionInFlight === action.inFlight) {
        return state;
      }
      return {
        ...state,
        transcriptionInFlight: action.inFlight,
      };
    default:
      return state;
  }
}

function dispatchUiState(action) {
  uiState = reduceUiState(uiState, action);
}

function isDrawerOpen() {
  return uiState.activeDrawer === "edit" || uiState.activeDrawer === "settings";
}

function getActiveGameRuntimeControls() {
  const runtimeControls = window.__gameSpaceActiveGameRuntimeControls;
  if (!runtimeControls || typeof runtimeControls !== "object") {
    return null;
  }

  if (
    typeof runtimeControls.getSliders !== "function" ||
    typeof runtimeControls.setGlobalValue !== "function" ||
    typeof runtimeControls.serializeControlState !== "function"
  ) {
    return null;
  }

  return runtimeControls;
}

function getActiveGameRuntimeHost() {
  const runtimeHost = window.__gameSpaceActiveGameRuntimeHost;
  if (!runtimeHost || typeof runtimeHost !== "object") {
    return null;
  }

  if (typeof runtimeHost.versionId !== "string") {
    return null;
  }

  if (
    runtimeHost.loadControlState !== undefined &&
    typeof runtimeHost.loadControlState !== "function"
  ) {
    return null;
  }

  if (
    runtimeHost.saveControlState !== undefined &&
    typeof runtimeHost.saveControlState !== "function"
  ) {
    return null;
  }

  return runtimeHost;
}

function readRuntimeSliderDefinitions() {
  const runtimeControls = getActiveGameRuntimeControls();
  if (!runtimeControls) {
    return [];
  }

  const sliders = runtimeControls.getSliders();
  if (!Array.isArray(sliders)) {
    return [];
  }

  return sliders.filter((slider) => {
    return (
      slider &&
      typeof slider === "object" &&
      typeof slider.id === "string" &&
      typeof slider.label === "string" &&
      typeof slider.globalKey === "string" &&
      typeof slider.min === "number" &&
      Number.isFinite(slider.min) &&
      typeof slider.max === "number" &&
      Number.isFinite(slider.max) &&
      typeof slider.step === "number" &&
      Number.isFinite(slider.step) &&
      typeof slider.value === "number" &&
      Number.isFinite(slider.value)
    );
  });
}

let realtimePeerConnection = null;
let realtimeDataChannel = null;
let realtimeAudioStream = null;
let completedTranscriptionSegments = [];
const pendingOverlayWords = [];
let displayedOverlayWords = [];
let overlayWordDrainIntervalId = null;
const overlayWordDrainIntervalMs = 100;
const realtimeStopFlushPollIntervalMs = 50;
const realtimeStopFlushTimeoutMs = 2000;
const realtimeStopFlushMaxPolls = Math.max(
  1,
  Math.ceil(realtimeStopFlushTimeoutMs / realtimeStopFlushPollIntervalMs),
);
const realtimeStopFlushSignalTypes = new Set([
  "input_audio_buffer.committed",
  "input_audio_buffer.cleared",
  "conversation.item.input_audio_transcription.completed",
  "conversation.item.input_audio_transcription.failed",
  "response.done",
  "error",
]);
let annotationPointerId = null;
let annotationStrokeInProgress = false;
let annotationHasInk = false;
let annotationBaseGameScreenshotPngDataUrl = null;
let annotationToggleInFlight = false;
let realtimeStopFlushWaitState = null;

function drawingContext() {
  const context = promptDrawingCanvas.getContext("2d");
  if (!context) {
    return null;
  }

  return context;
}

function resizeDrawingCanvas() {
  const width = Math.max(1, Math.round(promptDrawingCanvas.clientWidth));
  const height = Math.max(1, Math.round(promptDrawingCanvas.clientHeight));
  const nextDevicePixelRatio =
    typeof window.devicePixelRatio === "number" && window.devicePixelRatio > 0
      ? window.devicePixelRatio
      : 1;
  const nextWidth = Math.round(width * nextDevicePixelRatio);
  const nextHeight = Math.round(height * nextDevicePixelRatio);

  if (
    promptDrawingCanvas.width !== nextWidth ||
    promptDrawingCanvas.height !== nextHeight
  ) {
    promptDrawingCanvas.width = nextWidth;
    promptDrawingCanvas.height = nextHeight;
  }

  const context = drawingContext();
  if (!context) {
    return;
  }

  context.setTransform(nextDevicePixelRatio, 0, 0, nextDevicePixelRatio, 0, 0);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = annotationStrokeColor;
  context.lineWidth = annotationStrokeWidth;
}

function clearDrawingCanvas() {
  resizeDrawingCanvas();
  const context = drawingContext();
  if (!context) {
    return;
  }

  context.clearRect(
    0,
    0,
    promptDrawingCanvas.width,
    promptDrawingCanvas.height,
  );
  annotationHasInk = false;
}

function applyAnnotationCanvasState() {
  const annotationEnabled = uiState.annotationEnabled;
  promptDrawingCanvas.classList.toggle(
    "prompt-drawing-canvas--active",
    annotationEnabled,
  );
  promptDrawingCanvas.setAttribute(
    "aria-hidden",
    annotationEnabled ? "false" : "true",
  );
  if (annotationEnabled) {
    return;
  }

  if (
    typeof annotationPointerId === "number" &&
    promptDrawingCanvas.hasPointerCapture(annotationPointerId)
  ) {
    promptDrawingCanvas.releasePointerCapture(annotationPointerId);
  }

  annotationPointerId = null;
  annotationStrokeInProgress = false;
}

function updateAnnotationButtonVisualState() {
  annotationButton.classList.toggle(
    "prompt-action-button--active",
    uiState.annotationEnabled,
  );
  annotationButton.classList.toggle(
    "prompt-action-button--busy",
    annotationToggleInFlight,
  );
  annotationButton.disabled = annotationToggleInFlight;
  annotationButton.setAttribute(
    "aria-pressed",
    uiState.annotationEnabled ? "true" : "false",
  );
  annotationButton.setAttribute(
    "aria-label",
    uiState.annotationEnabled
      ? "Disable annotation drawing"
      : "Enable annotation drawing",
  );
}

function applyAnnotationState() {
  applyAnnotationCanvasState();
  updateAnnotationButtonVisualState();
}

function resetAnnotationSession() {
  annotationBaseGameScreenshotPngDataUrl = null;
  clearDrawingCanvas();
  dispatchUiState({ type: "set-annotation-enabled", enabled: false });
  applyAnnotationState();
}

function pointerCoordinates(event) {
  const rect = promptDrawingCanvas.getBoundingClientRect();
  const clientX = typeof event.clientX === "number" ? event.clientX : 0;
  const clientY = typeof event.clientY === "number" ? event.clientY : 0;
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

function isPrimaryAnnotationPointer(event) {
  if (event.pointerType === "mouse") {
    return event.button === 0;
  }

  return true;
}

function beginAnnotationStroke(event) {
  if (
    !uiState.annotationEnabled ||
    annotationStrokeInProgress ||
    !isPrimaryAnnotationPointer(event)
  ) {
    return;
  }

  const context = drawingContext();
  if (!context || typeof event.pointerId !== "number") {
    return;
  }

  annotationPointerId = event.pointerId;
  annotationStrokeInProgress = true;
  const point = pointerCoordinates(event);
  context.beginPath();
  context.moveTo(point.x, point.y);
  context.lineTo(point.x, point.y);
  context.stroke();
  annotationHasInk = true;
  promptDrawingCanvas.setPointerCapture(event.pointerId);
}

function extendAnnotationStroke(event) {
  if (!annotationStrokeInProgress || annotationPointerId !== event.pointerId) {
    return;
  }

  const context = drawingContext();
  if (!context) {
    return;
  }

  const point = pointerCoordinates(event);
  context.lineTo(point.x, point.y);
  context.stroke();
}

function endAnnotationStroke(event) {
  if (annotationPointerId !== event.pointerId) {
    return;
  }

  if (promptDrawingCanvas.hasPointerCapture(event.pointerId)) {
    promptDrawingCanvas.releasePointerCapture(event.pointerId);
  }

  annotationPointerId = null;
  annotationStrokeInProgress = false;
}

function readAnnotationPngDataUrl() {
  if (!annotationHasInk) {
    return null;
  }

  return promptDrawingCanvas.toDataURL("image/png");
}

function blankCanvasPngDataUrl(width, height) {
  if (typeof document.createElement !== "function") {
    return null;
  }

  const blankCanvas = document.createElement("canvas");
  if (!(blankCanvas instanceof HTMLCanvasElement)) {
    return null;
  }

  blankCanvas.width = Math.max(1, width);
  blankCanvas.height = Math.max(1, height);

  try {
    return blankCanvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

function flushGameCanvasWebGlFrame() {
  if (
    !(gameCanvas instanceof HTMLCanvasElement) ||
    typeof gameCanvas.getContext !== "function"
  ) {
    return;
  }

  const webGlContext =
    gameCanvas.getContext("webgl2") ??
    gameCanvas.getContext("webgl") ??
    gameCanvas.getContext("experimental-webgl");
  if (!webGlContext || typeof webGlContext.finish !== "function") {
    return;
  }

  webGlContext.finish();
}

function waitForNextAnimationFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      resolve();
    });
  });
}

async function captureGameScreenshotPngDataUrl(maxAttempts = 3) {
  if (
    !(gameCanvas instanceof HTMLCanvasElement) ||
    typeof gameCanvas.toDataURL !== "function"
  ) {
    return null;
  }

  const attempts = Number.isFinite(maxAttempts)
    ? Math.max(1, Math.floor(maxAttempts))
    : 1;
  const blankSnapshot = blankCanvasPngDataUrl(
    gameCanvas.width,
    gameCanvas.height,
  );

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await waitForNextAnimationFrame();
    flushGameCanvasWebGlFrame();

    try {
      const snapshot = gameCanvas.toDataURL("image/png");
      if (typeof snapshot !== "string" || snapshot.length === 0) {
        continue;
      }

      if (
        blankSnapshot &&
        snapshot === blankSnapshot &&
        attempt < attempts - 1
      ) {
        continue;
      }

      return snapshot;
    } catch {
      // Retry until attempts are exhausted.
    }
  }

  return null;
}

function loadDataUrlImage(dataUrl) {
  return new Promise((resolve, reject) => {
    if (typeof dataUrl !== "string" || dataUrl.trim().length === 0) {
      reject(new Error("Image data URL missing"));
      return;
    }

    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener(
      "error",
      () => reject(new Error("Image data URL failed to load")),
      { once: true },
    );
    image.src = dataUrl;
  });
}

async function composePromptScreenshotPngDataUrl(
  baseGameScreenshotPngDataUrl = null,
) {
  const gameScreenshotPngDataUrl =
    typeof baseGameScreenshotPngDataUrl === "string" &&
    baseGameScreenshotPngDataUrl.trim().length > 0
      ? baseGameScreenshotPngDataUrl
      : await captureGameScreenshotPngDataUrl();
  if (!gameScreenshotPngDataUrl) {
    return null;
  }

  const annotationPngDataUrl = readAnnotationPngDataUrl();
  if (!annotationPngDataUrl) {
    return gameScreenshotPngDataUrl;
  }

  if (typeof document.createElement !== "function") {
    return gameScreenshotPngDataUrl;
  }

  const compositeCanvas = document.createElement("canvas");
  if (!(compositeCanvas instanceof HTMLCanvasElement)) {
    return gameScreenshotPngDataUrl;
  }

  const compositeContext = compositeCanvas.getContext("2d");
  if (!compositeContext || typeof compositeContext.drawImage !== "function") {
    return gameScreenshotPngDataUrl;
  }

  try {
    const [gameImage, annotationImage] = await Promise.all([
      loadDataUrlImage(gameScreenshotPngDataUrl),
      loadDataUrlImage(annotationPngDataUrl),
    ]);
    compositeCanvas.width = Math.max(1, gameImage.width);
    compositeCanvas.height = Math.max(1, gameImage.height);
    compositeContext.clearRect(
      0,
      0,
      compositeCanvas.width,
      compositeCanvas.height,
    );
    compositeContext.drawImage(
      gameImage,
      0,
      0,
      compositeCanvas.width,
      compositeCanvas.height,
    );
    compositeContext.drawImage(
      annotationImage,
      0,
      0,
      compositeCanvas.width,
      compositeCanvas.height,
    );
    return compositeCanvas.toDataURL("image/png");
  } catch {
    return gameScreenshotPngDataUrl;
  }
}

function applyFavoriteState() {
  favoriteButton.classList.toggle(
    "game-view-icon-tab--active",
    uiState.gameFavorited,
  );
  favoriteButton.setAttribute(
    "aria-pressed",
    uiState.gameFavorited ? "true" : "false",
  );
  favoriteButton.setAttribute(
    "aria-label",
    uiState.gameFavorited ? "Unfavorite game" : "Favorite game",
  );
}

function logRealtimeTranscription(message, details = undefined) {
  if (typeof console === "undefined" || typeof console.log !== "function") {
    return;
  }

  if (details === undefined) {
    console.log(`[realtime-transcription] ${message}`);
    return;
  }

  console.log(`[realtime-transcription] ${message}`, details);
}

function updateRecordButtonVisualState() {
  recordButton.classList.toggle(
    "game-view-icon-tab--recording",
    uiState.recordingInProgress,
  );
  recordButton.classList.toggle(
    "game-view-icon-tab--busy",
    uiState.transcriptionInFlight,
  );
  recordButton.disabled = uiState.transcriptionInFlight;

  if (uiState.recordingInProgress) {
    recordButton.setAttribute("aria-label", "Stop voice recording");
    return;
  }

  recordButton.setAttribute("aria-label", "Start voice recording");
}

function updateTileCaptureButtonVisualState() {
  tileCaptureButton.classList.toggle(
    "game-view-icon-tab--busy",
    tileCaptureInFlight,
  );
  tileCaptureButton.disabled = tileCaptureInFlight;
}

function stopAudioStream(stream) {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function closeRealtimeConnection() {
  if (realtimeDataChannel && typeof realtimeDataChannel.close === "function") {
    realtimeDataChannel.close();
  }

  if (
    realtimePeerConnection &&
    typeof realtimePeerConnection.close === "function"
  ) {
    realtimePeerConnection.close();
  }

  if (realtimeAudioStream) {
    stopAudioStream(realtimeAudioStream);
  }

  realtimePeerConnection = null;
  realtimeDataChannel = null;
  realtimeAudioStream = null;
}

function updatePromptOverlay() {
  const overlayText = displayedOverlayWords.join(" ").trim();
  const shouldShowOverlay = !isDrawerOpen() && overlayText.length > 0;

  if (!(promptOverlay instanceof HTMLElement)) {
    return;
  }

  promptOverlay.textContent = shouldShowOverlay ? overlayText : "";
  promptOverlay.classList.toggle("prompt-overlay--visible", shouldShowOverlay);
  promptOverlay.setAttribute(
    "aria-hidden",
    shouldShowOverlay ? "false" : "true",
  );

  if (shouldShowOverlay) {
    window.requestAnimationFrame(() => {
      promptOverlay.scrollLeft = promptOverlay.scrollWidth;
    });
  }
}

function enqueueOverlayWords(transcriptSegment) {
  const words = transcriptSegment
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
  if (words.length === 0) {
    return;
  }

  pendingOverlayWords.push(...words);
  drainOverlayWord();
}

function drainOverlayWord() {
  if (pendingOverlayWords.length === 0) {
    return;
  }

  const nextWord = pendingOverlayWords.shift();
  if (typeof nextWord !== "string" || nextWord.length === 0) {
    return;
  }

  displayedOverlayWords.push(nextWord);
  updatePromptOverlay();
}

function settleRealtimeStopFlushWait(result) {
  const flushWaitState = realtimeStopFlushWaitState;
  if (!flushWaitState || flushWaitState.settled) {
    return;
  }

  flushWaitState.settled = true;
  if (typeof flushWaitState.intervalId === "number") {
    window.clearInterval(flushWaitState.intervalId);
  }

  realtimeStopFlushWaitState = null;
  flushWaitState.resolve(result);
}

function maybeResolveRealtimeStopFlushWait() {
  const flushWaitState = realtimeStopFlushWaitState;
  if (!flushWaitState || flushWaitState.settled) {
    return;
  }

  if (pendingOverlayWords.length > 0) {
    drainOverlayWord();
  }

  const overlayDrainComplete = pendingOverlayWords.length === 0;
  if (overlayDrainComplete && flushWaitState.flushSignalReceived) {
    settleRealtimeStopFlushWait("completed");
    return;
  }

  flushWaitState.pollsRemaining -= 1;
  if (flushWaitState.pollsRemaining <= 0) {
    settleRealtimeStopFlushWait("timeout");
  }
}

function markRealtimeStopFlushSignal(payloadType) {
  const flushWaitState = realtimeStopFlushWaitState;
  if (
    !flushWaitState ||
    flushWaitState.settled ||
    !realtimeStopFlushSignalTypes.has(payloadType)
  ) {
    return;
  }

  flushWaitState.flushSignalReceived = true;
  maybeResolveRealtimeStopFlushWait();
}

function waitForRealtimeStopFlush(initialFlushSignalReceived = false) {
  return new Promise((resolve) => {
    realtimeStopFlushWaitState = {
      settled: false,
      flushSignalReceived: initialFlushSignalReceived,
      pollsRemaining: realtimeStopFlushMaxPolls,
      intervalId: null,
      resolve,
    };

    realtimeStopFlushWaitState.intervalId = window.setInterval(() => {
      maybeResolveRealtimeStopFlushWait();
    }, realtimeStopFlushPollIntervalMs);

    maybeResolveRealtimeStopFlushWait();
  });
}

function ensureOverlayWordDrainLoop() {
  if (typeof overlayWordDrainIntervalId === "number") {
    return;
  }

  overlayWordDrainIntervalId = window.setInterval(() => {
    drainOverlayWord();
  }, overlayWordDrainIntervalMs);
}

function clearOverlayWordDrainLoop() {
  if (typeof overlayWordDrainIntervalId !== "number") {
    return;
  }

  window.clearInterval(overlayWordDrainIntervalId);
  overlayWordDrainIntervalId = null;
}

function clearTranscriptionDisplayBuffer() {
  pendingOverlayWords.length = 0;
  displayedOverlayWords = [];
  updatePromptOverlay();
}

function appendCompletedTranscriptSegment(transcriptSegment) {
  const normalizedSegment = transcriptSegment.trim();
  if (normalizedSegment.length === 0) {
    return;
  }

  completedTranscriptionSegments.push(normalizedSegment);
  enqueueOverlayWords(normalizedSegment);

  if (uiState.activeDrawer === "edit") {
    promptInput.value = completedTranscriptionSegments.join(" ").trim();
    writePromptDraftToStorage(promptInput.value);
    resizePromptInput();
    focusPromptInput();
  }

  updatePromptOverlay();
}

function handleRealtimeDataChannelMessage(event) {
  if (!event || typeof event.data !== "string") {
    return;
  }

  logRealtimeTranscription("data received", event.data);

  let payload;
  try {
    payload = JSON.parse(event.data);
  } catch {
    return;
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.type !== "string"
  ) {
    return;
  }

  if (
    payload.type === "conversation.item.input_audio_transcription.completed" &&
    typeof payload.transcript === "string"
  ) {
    appendCompletedTranscriptSegment(payload.transcript);
  }

  markRealtimeStopFlushSignal(payload.type);
}

function csrfRequestHeaders() {
  const headers = {};

  if (typeof csrfToken === "string" && csrfToken.length > 0) {
    headers["X-CSRF-Token"] = csrfToken;
  }

  return headers;
}

async function requestRealtimeClientSecret() {
  const response = await fetch("/api/transcribe", {
    method: "POST",
    headers: csrfRequestHeaders(),
  });

  if (!response.ok) {
    let errorDetails = `status ${response.status}`;
    try {
      const payload = await response.json();
      if (
        payload &&
        typeof payload === "object" &&
        typeof payload.error === "string" &&
        payload.error.trim().length > 0
      ) {
        errorDetails = `${errorDetails}: ${payload.error}`;
      }
    } catch {
      // Keep status-only detail when the response payload cannot be parsed.
    }

    logRealtimeTranscription("session request failed", errorDetails);
    throw new Error(
      `Realtime transcription session request failed: ${errorDetails}`,
    );
  }

  const payload = await response.json();
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.clientSecret !== "string"
  ) {
    throw new Error("Realtime transcription session payload was invalid");
  }

  if (payload.clientSecret.trim().length === 0) {
    throw new Error(
      "Realtime transcription session payload missing client secret",
    );
  }

  if (typeof payload.model !== "string" || payload.model.trim().length === 0) {
    throw new Error("Realtime transcription session payload missing model");
  }

  return {
    clientSecret: payload.clientSecret,
    model: payload.model.trim(),
  };
}

async function requestRealtimeAnswerSdp(realtimeSession, offerSdp) {
  const requestBody = typeof offerSdp === "string" ? offerSdp : "";
  const response = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${realtimeSession.clientSecret}`,
      "Content-Type": "application/sdp",
    },
    body: requestBody,
  });

  if (!response.ok) {
    throw new Error("Realtime transcription SDP exchange failed");
  }

  return response.text();
}

async function toggleFavorite() {
  if (!versionId || favoriteRequestInFlight || deleteRequestInFlight) {
    return;
  }

  favoriteRequestInFlight = true;
  favoriteButton.disabled = true;
  deleteButton.disabled = true;

  try {
    const response = await fetch(
      `/api/games/${encodeURIComponent(versionId)}/favorite`,
      {
        method: "POST",
        headers: csrfRequestHeaders(),
      },
    );
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    if (
      !payload ||
      typeof payload !== "object" ||
      typeof payload.favorite !== "boolean"
    ) {
      return;
    }

    dispatchUiState({
      type: "set-game-favorited",
      favorited: payload.favorite,
    });
    document.body.dataset.gameFavorited = uiState.gameFavorited
      ? "true"
      : "false";
    applyFavoriteState();
  } finally {
    favoriteRequestInFlight = false;
    favoriteButton.disabled = false;
    deleteButton.disabled = false;
  }
}

async function deleteGameVersion() {
  if (!versionId || favoriteRequestInFlight || deleteRequestInFlight) {
    return;
  }

  const confirmed = window.confirm(
    "Delete this game? This action cannot be undone.",
  );
  if (!confirmed) {
    return;
  }

  deleteRequestInFlight = true;
  favoriteButton.disabled = true;
  deleteButton.disabled = true;

  try {
    const response = await fetch(
      `/api/games/${encodeURIComponent(versionId)}`,
      {
        method: "DELETE",
        headers: csrfRequestHeaders(),
      },
    );

    if (!response.ok) {
      return;
    }

    window.location.assign("/");
  } finally {
    deleteRequestInFlight = false;
    favoriteButton.disabled = false;
    deleteButton.disabled = false;
  }
}

async function captureTileSnapshot() {
  if (!versionId || tileCaptureInFlight) {
    return;
  }

  const tilePngDataUrl = await captureGameScreenshotPngDataUrl();
  if (typeof tilePngDataUrl !== "string" || tilePngDataUrl.length === 0) {
    return;
  }

  tileCaptureInFlight = true;
  updateTileCaptureButtonVisualState();

  try {
    const response = await fetch(
      `/api/games/${encodeURIComponent(versionId)}/tile-snapshot`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...csrfRequestHeaders(),
        },
        body: JSON.stringify({ tilePngDataUrl }),
      },
    );
    if (!response.ok) {
      return;
    }
  } finally {
    tileCaptureInFlight = false;
    updateTileCaptureButtonVisualState();
  }
}

async function toggleAnnotationMode() {
  if (annotationToggleInFlight) {
    return;
  }

  if (uiState.annotationEnabled) {
    resetAnnotationSession();
    return;
  }

  await enableAnnotationSession();
}

async function enableAnnotationSession() {
  if (annotationToggleInFlight || uiState.annotationEnabled) {
    return;
  }

  annotationToggleInFlight = true;
  updateAnnotationButtonVisualState();
  clearDrawingCanvas();

  try {
    annotationBaseGameScreenshotPngDataUrl =
      await captureGameScreenshotPngDataUrl();
    dispatchUiState({ type: "set-annotation-enabled", enabled: true });
  } finally {
    annotationToggleInFlight = false;
    applyAnnotationState();
  }
}

async function startRealtimeRecording() {
  if (!navigator?.mediaDevices?.getUserMedia) {
    return;
  }

  if (typeof RTCPeerConnection !== "function") {
    return;
  }

  dispatchUiState({ type: "set-transcription-in-flight", inFlight: true });
  updateRecordButtonVisualState();
  ensureOverlayWordDrainLoop();
  completedTranscriptionSegments = [];
  clearTranscriptionDisplayBuffer();
  await enableAnnotationSession();

  let peerConnection = null;
  let dataChannel = null;
  let stream = null;

  try {
    const realtimeSession = await requestRealtimeClientSecret();

    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    peerConnection = new RTCPeerConnection();
    dataChannel = peerConnection.createDataChannel("oai-events");
    dataChannel.addEventListener("message", handleRealtimeDataChannelMessage);

    for (const track of stream.getTracks()) {
      peerConnection.addTrack(track, stream);
    }

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const answerSdp = await requestRealtimeAnswerSdp(
      realtimeSession,
      offer.sdp,
    );
    await peerConnection.setRemoteDescription({
      type: "answer",
      sdp: answerSdp,
    });

    realtimePeerConnection = peerConnection;
    realtimeDataChannel = dataChannel;
    realtimeAudioStream = stream;
    dispatchUiState({ type: "set-recording-in-progress", inProgress: true });
    logRealtimeTranscription("started");
  } catch {
    if (dataChannel && typeof dataChannel.close === "function") {
      dataChannel.close();
    }

    if (peerConnection && typeof peerConnection.close === "function") {
      peerConnection.close();
    }

    if (stream) {
      stopAudioStream(stream);
    }

    return;
  } finally {
    dispatchUiState({ type: "set-transcription-in-flight", inFlight: false });
    updateRecordButtonVisualState();
  }
}

async function stopRealtimeRecording() {
  if (!uiState.recordingInProgress) {
    return;
  }

  dispatchUiState({ type: "set-transcription-in-flight", inFlight: true });
  updateRecordButtonVisualState();

  try {
    const hasOpenRealtimeDataChannel = Boolean(
      realtimeDataChannel && realtimeDataChannel.readyState === "open",
    );
    if (hasOpenRealtimeDataChannel) {
      realtimeDataChannel.send(
        JSON.stringify({
          type: "input_audio_buffer.commit",
        }),
      );
    }

    const flushOutcome = await waitForRealtimeStopFlush(
      !hasOpenRealtimeDataChannel,
    );
    if (flushOutcome === "timeout") {
      logRealtimeTranscription("flush timeout fallback");
    }

    const transcribedPrompt = completedTranscriptionSegments.join(" ").trim();
    const annotationPngDataUrl = readAnnotationPngDataUrl();

    const gameScreenshotPngDataUrl = await composePromptScreenshotPngDataUrl(
      annotationBaseGameScreenshotPngDataUrl,
    );
    if (versionId && transcribedPrompt.length > 0) {
      const promptSubmitted = await submitPrompt(
        transcribedPrompt,
        annotationPngDataUrl,
        gameScreenshotPngDataUrl,
      );
      if (promptSubmitted) {
        completedTranscriptionSegments = [];
        clearTranscriptionDisplayBuffer();
        resetAnnotationSession();
      }
    }
  } finally {
    logRealtimeTranscription("stopped");
    logRealtimeTranscription("final transcribed text", promptInput.value);
    dispatchUiState({ type: "set-recording-in-progress", inProgress: false });
    closeRealtimeConnection();
    dispatchUiState({ type: "set-transcription-in-flight", inFlight: false });
    updateRecordButtonVisualState();
  }
}

function toggleRecording() {
  if (uiState.transcriptionInFlight) {
    return;
  }

  if (uiState.recordingInProgress) {
    void stopRealtimeRecording();
    return;
  }

  void startRealtimeRecording();
}

function clearElementChildren(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function renderSettingsEmptyState(message) {
  clearElementChildren(settingsForm);

  const emptyState = document.createElement("p");
  if (!(emptyState instanceof HTMLElement)) {
    return;
  }

  emptyState.className = "settings-panel-empty";
  emptyState.textContent = message;
  settingsForm.appendChild(emptyState);
}

function findRuntimeSliderById(sliderId) {
  for (const slider of readRuntimeSliderDefinitions()) {
    if (slider.id === sliderId) {
      return slider;
    }
  }

  return null;
}

async function flushSettingsSave() {
  if (!pendingSettingsSave || settingsSaveInFlight) {
    return;
  }

  const runtimeHost = getActiveGameRuntimeHost();
  const runtimeControls = getActiveGameRuntimeControls();
  if (
    !runtimeHost ||
    typeof runtimeHost.saveControlState !== "function" ||
    !runtimeControls
  ) {
    pendingSettingsSave = false;
    return;
  }

  pendingSettingsSave = false;
  settingsSaveInFlight = true;

  try {
    await runtimeHost.saveControlState(runtimeControls.serializeControlState());
  } finally {
    settingsSaveInFlight = false;
    if (pendingSettingsSave) {
      void flushSettingsSave();
    }
  }
}

function scheduleSettingsSave() {
  pendingSettingsSave = true;

  if (typeof settingsSaveTimerId === "number") {
    window.clearTimeout(settingsSaveTimerId);
  }

  settingsSaveTimerId = window.setTimeout(() => {
    settingsSaveTimerId = null;
    void flushSettingsSave();
  }, settingsSaveDebounceMs);
}

function renderSettingsControls() {
  const runtimeControls = getActiveGameRuntimeControls();
  if (!runtimeControls) {
    renderSettingsEmptyState("Loading settings...");
    return;
  }

  const sliders = readRuntimeSliderDefinitions();
  if (sliders.length === 0) {
    renderSettingsEmptyState("No runtime settings available.");
    return;
  }

  clearElementChildren(settingsForm);

  for (const slider of sliders) {
    const control = document.createElement("div");
    const header = document.createElement("div");
    const label = document.createElement("label");
    const value = document.createElement("span");
    const input = document.createElement("input");
    if (
      !(control instanceof HTMLElement) ||
      !(header instanceof HTMLElement) ||
      !(label instanceof HTMLElement) ||
      !(value instanceof HTMLElement) ||
      !(input instanceof HTMLInputElement)
    ) {
      continue;
    }

    const sliderInputId = `settings-slider-${slider.id}`;
    control.className = "settings-control";
    header.className = "settings-control-header";
    label.className = "settings-control-label";
    label.setAttribute("for", sliderInputId);
    label.textContent = slider.label;
    value.className = "settings-control-value";
    value.textContent = String(slider.value);
    header.appendChild(label);
    header.appendChild(value);

    input.id = sliderInputId;
    input.className = "settings-control-slider";
    input.type = "range";
    input.min = String(slider.min);
    input.max = String(slider.max);
    input.step = String(slider.step);
    input.value = String(slider.value);
    input.setAttribute("aria-label", slider.label);

    const handleSliderInput = () => {
      const nextValue = Number.parseFloat(input.value);
      if (!Number.isFinite(nextValue)) {
        return;
      }

      const didApply = runtimeControls.setGlobalValue(
        slider.globalKey,
        nextValue,
      );
      if (!didApply) {
        return;
      }

      const updatedSlider = findRuntimeSliderById(slider.id);
      const resolvedValue = updatedSlider ? updatedSlider.value : nextValue;
      input.value = String(resolvedValue);
      value.textContent = String(resolvedValue);
      scheduleSettingsSave();
    };

    input.addEventListener("input", handleSliderInput);
    input.addEventListener("change", handleSliderInput);

    control.appendChild(header);
    control.appendChild(input);
    settingsForm.appendChild(control);
  }
}

function syncSettingsControls() {
  renderSettingsControls();

  if (uiState.activeDrawer === "settings") {
    window.requestAnimationFrame(() => {
      if (uiState.activeDrawer === "settings") {
        updateSettingsDrawerHeight();
      }
    });
  }
}

function updateDrawerHeightForPanel(panelElement) {
  if (!(panelElement instanceof HTMLElement)) {
    return;
  }

  const panelRectHeight =
    typeof panelElement.getBoundingClientRect === "function"
      ? panelElement.getBoundingClientRect().height
      : 0;
  const panelOffsetHeight =
    typeof panelElement.offsetHeight === "number" ? panelElement.offsetHeight : 0;
  const panelHeight = Math.ceil(Math.max(panelRectHeight, panelOffsetHeight));

  if (panelHeight <= 0) {
    return;
  }

  document.body.style.setProperty("--edit-drawer-height", `${panelHeight}px`);
}

function updatePromptDrawerHeight() {
  updateDrawerHeightForPanel(promptPanel);
}

function updateSettingsDrawerHeight() {
  updateDrawerHeightForPanel(settingsPanel);
}

function applyBottomPanelState() {
  const editPanelOpen = uiState.activeDrawer === "edit";
  const runtimeSettingsOpen = uiState.activeDrawer === "settings";
  const codexPanelExpanded = editPanelOpen && uiState.codexPanelExpanded;

  promptPanel.classList.toggle("prompt-panel--open", editPanelOpen);
  promptPanel.setAttribute("aria-hidden", editPanelOpen ? "false" : "true");
  settingsPanel.classList.toggle("settings-panel--open", runtimeSettingsOpen);
  settingsPanel.setAttribute(
    "aria-hidden",
    runtimeSettingsOpen ? "false" : "true",
  );

  editTab.classList.toggle("game-view-tab--active", editPanelOpen);
  editTab.setAttribute("aria-expanded", editPanelOpen ? "true" : "false");
  settingsTab.classList.toggle("game-view-tab--active", runtimeSettingsOpen);
  settingsTab.setAttribute(
    "aria-expanded",
    runtimeSettingsOpen ? "true" : "false",
  );

  codexToggle.setAttribute(
    "aria-expanded",
    codexPanelExpanded ? "true" : "false",
  );

  codexTranscript.classList.toggle(
    "game-codex-transcript--open",
    codexPanelExpanded,
  );
  codexTranscript.setAttribute(
    "aria-hidden",
    codexPanelExpanded ? "false" : "true",
  );

  document.body.classList.toggle(
    "game-page--drawer-open",
    editPanelOpen || runtimeSettingsOpen,
  );
  document.body.classList.toggle(
    "game-page--codex-expanded",
    codexPanelExpanded,
  );

  if (editPanelOpen) {
    const transcribedPrompt = completedTranscriptionSegments.join(" ").trim();
    if (transcribedPrompt.length > 0) {
      promptInput.value = transcribedPrompt;
      writePromptDraftToStorage(promptInput.value);
    }

    resizePromptInput();
    updatePromptDrawerHeight();
  } else if (runtimeSettingsOpen) {
    syncSettingsControls();
  } else {
    document.body.style.setProperty("--edit-drawer-height", "0px");
  }

  updatePromptOverlay();
}

function toggleEditPanel() {
  if (uiState.activeDrawer === "edit") {
    dispatchUiState({ type: "set-active-drawer", drawer: null });
    dispatchUiState({ type: "set-codex-panel-expanded", expanded: false });
    applyBottomPanelState();
    return;
  }

  dispatchUiState({ type: "set-active-drawer", drawer: "edit" });
  applyBottomPanelState();
  focusPromptInput();
}

function toggleSettingsPanel() {
  if (uiState.activeDrawer === "settings") {
    dispatchUiState({ type: "set-active-drawer", drawer: null });
    applyBottomPanelState();
    return;
  }

  dispatchUiState({ type: "set-active-drawer", drawer: "settings" });
  dispatchUiState({ type: "set-codex-panel-expanded", expanded: false });
  applyBottomPanelState();
}

function requestTranscriptScrollToBottom() {
  if (typeof transcriptPresenter.scrollToBottom !== "function") {
    return;
  }

  window.requestAnimationFrame(() => {
    transcriptPresenter.scrollToBottom();
  });
}

function toggleCodexPanelExpanded() {
  if (uiState.activeDrawer !== "edit") {
    dispatchUiState({ type: "set-active-drawer", drawer: "edit" });
  }

  dispatchUiState({
    type: "set-codex-panel-expanded",
    expanded: !uiState.codexPanelExpanded,
  });
  applyBottomPanelState();

  if (uiState.codexPanelExpanded) {
    requestTranscriptScrollToBottom();
    return;
  }

  focusPromptInput();
}

function focusPromptInput() {
  window.requestAnimationFrame(() => {
    promptInput.focus();
  });
}

function showTranscriptState(statusKey, title, description) {
  if (transcriptStatusKey === statusKey) {
    return;
  }

  transcriptPresenter.showEmptyState(title, description);
  transcriptStatusKey = statusKey;
  transcriptSignature = "";
}

function parseEyeState(value) {
  if (
    value === "stopped" ||
    value === "idle" ||
    value === "generating" ||
    value === "error"
  ) {
    return value;
  }

  return null;
}

function applyEyeState(eyeState) {
  const isGenerating = eyeState === "generating";
  if (isGenerating) {
    editTab.classList.add(generatingClassName);
  } else {
    editTab.classList.remove(generatingClassName);
  }

  editTab.setAttribute("aria-busy", isGenerating ? "true" : "false");
}

function buildTranscriptSignature(sessionId, messages) {
  const lastMessage = messages[messages.length - 1];
  const lastRole =
    typeof lastMessage?.role === "string" ? lastMessage.role : "";
  const lastText =
    typeof lastMessage?.text === "string" ? lastMessage.text : "";
  const lastTimestamp =
    typeof lastMessage?.timestamp === "string" ? lastMessage.timestamp : "";
  return `${sessionId}:${messages.length}:${lastRole}:${lastTimestamp}:${lastText}`;
}

async function loadGameTranscript() {
  if (transcriptRequestInFlight) {
    return;
  }

  transcriptRequestInFlight = true;

  try {
    if (!versionId) {
      showTranscriptState(
        "missing-version",
        "Session unavailable",
        "Game version id is missing from this page.",
      );
      return;
    }

    let response;
    try {
      response = await fetch(
        `/api/codex-sessions/${encodeURIComponent(versionId)}`,
      );
    } catch {
      showTranscriptState(
        "fetch-failed",
        "Session unavailable",
        "Could not reach the server.",
      );
      return;
    }

    if (!response.ok) {
      showTranscriptState(
        `bad-status-${response.status}`,
        "Session unavailable",
        `Server returned ${response.status}.`,
      );
      return;
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      showTranscriptState(
        "invalid-json",
        "Session unavailable",
        "Invalid response payload.",
      );
      return;
    }

    if (
      !payload ||
      typeof payload !== "object" ||
      typeof payload.status !== "string"
    ) {
      showTranscriptState(
        "invalid-shape",
        "Session unavailable",
        "Unexpected response shape.",
      );
      return;
    }

    const eyeState = parseEyeState(payload.eyeState);
    if (eyeState) {
      applyEyeState(eyeState);
    }

    if (payload.status === "no-session") {
      showTranscriptState(
        "no-session",
        "No session linked",
        `This game version does not have a saved ${transcriptProviderLabel} session id yet.`,
      );
      return;
    }

    if (payload.status === "session-file-missing") {
      showTranscriptState(
        "session-file-missing",
        "Session file not found",
        "The linked session id exists in metadata but no matching JSONL file was found.",
      );
      return;
    }

    if (
      payload.status !== "ok" ||
      typeof payload.sessionId !== "string" ||
      !Array.isArray(payload.messages)
    ) {
      showTranscriptState(
        "invalid-transcript",
        "Session unavailable",
        "Unexpected transcript payload.",
      );
      return;
    }

    const nextSignature = buildTranscriptSignature(
      payload.sessionId,
      payload.messages,
    );
    const shouldRenderTranscript =
      transcriptStatusKey !== "ok" || transcriptSignature !== nextSignature;
    if (!shouldRenderTranscript) {
      return;
    }

    transcriptPresenter.renderTranscript(payload.sessionId, payload.messages, {
      autoScrollToBottom: true,
    });
    transcriptStatusKey = "ok";
    transcriptSignature = nextSignature;
  } finally {
    transcriptRequestInFlight = false;
  }
}

function startTranscriptPolling() {
  void loadGameTranscript();

  const intervalId = window.setInterval(() => {
    void loadGameTranscript();
  }, transcriptPollIntervalMs);

  window.addEventListener(
    "beforeunload",
    () => {
      window.clearInterval(intervalId);
    },
    { once: true },
  );
}

async function submitPrompt(
  prompt,
  annotationPngDataUrl = null,
  gameScreenshotPngDataUrl = null,
) {
  const headers = {
    "Content-Type": "application/json",
  };

  if (typeof csrfToken === "string" && csrfToken.length > 0) {
    headers["X-CSRF-Token"] = csrfToken;
  }

  const response = await fetch(
    `/api/games/${encodeURIComponent(versionId)}/prompts`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt,
        annotationPngDataUrl:
          typeof annotationPngDataUrl === "string"
            ? annotationPngDataUrl
            : null,
        gameScreenshotPngDataUrl:
          typeof gameScreenshotPngDataUrl === "string"
            ? gameScreenshotPngDataUrl
            : null,
      }),
    },
  );

  if (!response.ok) {
    return false;
  }

  const payload = await response.json();
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.forkId !== "string"
  ) {
    return false;
  }

  clearPromptDraftFromStorage();
  window.location.assign(`/game/${encodeURIComponent(payload.forkId)}`);
  return true;
}

function resizePromptInput() {
  if (!(promptInput instanceof HTMLElement) || !("style" in promptInput)) {
    return;
  }

  promptInput.style.height = "auto";

  const computedPromptStyle = window.getComputedStyle(promptInput);
  const maxHeight = Number.parseFloat(computedPromptStyle.maxHeight);
  const nextHeight =
    typeof promptInput.scrollHeight === "number" ? promptInput.scrollHeight : 0;
  const clampedHeight =
    Number.isFinite(maxHeight) && maxHeight > 0
      ? Math.min(nextHeight, maxHeight)
      : nextHeight;

  if (clampedHeight > 0) {
    promptInput.style.height = `${clampedHeight}px`;
  }

  if (uiState.activeDrawer === "edit") {
    updatePromptDrawerHeight();
  }
}

let hasInitializedGameViewControls = false;

function initializeGameViewControls() {
  if (hasInitializedGameViewControls) {
    return;
  }

  hasInitializedGameViewControls = true;

  restorePromptDraftFromStorage();
  syncSettingsControls();
  applyBottomPanelState();
  resizePromptInput();
  updateTileCaptureButtonVisualState();

  editTab.addEventListener("click", () => {
    toggleEditPanel();
  });

  settingsTab.addEventListener("click", () => {
    toggleSettingsPanel();
  });

  codexToggle.addEventListener("click", () => {
    toggleCodexPanelExpanded();
  });

  tileCaptureButton.addEventListener("click", () => {
    void captureTileSnapshot();
  });

  annotationButton.addEventListener("click", () => {
    void toggleAnnotationMode();
  });

  promptForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const prompt = promptInput.value;
    if (!versionId || prompt.trim().length === 0) {
      return;
    }

    void (async () => {
      const annotationPngDataUrl = readAnnotationPngDataUrl();
      const gameScreenshotPngDataUrl = await composePromptScreenshotPngDataUrl(
        annotationBaseGameScreenshotPngDataUrl,
      );
      await submitPrompt(
        prompt,
        annotationPngDataUrl,
        gameScreenshotPngDataUrl,
      );
    })().catch(() => {
      // Keep prompt submit non-blocking if networking or payload parsing fails.
    });

    promptInput.value = "";
    resizePromptInput();
    completedTranscriptionSegments = [];
    clearTranscriptionDisplayBuffer();
    resetAnnotationSession();
    focusPromptInput();
  });

  promptForm.addEventListener("reset", () => {
    promptInput.value = "";
    clearPromptDraftFromStorage();
    resizePromptInput();
  });

  promptInput.addEventListener("input", () => {
    writePromptDraftToStorage(promptInput.value);
    resizePromptInput();
  });

  promptInput.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      promptForm.requestSubmit();
    }
  });

  window.addEventListener("resize", () => {
    resizePromptInput();
    resizeDrawingCanvas();
    if (uiState.activeDrawer === "settings") {
      updateSettingsDrawerHeight();
    }
  });

  window.addEventListener(gameRuntimeControlsChangedEvent, () => {
    syncSettingsControls();
  });

  window.addEventListener(
    "beforeunload",
    () => {
      closeRealtimeConnection();
      clearOverlayWordDrainLoop();
      if (typeof settingsSaveTimerId === "number") {
        window.clearTimeout(settingsSaveTimerId);
      }
    },
    { once: true },
  );

  resizeDrawingCanvas();
  applyAnnotationState();

  promptDrawingCanvas.addEventListener("pointerdown", (event) => {
    beginAnnotationStroke(event);
  });

  promptDrawingCanvas.addEventListener("pointermove", (event) => {
    extendAnnotationStroke(event);
  });

  promptDrawingCanvas.addEventListener("pointerup", (event) => {
    endAnnotationStroke(event);
  });

  promptDrawingCanvas.addEventListener("pointercancel", (event) => {
    endAnnotationStroke(event);
  });

  applyEyeState("stopped");
  updateRecordButtonVisualState();
  applyFavoriteState();

  recordButton.addEventListener("click", () => {
    toggleRecording();
  });

  favoriteButton.addEventListener("click", () => {
    void toggleFavorite();
  });

  deleteButton.addEventListener("click", () => {
    void deleteGameVersion();
  });
}

function runAfterReactHydration(callback) {
  if (document.body.dataset.gameReactHydrated === "true") {
    callback();
    return;
  }

  window.addEventListener(
    "game-react-hydrated",
    () => {
      callback();
    },
    { once: true },
  );
}

initializeGameViewControls();

runAfterReactHydration(() => {
  startTranscriptPolling();
});
