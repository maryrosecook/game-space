import { createCodexTranscriptPresenter } from './codex-transcript-presenter.js';

const promptPanel = document.getElementById('prompt-panel');
const promptForm = document.getElementById('prompt-form');
const promptInput = document.getElementById('prompt-input');
const editTab = document.getElementById('game-tab-edit');
const favoriteButton = document.getElementById('game-tab-favorite');
const recordButton = document.getElementById('prompt-record-button');
const tileCaptureButton = document.getElementById('game-tab-capture-tile');
const codexToggle = document.getElementById('game-codex-toggle');
const deleteButton = document.getElementById('game-tab-delete');
const promptOverlay = document.getElementById('prompt-overlay');
const promptDrawingCanvas = document.getElementById('prompt-drawing-canvas');
const gameCanvas = document.getElementById('game-canvas');
const codexTranscript = document.getElementById('game-codex-transcript');
const gameSessionView = document.getElementById('game-codex-session-view');

const promptInputIsTextEntry =
  promptInput instanceof HTMLInputElement ||
  (typeof HTMLTextAreaElement === 'function' && promptInput instanceof HTMLTextAreaElement);

if (
  !(promptPanel instanceof HTMLElement) ||
  !(promptForm instanceof HTMLFormElement) ||
  !promptInputIsTextEntry ||
  !(editTab instanceof HTMLButtonElement) ||
  !(favoriteButton instanceof HTMLButtonElement) ||
  !(recordButton instanceof HTMLButtonElement) ||
  !(tileCaptureButton instanceof HTMLButtonElement) ||
  !(codexToggle instanceof HTMLButtonElement) ||
  !(deleteButton instanceof HTMLButtonElement) ||
  !(codexTranscript instanceof HTMLElement) ||
  !(gameSessionView instanceof HTMLElement) ||
  !(promptDrawingCanvas instanceof HTMLCanvasElement)
) {
  throw new Error('Game view controls missing from page');
}

const versionId = document.body.dataset.versionId;
const csrfToken = document.body.dataset.csrfToken;
const initialFavorite = document.body.dataset.gameFavorited === 'true';
const codegenProvider = document.body.dataset.codegenProvider === 'claude' ? 'claude' : 'codex';
const transcriptProviderLabel = codegenProvider === 'claude' ? 'Claude' : 'Codex';
const transcriptPresenter = createCodexTranscriptPresenter(gameSessionView, {
  transcriptTitle: `${transcriptProviderLabel} Transcript`
});
const transcriptPollIntervalMs = 2000;
const generatingClassName = 'game-view-tab--generating';
const annotationStrokeColor = 'rgba(128, 128, 128, 0.5)';
const annotationStrokeWidth = 4;
let transcriptStatusKey = '';
let transcriptSignature = '';
let transcriptRequestInFlight = false;
let favoriteRequestInFlight = false;
let deleteRequestInFlight = false;
let tileCaptureInFlight = false;
let editPanelOpen = false;
let codexPanelExpanded = false;
let gameFavorited = initialFavorite;
let recordingInProgress = false;
let transcriptionInFlight = false;
let realtimePeerConnection = null;
let realtimeDataChannel = null;
let realtimeAudioStream = null;
let completedTranscriptionSegments = [];
const pendingOverlayWords = [];
let displayedOverlayWords = [];
let overlayWordDrainIntervalId = null;
const overlayWordDrainIntervalMs = 100;
let annotationPointerId = null;
let annotationStrokeInProgress = false;
let annotationHasInk = false;
let recordingStartGameScreenshotPngDataUrl = null;


function drawingContext() {
  const context = promptDrawingCanvas.getContext('2d');
  if (!context) {
    return null;
  }

  return context;
}

function resizeDrawingCanvas() {
  const width = Math.max(1, Math.round(promptDrawingCanvas.clientWidth));
  const height = Math.max(1, Math.round(promptDrawingCanvas.clientHeight));
  const nextDevicePixelRatio = typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0
    ? window.devicePixelRatio
    : 1;
  const nextWidth = Math.round(width * nextDevicePixelRatio);
  const nextHeight = Math.round(height * nextDevicePixelRatio);

  if (promptDrawingCanvas.width === nextWidth && promptDrawingCanvas.height === nextHeight) {
    return;
  }

  promptDrawingCanvas.width = nextWidth;
  promptDrawingCanvas.height = nextHeight;

  const context = drawingContext();
  if (!context) {
    return;
  }

  context.setTransform(nextDevicePixelRatio, 0, 0, nextDevicePixelRatio, 0, 0);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = annotationStrokeColor;
  context.lineWidth = annotationStrokeWidth;
}

function clearDrawingCanvas() {
  resizeDrawingCanvas();
  const context = drawingContext();
  if (!context) {
    return;
  }

  context.clearRect(0, 0, promptDrawingCanvas.width, promptDrawingCanvas.height);
  annotationHasInk = false;
}

function setAnnotationEnabled(enabled) {
  promptDrawingCanvas.classList.toggle('prompt-drawing-canvas--active', enabled);
  promptDrawingCanvas.setAttribute('aria-hidden', enabled ? 'false' : 'true');
  if (!enabled) {
    annotationPointerId = null;
    annotationStrokeInProgress = false;
  }
}

function pointerCoordinates(event) {
  const rect = promptDrawingCanvas.getBoundingClientRect();
  const clientX = typeof event.clientX === 'number' ? event.clientX : 0;
  const clientY = typeof event.clientY === 'number' ? event.clientY : 0;
  return {
    x: clientX - rect.left,
    y: clientY - rect.top
  };
}

function isPrimaryAnnotationPointer(event) {
  if (event.pointerType === 'mouse') {
    return event.button === 0;
  }

  return true;
}

function beginAnnotationStroke(event) {
  if (!recordingInProgress || annotationStrokeInProgress || !isPrimaryAnnotationPointer(event)) {
    return;
  }

  const context = drawingContext();
  if (!context || typeof event.pointerId !== 'number') {
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

  return promptDrawingCanvas.toDataURL('image/png');
}

function blankCanvasPngDataUrl(width, height) {
  if (typeof document.createElement !== 'function') {
    return null;
  }

  const blankCanvas = document.createElement('canvas');
  if (!(blankCanvas instanceof HTMLCanvasElement)) {
    return null;
  }

  blankCanvas.width = Math.max(1, width);
  blankCanvas.height = Math.max(1, height);

  try {
    return blankCanvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

function flushGameCanvasWebGlFrame() {
  if (!(gameCanvas instanceof HTMLCanvasElement) || typeof gameCanvas.getContext !== 'function') {
    return;
  }

  const webGlContext =
    gameCanvas.getContext('webgl2') ??
    gameCanvas.getContext('webgl') ??
    gameCanvas.getContext('experimental-webgl');
  if (!webGlContext || typeof webGlContext.finish !== 'function') {
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
  if (!(gameCanvas instanceof HTMLCanvasElement) || typeof gameCanvas.toDataURL !== 'function') {
    return null;
  }

  const attempts = Number.isFinite(maxAttempts) ? Math.max(1, Math.floor(maxAttempts)) : 1;
  const blankSnapshot = blankCanvasPngDataUrl(gameCanvas.width, gameCanvas.height);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await waitForNextAnimationFrame();
    flushGameCanvasWebGlFrame();

    try {
      const snapshot = gameCanvas.toDataURL('image/png');
      if (typeof snapshot !== 'string' || snapshot.length === 0) {
        continue;
      }

      if (blankSnapshot && snapshot === blankSnapshot && attempt < attempts - 1) {
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
    if (typeof dataUrl !== 'string' || dataUrl.trim().length === 0) {
      reject(new Error('Image data URL missing'));
      return;
    }

    const image = new Image();
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => reject(new Error('Image data URL failed to load')), { once: true });
    image.src = dataUrl;
  });
}

async function composePromptScreenshotPngDataUrl(baseGameScreenshotPngDataUrl = null) {
  const gameScreenshotPngDataUrl =
    typeof baseGameScreenshotPngDataUrl === 'string' && baseGameScreenshotPngDataUrl.trim().length > 0
      ? baseGameScreenshotPngDataUrl
      : await captureGameScreenshotPngDataUrl();
  if (!gameScreenshotPngDataUrl) {
    return null;
  }

  const annotationPngDataUrl = readAnnotationPngDataUrl();
  if (!annotationPngDataUrl) {
    return gameScreenshotPngDataUrl;
  }

  if (typeof document.createElement !== 'function') {
    return gameScreenshotPngDataUrl;
  }

  const compositeCanvas = document.createElement('canvas');
  if (!(compositeCanvas instanceof HTMLCanvasElement)) {
    return gameScreenshotPngDataUrl;
  }

  const compositeContext = compositeCanvas.getContext('2d');
  if (!compositeContext || typeof compositeContext.drawImage !== 'function') {
    return gameScreenshotPngDataUrl;
  }

  try {
    const [gameImage, annotationImage] = await Promise.all([
      loadDataUrlImage(gameScreenshotPngDataUrl),
      loadDataUrlImage(annotationPngDataUrl)
    ]);
    compositeCanvas.width = Math.max(1, gameImage.width);
    compositeCanvas.height = Math.max(1, gameImage.height);
    compositeContext.clearRect(0, 0, compositeCanvas.width, compositeCanvas.height);
    compositeContext.drawImage(gameImage, 0, 0, compositeCanvas.width, compositeCanvas.height);
    compositeContext.drawImage(annotationImage, 0, 0, compositeCanvas.width, compositeCanvas.height);
    return compositeCanvas.toDataURL('image/png');
  } catch {
    return gameScreenshotPngDataUrl;
  }
}

function applyFavoriteState() {
  favoriteButton.classList.toggle('game-view-icon-tab--active', gameFavorited);
  favoriteButton.setAttribute('aria-pressed', gameFavorited ? 'true' : 'false');
  favoriteButton.setAttribute('aria-label', gameFavorited ? 'Unfavorite game' : 'Favorite game');
}

function logRealtimeTranscription(message, details = undefined) {
  if (typeof console === 'undefined' || typeof console.log !== 'function') {
    return;
  }

  if (details === undefined) {
    console.log(`[realtime-transcription] ${message}`);
    return;
  }

  console.log(`[realtime-transcription] ${message}`, details);
}

function updateRecordButtonVisualState() {
  recordButton.classList.toggle('game-view-icon-tab--recording', recordingInProgress);
  recordButton.classList.toggle('game-view-icon-tab--busy', transcriptionInFlight);
  recordButton.disabled = transcriptionInFlight;

  if (recordingInProgress) {
    recordButton.setAttribute('aria-label', 'Stop voice recording');
    return;
  }

  recordButton.setAttribute('aria-label', 'Start voice recording');
}

function updateTileCaptureButtonVisualState() {
  tileCaptureButton.classList.toggle('game-view-icon-tab--busy', tileCaptureInFlight);
  tileCaptureButton.disabled = tileCaptureInFlight;
}

function stopAudioStream(stream) {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function closeRealtimeConnection() {
  if (realtimeDataChannel && typeof realtimeDataChannel.close === 'function') {
    realtimeDataChannel.close();
  }

  if (realtimePeerConnection && typeof realtimePeerConnection.close === 'function') {
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
  const overlayText = displayedOverlayWords.join(' ').trim();
  const shouldShowOverlay = !editPanelOpen && overlayText.length > 0;

  if (!(promptOverlay instanceof HTMLElement)) {
    return;
  }

  promptOverlay.textContent = shouldShowOverlay ? overlayText : '';
  promptOverlay.classList.toggle('prompt-overlay--visible', shouldShowOverlay);
  promptOverlay.setAttribute('aria-hidden', shouldShowOverlay ? 'false' : 'true');

  if (shouldShowOverlay) {
    window.requestAnimationFrame(() => {
      promptOverlay.scrollLeft = promptOverlay.scrollWidth;
    });
  }
}

function enqueueOverlayWords(transcriptSegment) {
  const words = transcriptSegment.split(/\s+/).map((word) => word.trim()).filter((word) => word.length > 0);
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
  if (typeof nextWord !== 'string' || nextWord.length === 0) {
    return;
  }

  displayedOverlayWords.push(nextWord);
  updatePromptOverlay();
}

function ensureOverlayWordDrainLoop() {
  if (typeof overlayWordDrainIntervalId === 'number') {
    return;
  }

  overlayWordDrainIntervalId = window.setInterval(() => {
    drainOverlayWord();
  }, overlayWordDrainIntervalMs);
}

function clearOverlayWordDrainLoop() {
  if (typeof overlayWordDrainIntervalId !== 'number') {
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

  if (editPanelOpen) {
    promptInput.value = completedTranscriptionSegments.join(' ').trim();
    resizePromptInput();
    focusPromptInput();
  }

  updatePromptOverlay();
}

function handleRealtimeDataChannelMessage(event) {
  if (!event || typeof event.data !== 'string') {
    return;
  }

  logRealtimeTranscription('data received', event.data);

  let payload;
  try {
    payload = JSON.parse(event.data);
  } catch {
    return;
  }

  if (!payload || typeof payload !== 'object' || typeof payload.type !== 'string') {
    return;
  }

  if (payload.type !== 'conversation.item.input_audio_transcription.completed') {
    return;
  }

  if (typeof payload.transcript === 'string') {
    appendCompletedTranscriptSegment(payload.transcript);
  }
}

function csrfRequestHeaders() {
  const headers = {};

  if (typeof csrfToken === 'string' && csrfToken.length > 0) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  return headers;
}

async function requestRealtimeClientSecret() {
  const response = await fetch('/api/transcribe', {
    method: 'POST',
    headers: csrfRequestHeaders()
  });

  if (!response.ok) {
    let errorDetails = `status ${response.status}`;
    try {
      const payload = await response.json();
      if (payload && typeof payload === 'object' && typeof payload.error === 'string' && payload.error.trim().length > 0) {
        errorDetails = `${errorDetails}: ${payload.error}`;
      }
    } catch {
      // Keep status-only detail when the response payload cannot be parsed.
    }

    logRealtimeTranscription('session request failed', errorDetails);
    throw new Error(`Realtime transcription session request failed: ${errorDetails}`);
  }

  const payload = await response.json();
  if (!payload || typeof payload !== 'object' || typeof payload.clientSecret !== 'string') {
    throw new Error('Realtime transcription session payload was invalid');
  }

  if (payload.clientSecret.trim().length === 0) {
    throw new Error('Realtime transcription session payload missing client secret');
  }

  if (typeof payload.model !== 'string' || payload.model.trim().length === 0) {
    throw new Error('Realtime transcription session payload missing model');
  }

  return {
    clientSecret: payload.clientSecret,
    model: payload.model.trim()
  };
}

async function requestRealtimeAnswerSdp(realtimeSession, offerSdp) {
  const requestBody = typeof offerSdp === 'string' ? offerSdp : '';
  const response = await fetch('https://api.openai.com/v1/realtime/calls', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${realtimeSession.clientSecret}`,
      'Content-Type': 'application/sdp'
    },
    body: requestBody
  });

  if (!response.ok) {
    throw new Error('Realtime transcription SDP exchange failed');
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
    const response = await fetch(`/api/games/${encodeURIComponent(versionId)}/favorite`, {
      method: 'POST',
      headers: csrfRequestHeaders()
    });
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    if (!payload || typeof payload !== 'object' || typeof payload.favorite !== 'boolean') {
      return;
    }

    gameFavorited = payload.favorite;
    document.body.dataset.gameFavorited = gameFavorited ? 'true' : 'false';
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

  const confirmed = window.confirm('Delete this game? This action cannot be undone.');
  if (!confirmed) {
    return;
  }

  deleteRequestInFlight = true;
  favoriteButton.disabled = true;
  deleteButton.disabled = true;

  try {
    const response = await fetch(`/api/games/${encodeURIComponent(versionId)}`, {
      method: 'DELETE',
      headers: csrfRequestHeaders()
    });

    if (!response.ok) {
      return;
    }

    window.location.assign('/');
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
  if (typeof tilePngDataUrl !== 'string' || tilePngDataUrl.length === 0) {
    return;
  }

  tileCaptureInFlight = true;
  updateTileCaptureButtonVisualState();

  try {
    const response = await fetch(`/api/games/${encodeURIComponent(versionId)}/tile-snapshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...csrfRequestHeaders()
      },
      body: JSON.stringify({ tilePngDataUrl })
    });
    if (!response.ok) {
      return;
    }
  } finally {
    tileCaptureInFlight = false;
    updateTileCaptureButtonVisualState();
  }
}

async function startRealtimeRecording() {
  if (!navigator?.mediaDevices?.getUserMedia) {
    return;
  }

  if (typeof RTCPeerConnection !== 'function') {
    return;
  }

  transcriptionInFlight = true;
  updateRecordButtonVisualState();
  ensureOverlayWordDrainLoop();
  completedTranscriptionSegments = [];
  clearTranscriptionDisplayBuffer();
  clearDrawingCanvas();
  recordingStartGameScreenshotPngDataUrl = await captureGameScreenshotPngDataUrl();
  setAnnotationEnabled(false);

  let peerConnection = null;
  let dataChannel = null;
  let stream = null;

  try {
    const realtimeSession = await requestRealtimeClientSecret();

    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    peerConnection = new RTCPeerConnection();
    dataChannel = peerConnection.createDataChannel('oai-events');
    dataChannel.addEventListener('message', handleRealtimeDataChannelMessage);

    for (const track of stream.getTracks()) {
      peerConnection.addTrack(track, stream);
    }

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const answerSdp = await requestRealtimeAnswerSdp(realtimeSession, offer.sdp);
    await peerConnection.setRemoteDescription({
      type: 'answer',
      sdp: answerSdp
    });

    realtimePeerConnection = peerConnection;
    realtimeDataChannel = dataChannel;
    realtimeAudioStream = stream;
    recordingInProgress = true;
    setAnnotationEnabled(true);
    logRealtimeTranscription('started');
  } catch {
    if (dataChannel && typeof dataChannel.close === 'function') {
      dataChannel.close();
    }

    if (peerConnection && typeof peerConnection.close === 'function') {
      peerConnection.close();
    }

    if (stream) {
      stopAudioStream(stream);
    }

    clearDrawingCanvas();
    setAnnotationEnabled(false);
    return;
  } finally {
    transcriptionInFlight = false;
    updateRecordButtonVisualState();
  }
}

async function stopRealtimeRecording() {
  if (!recordingInProgress) {
    return;
  }

  transcriptionInFlight = true;
  updateRecordButtonVisualState();

  try {
    if (realtimeDataChannel && realtimeDataChannel.readyState === 'open') {
      realtimeDataChannel.send(
        JSON.stringify({
          type: 'input_audio_buffer.commit'
        })
      );
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, 200);
    });

    const transcribedPrompt = completedTranscriptionSegments.join(' ').trim();
    const annotationPngDataUrl = readAnnotationPngDataUrl();
    const gameScreenshotPngDataUrl = await composePromptScreenshotPngDataUrl(recordingStartGameScreenshotPngDataUrl);
    if (!editPanelOpen && versionId && transcribedPrompt.length > 0) {
      await submitPrompt(transcribedPrompt, annotationPngDataUrl, gameScreenshotPngDataUrl);
      completedTranscriptionSegments = [];
      clearTranscriptionDisplayBuffer();
    }
  } finally {
    logRealtimeTranscription('stopped');
    logRealtimeTranscription('final transcribed text', promptInput.value);
    recordingInProgress = false;
    recordingStartGameScreenshotPngDataUrl = null;
    setAnnotationEnabled(false);
    closeRealtimeConnection();
    transcriptionInFlight = false;
    updateRecordButtonVisualState();
  }
}

function toggleRecording() {
  if (transcriptionInFlight) {
    return;
  }

  if (recordingInProgress) {
    void stopRealtimeRecording();
    return;
  }

  void startRealtimeRecording();
}

function updateEditDrawerHeight() {
  if (!(promptPanel instanceof HTMLElement)) {
    return;
  }

  const panelRectHeight =
    typeof promptPanel.getBoundingClientRect === 'function' ? promptPanel.getBoundingClientRect().height : 0;
  const panelOffsetHeight = typeof promptPanel.offsetHeight === 'number' ? promptPanel.offsetHeight : 0;
  const panelHeight = Math.ceil(Math.max(panelRectHeight, panelOffsetHeight));

  if (panelHeight <= 0) {
    return;
  }

  document.body.style.setProperty('--edit-drawer-height', `${panelHeight}px`);
}

function applyBottomPanelState() {
  promptPanel.classList.toggle('prompt-panel--open', editPanelOpen);
  promptPanel.setAttribute('aria-hidden', editPanelOpen ? 'false' : 'true');

  editTab.classList.toggle('game-view-tab--active', editPanelOpen);
  editTab.setAttribute('aria-expanded', editPanelOpen ? 'true' : 'false');

  codexToggle.setAttribute('aria-expanded', codexPanelExpanded ? 'true' : 'false');

  codexTranscript.classList.toggle('game-codex-transcript--open', codexPanelExpanded);
  codexTranscript.setAttribute('aria-hidden', codexPanelExpanded ? 'false' : 'true');

  document.body.classList.toggle('game-page--edit-open', editPanelOpen);
  document.body.classList.toggle('game-page--codex-expanded', codexPanelExpanded);

  if (editPanelOpen) {
    promptInput.value = completedTranscriptionSegments.join(' ').trim();
    resizePromptInput();
    updateEditDrawerHeight();
  }

  updatePromptOverlay();
}

function toggleEditPanel() {
  if (editPanelOpen) {
    editPanelOpen = false;
    codexPanelExpanded = false;
    applyBottomPanelState();
    return;
  }

  editPanelOpen = true;
  applyBottomPanelState();
  focusPromptInput();
}

function requestTranscriptScrollToBottom() {
  if (typeof transcriptPresenter.scrollToBottom !== 'function') {
    return;
  }

  window.requestAnimationFrame(() => {
    transcriptPresenter.scrollToBottom();
  });
}

function toggleCodexPanelExpanded() {
  if (!editPanelOpen) {
    editPanelOpen = true;
  }

  codexPanelExpanded = !codexPanelExpanded;
  applyBottomPanelState();

  if (codexPanelExpanded) {
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
  transcriptSignature = '';
}

function parseEyeState(value) {
  if (value === 'stopped' || value === 'idle' || value === 'generating' || value === 'error') {
    return value;
  }

  return null;
}

function applyEyeState(eyeState) {
  const isGenerating = eyeState === 'generating';
  if (isGenerating) {
    editTab.classList.add(generatingClassName);
  } else {
    editTab.classList.remove(generatingClassName);
  }

  editTab.setAttribute('aria-busy', isGenerating ? 'true' : 'false');
}

function buildTranscriptSignature(sessionId, messages) {
  const lastMessage = messages[messages.length - 1];
  const lastRole = typeof lastMessage?.role === 'string' ? lastMessage.role : '';
  const lastText = typeof lastMessage?.text === 'string' ? lastMessage.text : '';
  const lastTimestamp = typeof lastMessage?.timestamp === 'string' ? lastMessage.timestamp : '';
  return `${sessionId}:${messages.length}:${lastRole}:${lastTimestamp}:${lastText}`;
}

async function loadGameTranscript() {
  if (transcriptRequestInFlight) {
    return;
  }

  transcriptRequestInFlight = true;

  try {
    if (!versionId) {
      showTranscriptState('missing-version', 'Session unavailable', 'Game version id is missing from this page.');
      return;
    }

    let response;
    try {
      response = await fetch(`/api/codex-sessions/${encodeURIComponent(versionId)}`);
    } catch {
      showTranscriptState('fetch-failed', 'Session unavailable', 'Could not reach the server.');
      return;
    }

    if (!response.ok) {
      showTranscriptState(`bad-status-${response.status}`, 'Session unavailable', `Server returned ${response.status}.`);
      return;
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      showTranscriptState('invalid-json', 'Session unavailable', 'Invalid response payload.');
      return;
    }

    if (!payload || typeof payload !== 'object' || typeof payload.status !== 'string') {
      showTranscriptState('invalid-shape', 'Session unavailable', 'Unexpected response shape.');
      return;
    }

    const eyeState = parseEyeState(payload.eyeState);
    if (eyeState) {
      applyEyeState(eyeState);
    }

    if (payload.status === 'no-session') {
      showTranscriptState(
        'no-session',
        'No session linked',
        `This game version does not have a saved ${transcriptProviderLabel} session id yet.`
      );
      return;
    }

    if (payload.status === 'session-file-missing') {
      showTranscriptState(
        'session-file-missing',
        'Session file not found',
        'The linked session id exists in metadata but no matching JSONL file was found.'
      );
      return;
    }

    if (payload.status !== 'ok' || typeof payload.sessionId !== 'string' || !Array.isArray(payload.messages)) {
      showTranscriptState('invalid-transcript', 'Session unavailable', 'Unexpected transcript payload.');
      return;
    }

    const nextSignature = buildTranscriptSignature(payload.sessionId, payload.messages);
    const shouldRenderTranscript = transcriptStatusKey !== 'ok' || transcriptSignature !== nextSignature;
    if (!shouldRenderTranscript) {
      return;
    }

    transcriptPresenter.renderTranscript(payload.sessionId, payload.messages, { autoScrollToBottom: true });
    transcriptStatusKey = 'ok';
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
    'beforeunload',
    () => {
      window.clearInterval(intervalId);
    },
    { once: true }
  );
}

async function submitPrompt(prompt, annotationPngDataUrl = null, gameScreenshotPngDataUrl = null) {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (typeof csrfToken === 'string' && csrfToken.length > 0) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  const response = await fetch(`/api/games/${encodeURIComponent(versionId)}/prompts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      prompt,
      annotationPngDataUrl: typeof annotationPngDataUrl === 'string' ? annotationPngDataUrl : null,
      gameScreenshotPngDataUrl: typeof gameScreenshotPngDataUrl === 'string' ? gameScreenshotPngDataUrl : null
    })
  });

  if (!response.ok) {
    return;
  }

  const payload = await response.json();
  if (!payload || typeof payload !== 'object' || typeof payload.forkId !== 'string') {
    return;
  }

  window.location.assign(`/game/${encodeURIComponent(payload.forkId)}`);
}

applyBottomPanelState();
resizePromptInput();
updateEditDrawerHeight();
updateTileCaptureButtonVisualState();

editTab.addEventListener('click', () => {
  toggleEditPanel();
});

codexToggle.addEventListener('click', () => {
  toggleCodexPanelExpanded();
});

tileCaptureButton.addEventListener('click', () => {
  void captureTileSnapshot();
});

promptForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const prompt = promptInput.value;
  if (!versionId || prompt.trim().length === 0) {
    return;
  }

  void (async () => {
    const annotationPngDataUrl = readAnnotationPngDataUrl();
    const gameScreenshotPngDataUrl = await composePromptScreenshotPngDataUrl();
    await submitPrompt(prompt, annotationPngDataUrl, gameScreenshotPngDataUrl);
  })().catch(() => {
    // Keep prompt submit non-blocking if networking or payload parsing fails.
  });

  promptInput.value = '';
  resizePromptInput();
  completedTranscriptionSegments = [];
  clearTranscriptionDisplayBuffer();
  clearDrawingCanvas();
  setAnnotationEnabled(false);
  focusPromptInput();
});

function resizePromptInput() {
  if (!(promptInput instanceof HTMLElement) || !('style' in promptInput)) {
    return;
  }

  promptInput.style.height = 'auto';

  const computedPromptStyle = window.getComputedStyle(promptInput);
  const maxHeight = Number.parseFloat(computedPromptStyle.maxHeight);
  const nextHeight = typeof promptInput.scrollHeight === 'number' ? promptInput.scrollHeight : 0;
  const clampedHeight = Number.isFinite(maxHeight) && maxHeight > 0 ? Math.min(nextHeight, maxHeight) : nextHeight;

  if (clampedHeight > 0) {
    promptInput.style.height = `${clampedHeight}px`;
  }

  updateEditDrawerHeight();
}

promptInput.addEventListener('input', () => {
  resizePromptInput();
});

promptInput.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    promptForm.requestSubmit();
  }
});

window.addEventListener('resize', () => {
  resizePromptInput();
  resizeDrawingCanvas();
});

window.addEventListener(
  'beforeunload',
  () => {
    closeRealtimeConnection();
    clearOverlayWordDrainLoop();
  },
  { once: true }
);


resizeDrawingCanvas();
setAnnotationEnabled(false);

promptDrawingCanvas.addEventListener('pointerdown', (event) => {
  beginAnnotationStroke(event);
});

promptDrawingCanvas.addEventListener('pointermove', (event) => {
  extendAnnotationStroke(event);
});

promptDrawingCanvas.addEventListener('pointerup', (event) => {
  endAnnotationStroke(event);
});

promptDrawingCanvas.addEventListener('pointercancel', (event) => {
  endAnnotationStroke(event);
});

applyEyeState('stopped');

updateRecordButtonVisualState();
applyFavoriteState();

recordButton.addEventListener('click', () => {
  toggleRecording();
});

favoriteButton.addEventListener('click', () => {
  void toggleFavorite();
});

deleteButton.addEventListener('click', () => {
  void deleteGameVersion();
});
startTranscriptPolling();
