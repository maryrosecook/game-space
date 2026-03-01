import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createAdminSessionCookieHeader,
  createClearedAdminSessionCookieHeader,
  isAdminAuthenticatedFromCookieHeader,
  readAdminAuthConfigFromEnv,
  verifyAdminPassword,
} from './adminAuth';
import { readCodexTranscriptBySessionId } from './codexSessions';
import { isCodegenProvider } from './codegenConfig';
import {
  CSRF_FORM_FIELD_NAME,
  ensureCsrfTokenFromCookieHeader,
  isCsrfTokenValid,
  serializeCsrfTokenCookie,
} from './csrf';
import { reloadTokenPath } from './devLiveReload';
import { getCodexTurnInfo } from './codexTurnInfo';
import { isObjectRecord, pathExists } from './fsUtils';
import {
  gameDirectoryPath,
  hasGameDirectory,
  isSafeVersionId,
  readMetadataFile,
  resolveCodexSessionStatus,
  writeMetadataFile,
} from './gameVersions';
import { isAllowedGamesRuntimeAssetPath } from './gameAssetAllowlist';
import { generateIdeaPrompt } from './ideaGeneration';
import { readIdeasFile, writeIdeasFile } from './ideas';
import {
  DEFAULT_REALTIME_MODEL,
  OpenAiRealtimeTranscriptionSessionFactory,
} from './openaiTranscription';
import {
  captureTileSnapshotForGame,
  decodeAnnotationPngDataUrl,
  decodeGameScreenshotPngDataUrl,
  submitPromptForVersion,
} from './promptSubmission';
import {
  readSharedCodegenConfigStore,
  readSharedCodexRunner,
  readSharedIdeaGenerationRuntimeState,
  readSharedLoginAttemptLimiter,
} from './serverRuntimeState';
import { readTrustedClientIpFromWebRequest } from './trustedClientIp';

const TRANSCRIPTION_MODEL_UNAVAILABLE_PATTERN = /model_not_found|does not have access to model/i;
const IDEAS_STARTER_VERSION_ID = 'starter';
const STATIC_CONTENT_TYPE_BY_EXTENSION = new Map<string, string>([
  ['.aac', 'audio/aac'],
  ['.avif', 'image/avif'],
  ['.bmp', 'image/bmp'],
  ['.cjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.eot', 'application/vnd.ms-fontobject'],
  ['.flac', 'audio/flac'],
  ['.gif', 'image/gif'],
  ['.htm', 'text/html; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.m4a', 'audio/mp4'],
  ['.map', 'application/json; charset=utf-8'],
  ['.mov', 'video/quicktime'],
  ['.mp3', 'audio/mpeg'],
  ['.mp4', 'video/mp4'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.oga', 'audio/ogg'],
  ['.ogg', 'audio/ogg'],
  ['.ogv', 'video/ogg'],
  ['.otf', 'font/otf'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.wav', 'audio/wav'],
  ['.webm', 'video/webm'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

type RuntimePaths = {
  repoRootPath: string;
  gamesRootPath: string;
  buildPromptPath: string;
  ideationPromptPath: string;
  ideasPath: string;
  codexSessionsRootPath: string;
  claudeSessionsRootPath: string;
};

function readRuntimePaths(): RuntimePaths {
  const repoRootPath = process.cwd();
  return {
    repoRootPath,
    gamesRootPath: path.join(repoRootPath, 'games'),
    buildPromptPath: path.join(repoRootPath, 'game-build-prompt.md'),
    ideationPromptPath: path.join(repoRootPath, 'ideation.md'),
    ideasPath: path.join(repoRootPath, 'ideas.json'),
    codexSessionsRootPath: path.join(os.homedir(), '.codex', 'sessions'),
    claudeSessionsRootPath: path.join(os.homedir(), '.claude', 'projects'),
  };
}

function stripSearchAndHash(pathLike: string): string {
  const queryIndex = pathLike.indexOf('?');
  const hashIndex = pathLike.indexOf('#');
  let endIndex = pathLike.length;

  if (queryIndex >= 0) {
    endIndex = Math.min(endIndex, queryIndex);
  }

  if (hashIndex >= 0) {
    endIndex = Math.min(endIndex, hashIndex);
  }

  return pathLike.slice(0, endIndex);
}

function readRawPathnameFromRequestUrl(requestUrl: string): string {
  const schemeDelimiterIndex = requestUrl.indexOf('://');
  if (schemeDelimiterIndex < 0) {
    const pathname = stripSearchAndHash(requestUrl);
    return pathname.startsWith('/') ? pathname : `/${pathname}`;
  }

  const pathStartIndex = requestUrl.indexOf('/', schemeDelimiterIndex + 3);
  if (pathStartIndex < 0) {
    return '/';
  }

  return stripSearchAndHash(requestUrl.slice(pathStartIndex));
}

function readRequestPathWithinPrefix(request: Request, routePrefix: string): string | null {
  const pathname = readRawPathnameFromRequestUrl(request.url);
  if (pathname === routePrefix) {
    return '/';
  }

  const prefixedPath = `${routePrefix}/`;
  if (!pathname.startsWith(prefixedPath)) {
    return null;
  }

  return pathname.slice(routePrefix.length);
}

function decodePathSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function readDecodedPathSegments(requestPath: string): string[] | null {
  const rawSegments = requestPath.split('/').filter((segment) => segment.length > 0);
  const decodedSegments: string[] = [];

  for (const rawSegment of rawSegments) {
    const decodedSegment = decodePathSegment(rawSegment);
    if (typeof decodedSegment !== 'string') {
      return null;
    }

    decodedSegments.push(decodedSegment);
  }

  return decodedSegments;
}

function isUnsafePathSegment(segment: string): boolean {
  if (segment === '.' || segment === '..') {
    return true;
  }

  if (segment.startsWith('.')) {
    return true;
  }

  return segment.includes('/') || segment.includes('\\') || segment.includes('\u0000');
}

function readNodeErrorCode(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const code = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : null;
}

function staticFileContentType(assetPath: string): string {
  const extension = path.extname(assetPath).toLowerCase();
  return STATIC_CONTENT_TYPE_BY_EXTENSION.get(extension) ?? 'application/octet-stream';
}

async function staticFileResponse(assetPath: string): Promise<Response> {
  try {
    const body = await fs.readFile(assetPath);
    return createResponse({
      status: 200,
      body,
      contentType: staticFileContentType(assetPath),
    });
  } catch (error: unknown) {
    const errorCode = readNodeErrorCode(error);
    if (errorCode === 'ENOENT' || errorCode === 'ENOTDIR') {
      return textResponse(404, 'Not found');
    }

    throw error;
  }
}

function resolvePublicAssetPath(request: Request): string | null {
  const requestPath = readRequestPathWithinPrefix(request, '/public');
  if (requestPath === null) {
    return null;
  }

  const segments = readDecodedPathSegments(requestPath);
  if (!segments || segments.length === 0 || segments.some((segment) => isUnsafePathSegment(segment))) {
    return null;
  }

  const normalizedAssetPath = path.posix.normalize(segments.join('/'));
  if (
    normalizedAssetPath.length === 0 ||
    normalizedAssetPath === '.' ||
    normalizedAssetPath === '..' ||
    normalizedAssetPath.startsWith('../') ||
    normalizedAssetPath.startsWith('/')
  ) {
    return null;
  }

  const runtimePaths = readRuntimePaths();
  return path.join(runtimePaths.repoRootPath, 'src', 'public', ...normalizedAssetPath.split('/'));
}

function resolveGamesRuntimeAssetPath(request: Request): string | null {
  const requestPath = readRequestPathWithinPrefix(request, '/games');
  if (requestPath === null || !isAllowedGamesRuntimeAssetPath(requestPath)) {
    return null;
  }

  const segments = readDecodedPathSegments(requestPath);
  if (!segments || segments.length < 3) {
    return null;
  }

  const runtimePaths = readRuntimePaths();
  return path.join(runtimePaths.gamesRootPath, ...segments);
}

function readCookieHeader(request: Request): string | undefined {
  const cookieHeader = request.headers.get('cookie');
  return typeof cookieHeader === 'string' && cookieHeader.length > 0 ? cookieHeader : undefined;
}

function createResponse(options: {
  status: number;
  body: BodyInit | null;
  contentType: string;
  setCookieHeaders?: readonly string[];
  location?: string;
}): Response {
  const headers = new Headers({
    'content-type': options.contentType,
  });
  if (typeof options.location === 'string') {
    headers.set('location', options.location);
  }

  for (const setCookieHeader of options.setCookieHeaders ?? []) {
    headers.append('set-cookie', setCookieHeader);
  }

  return new Response(options.body, {
    status: options.status,
    headers,
  });
}

function htmlResponse(status: number, html: string, setCookieHeaders: readonly string[] = []): Response {
  return createResponse({
    status,
    body: html,
    contentType: 'text/html; charset=utf-8',
    setCookieHeaders,
  });
}

function jsonResponse(status: number, payload: unknown, setCookieHeaders: readonly string[] = []): Response {
  return createResponse({
    status,
    body: JSON.stringify(payload),
    contentType: 'application/json; charset=utf-8',
    setCookieHeaders,
  });
}

function textResponse(status: number, text: string, setCookieHeaders: readonly string[] = []): Response {
  return createResponse({
    status,
    body: text,
    contentType: 'text/plain; charset=utf-8',
    setCookieHeaders,
  });
}

function redirectResponse(location: string, status: number = 303, setCookieHeaders: readonly string[] = []): Response {
  return createResponse({
    status,
    body: '',
    contentType: 'text/plain; charset=utf-8',
    setCookieHeaders,
    location,
  });
}

function requestRateLimitKey(request: Request): string {
  return readTrustedClientIpFromWebRequest(request) ?? 'unknown';
}

function readTrimmedString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : null;
}

async function readFormData(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    return isObjectRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRequestCsrfValid(request: Request, requestToken: string | null): boolean {
  return isCsrfTokenValid({
    cookieHeader: readCookieHeader(request),
    hostHeader: request.headers.get('host'),
    originHeader: request.headers.get('origin'),
    refererHeader: request.headers.get('referer'),
    requestToken,
  });
}

function nextCsrfCookieHeader(): string {
  return serializeCsrfTokenCookie(randomBytes(32).toString('base64url'));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderAuthHtml(options: {
  isAdmin: boolean;
  csrfToken: string;
  codegenProvider: 'codex' | 'claude';
  claudeModel: string;
  claudeThinking: string;
  errorMessage?: string | null;
}): string {
  const escapedCsrfToken = escapeHtml(options.csrfToken);
  const escapedErrorMessage =
    typeof options.errorMessage === 'string' && options.errorMessage.length > 0
      ? `<p class="auth-error" role="alert">${escapeHtml(options.errorMessage)}</p>`
      : '';

  const statusMarkup = options.isAdmin
    ? `<p class="auth-status">Admin session is active.</p>
      ${options.codegenProvider === 'claude'
        ? `<p class="auth-provider-active">Active provider: Claude</p>
      <p class="auth-provider-active">Active model: ${escapeHtml(options.claudeModel)}</p>
      <p class="auth-provider-active">Thinking mode: ${escapeHtml(options.claudeThinking)}</p>`
        : '<p class="auth-provider-active">Active provider: Codex</p><p class="auth-provider-active">Active model: managed by Codex CLI</p>'}
      <form class="auth-form auth-form--provider" method="post" action="/auth/provider">
        <input type="hidden" name="csrfToken" value="${escapedCsrfToken}" />
        <label class="auth-label" for="codegen-provider">Codegen provider</label>
        <select id="codegen-provider" class="auth-input auth-select" name="provider">
          <option value="codex"${options.codegenProvider === 'codex' ? ' selected' : ''}>Codex</option>
          <option value="claude"${options.codegenProvider === 'claude' ? ' selected' : ''}>Claude</option>
        </select>
        <button class="auth-submit" type="submit">Save provider</button>
      </form>
      <form class="auth-form" method="post" action="/auth/logout">
        <input type="hidden" name="csrfToken" value="${escapedCsrfToken}" />
        <button class="auth-submit" type="submit">Logout</button>
      </form>`
    : `<p class="auth-status">Enter the admin password to unlock prompt and transcript tools.</p>
      <form class="auth-form" method="post" action="/auth/login">
        <input type="hidden" name="csrfToken" value="${escapedCsrfToken}" />
        <label class="auth-label" for="admin-password">Password</label>
        <input id="admin-password" class="auth-input" name="password" type="password" autocomplete="current-password" required />
        <button class="auth-submit" type="submit">Login</button>
      </form>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Admin Auth</title>
    <link rel="stylesheet" href="/public/styles.css" />
  </head>
  <body class="auth-page">
    <main class="auth-shell">
      <header class="page-header auth-header">
        <h1>Admin Auth</h1>
        <a class="auth-home-link" href="/">Back to games</a>
      </header>
      ${escapedErrorMessage}
      ${statusMarkup}
    </main>
  </body>
</html>`;
}

async function renderAuthPage(options: {
  request: Request;
  statusCode: number;
  isAdmin: boolean;
  errorMessage?: string | null;
}): Promise<Response> {
  const cookieHeader = readCookieHeader(options.request);
  const { token: csrfToken, setCookieHeader } = ensureCsrfTokenFromCookieHeader(cookieHeader);
  const codegenConfig = readSharedCodegenConfigStore().read();

  const html = renderAuthHtml({
    isAdmin: options.isAdmin,
    csrfToken,
    codegenProvider: codegenConfig.provider,
    claudeModel: codegenConfig.claudeModel,
    claudeThinking: codegenConfig.claudeThinking,
    errorMessage: options.errorMessage,
  });

  return htmlResponse(options.statusCode, html, setCookieHeader ? [setCookieHeader] : []);
}

async function requireAdminOr404(request: Request): Promise<boolean> {
  const authConfig = readAdminAuthConfigFromEnv();
  return isAdminAuthenticatedFromCookieHeader(readCookieHeader(request), authConfig);
}

export async function handleAuthGet(request: Request): Promise<Response> {
  const authConfig = readAdminAuthConfigFromEnv();
  const isAdmin = await isAdminAuthenticatedFromCookieHeader(readCookieHeader(request), authConfig);
  return renderAuthPage({
    request,
    statusCode: 200,
    isAdmin,
  });
}

export async function handleAuthLoginPost(request: Request): Promise<Response> {
  const authConfig = readAdminAuthConfigFromEnv();
  const formData = await readFormData(request);
  const requestCsrfToken = readTrimmedString(formData?.get(CSRF_FORM_FIELD_NAME) ?? null);

  if (!isRequestCsrfValid(request, requestCsrfToken)) {
    return renderAuthPage({
      request,
      statusCode: 403,
      isAdmin: false,
      errorMessage: 'Invalid CSRF token. Refresh and try again.',
    });
  }

  const loginAttemptLimiter = readSharedLoginAttemptLimiter();
  const limiterKey = requestRateLimitKey(request);
  const remainingBlockMs = loginAttemptLimiter.getBlockRemainingMs(limiterKey);
  if (remainingBlockMs > 0) {
    return renderAuthPage({
      request,
      statusCode: 429,
      isAdmin: false,
      errorMessage: 'Too many attempts. Wait a moment and try again.',
    });
  }

  const passwordInput = formData?.get('password');
  const normalizedPassword = typeof passwordInput === 'string' ? passwordInput : '';
  if (normalizedPassword.length === 0) {
    loginAttemptLimiter.registerFailure(limiterKey);
    return renderAuthPage({
      request,
      statusCode: 401,
      isAdmin: false,
      errorMessage: 'Invalid password.',
    });
  }

  const isValidPassword = await verifyAdminPassword(normalizedPassword, authConfig.passwordHash);
  if (!isValidPassword) {
    loginAttemptLimiter.registerFailure(limiterKey);
    return renderAuthPage({
      request,
      statusCode: 401,
      isAdmin: false,
      errorMessage: 'Invalid password.',
    });
  }

  loginAttemptLimiter.registerSuccess(limiterKey);
  const { cookieHeader: adminCookieHeader } = await createAdminSessionCookieHeader(authConfig.sessionSecret);

  return redirectResponse('/auth', 303, [adminCookieHeader, nextCsrfCookieHeader()]);
}

export async function handleAuthLogoutPost(request: Request): Promise<Response> {
  const authConfig = readAdminAuthConfigFromEnv();
  const isAdmin = await isAdminAuthenticatedFromCookieHeader(readCookieHeader(request), authConfig);
  if (!isAdmin) {
    return textResponse(404, 'Not found');
  }

  const formData = await readFormData(request);
  const requestCsrfToken = readTrimmedString(formData?.get(CSRF_FORM_FIELD_NAME) ?? null);
  if (!isRequestCsrfValid(request, requestCsrfToken)) {
    return renderAuthPage({
      request,
      statusCode: 403,
      isAdmin: true,
      errorMessage: 'Invalid CSRF token. Refresh and try again.',
    });
  }

  return redirectResponse('/auth', 303, [createClearedAdminSessionCookieHeader(), nextCsrfCookieHeader()]);
}

export async function handleAuthProviderPost(request: Request): Promise<Response> {
  const authConfig = readAdminAuthConfigFromEnv();
  const isAdmin = await isAdminAuthenticatedFromCookieHeader(readCookieHeader(request), authConfig);
  if (!isAdmin) {
    return textResponse(404, 'Not found');
  }

  const formData = await readFormData(request);
  const requestCsrfToken = readTrimmedString(formData?.get(CSRF_FORM_FIELD_NAME) ?? null);
  if (!isRequestCsrfValid(request, requestCsrfToken)) {
    return renderAuthPage({
      request,
      statusCode: 403,
      isAdmin: true,
      errorMessage: 'Invalid CSRF token. Refresh and try again.',
    });
  }

  const providerInput = formData?.get('provider');
  if (!isCodegenProvider(providerInput)) {
    return renderAuthPage({
      request,
      statusCode: 400,
      isAdmin: true,
      errorMessage: 'Invalid codegen provider.',
    });
  }

  readSharedCodegenConfigStore().setProvider(providerInput);
  return redirectResponse('/auth', 303);
}

export async function handlePublicAssetGet(request: Request): Promise<Response> {
  const publicAssetPath = resolvePublicAssetPath(request);
  if (!publicAssetPath) {
    return textResponse(404, 'Not found');
  }

  return staticFileResponse(publicAssetPath);
}

export async function handleGamesAssetGet(request: Request): Promise<Response> {
  const gamesAssetPath = resolveGamesRuntimeAssetPath(request);
  if (!gamesAssetPath) {
    return textResponse(404, 'Not found');
  }

  return staticFileResponse(gamesAssetPath);
}

function parseIdeaIndex(ideaIndex: string): number | null {
  const parsedIdeaIndex = Number.parseInt(ideaIndex, 10);
  if (!Number.isInteger(parsedIdeaIndex) || parsedIdeaIndex < 0) {
    return null;
  }

  return parsedIdeaIndex;
}

function readHeaderToken(request: Request): string | null {
  const headerToken = request.headers.get('x-csrf-token');
  if (typeof headerToken !== 'string') {
    return null;
  }

  const normalizedToken = headerToken.trim();
  return normalizedToken.length > 0 ? normalizedToken : null;
}

async function requireAdminMutationAccess(request: Request): Promise<Response | null> {
  if (!(await requireAdminOr404(request))) {
    return textResponse(404, 'Not found');
  }

  if (!isRequestCsrfValid(request, readHeaderToken(request))) {
    return jsonResponse(403, { error: 'Invalid CSRF token' });
  }

  return null;
}

export async function handleApiIdeasGet(request: Request): Promise<Response> {
  if (!(await requireAdminOr404(request))) {
    return textResponse(404, 'Not found');
  }

  const runtimePaths = readRuntimePaths();
  const ideas = await readIdeasFile(runtimePaths.ideasPath);
  return jsonResponse(200, {
    ideas,
    isGenerating: readSharedIdeaGenerationRuntimeState().isGenerating(),
  });
}

export async function handleApiIdeasGeneratePost(request: Request): Promise<Response> {
  const authFailureResponse = await requireAdminMutationAccess(request);
  if (authFailureResponse) {
    return authFailureResponse;
  }

  const runtimePaths = readRuntimePaths();
  const ideaGenerationRuntimeState = readSharedIdeaGenerationRuntimeState();
  const { requestId, abortController } = ideaGenerationRuntimeState.startRequest();

  try {
    const prompt = await generateIdeaPrompt(
      runtimePaths.buildPromptPath,
      runtimePaths.ideationPromptPath,
      runtimePaths.repoRootPath,
      abortController.signal,
    );

    const ideas = await readIdeasFile(runtimePaths.ideasPath);
    const nextIdeas = [{ prompt, hasBeenBuilt: false }, ...ideas];
    await writeIdeasFile(runtimePaths.ideasPath, nextIdeas);

    return jsonResponse(201, {
      prompt,
      ideas: nextIdeas,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'codex ideation command aborted') {
      return jsonResponse(409, { error: 'Idea generation replaced by newer request' });
    }

    throw error;
  } finally {
    ideaGenerationRuntimeState.clearIfCurrent(requestId);
  }
}

export async function handleApiIdeasBuildPost(request: Request, ideaIndex: string): Promise<Response> {
  const authFailureResponse = await requireAdminMutationAccess(request);
  if (authFailureResponse) {
    return authFailureResponse;
  }

  const parsedIdeaIndex = parseIdeaIndex(ideaIndex);
  if (parsedIdeaIndex === null) {
    return jsonResponse(400, { error: 'Invalid idea index' });
  }

  const runtimePaths = readRuntimePaths();
  if (!(await hasGameDirectory(runtimePaths.gamesRootPath, IDEAS_STARTER_VERSION_ID))) {
    return jsonResponse(503, { error: 'Starter game is not available' });
  }

  const ideas = await readIdeasFile(runtimePaths.ideasPath);
  if (parsedIdeaIndex >= ideas.length) {
    return jsonResponse(404, { error: 'Idea not found' });
  }

  const idea = ideas[parsedIdeaIndex];
  if (!idea) {
    return jsonResponse(404, { error: 'Idea not found' });
  }

  const submitResult = await submitPromptForVersion({
    gamesRootPath: runtimePaths.gamesRootPath,
    buildPromptPath: runtimePaths.buildPromptPath,
    codegenProvider: readSharedCodegenConfigStore().read().provider,
    versionId: IDEAS_STARTER_VERSION_ID,
    promptInput: idea.prompt,
    codexRunner: readSharedCodexRunner(),
    captureTileSnapshot: captureTileSnapshotForGame,
    logError: (message, error) => {
      console.error(message, error);
    },
  });

  const nextIdeas = ideas.map((entry, index) =>
    index === parsedIdeaIndex
      ? {
          ...entry,
          hasBeenBuilt: true,
        }
      : entry,
  );
  await writeIdeasFile(runtimePaths.ideasPath, nextIdeas);

  return jsonResponse(202, {
    forkId: submitResult.forkId,
    ideas: nextIdeas,
  });
}

export async function handleApiIdeasDelete(request: Request, ideaIndex: string): Promise<Response> {
  const authFailureResponse = await requireAdminMutationAccess(request);
  if (authFailureResponse) {
    return authFailureResponse;
  }

  const parsedIdeaIndex = parseIdeaIndex(ideaIndex);
  if (parsedIdeaIndex === null) {
    return jsonResponse(400, { error: 'Invalid idea index' });
  }

  const runtimePaths = readRuntimePaths();
  const ideas = await readIdeasFile(runtimePaths.ideasPath);
  if (parsedIdeaIndex >= ideas.length) {
    return jsonResponse(404, { error: 'Idea not found' });
  }

  const nextIdeas = ideas.filter((_entry, index) => index !== parsedIdeaIndex);
  await writeIdeasFile(runtimePaths.ideasPath, nextIdeas);

  return jsonResponse(200, {
    ideas: nextIdeas,
  });
}

export async function handleApiCodexSessionsGet(request: Request, versionId: string): Promise<Response> {
  if (!(await requireAdminOr404(request))) {
    return textResponse(404, 'Not found');
  }

  if (!isSafeVersionId(versionId)) {
    return jsonResponse(400, { error: 'Invalid version id' });
  }

  const runtimePaths = readRuntimePaths();
  if (!(await hasGameDirectory(runtimePaths.gamesRootPath, versionId))) {
    return jsonResponse(404, { error: 'Game version not found' });
  }

  const metadataPath = path.join(gameDirectoryPath(runtimePaths.gamesRootPath, versionId), 'metadata.json');
  const metadata = await readMetadataFile(metadataPath);
  if (!metadata) {
    return jsonResponse(404, { error: 'Game metadata not found' });
  }

  const codexSessionStatus = resolveCodexSessionStatus(metadata.codexSessionId ?? null, metadata.codexSessionStatus);
  const sessionRootPaths = [runtimePaths.codexSessionsRootPath, runtimePaths.claudeSessionsRootPath];
  const turnInfo = await getCodexTurnInfo({
    repoRootPath: runtimePaths.repoRootPath,
    worktreePath: gameDirectoryPath(runtimePaths.gamesRootPath, versionId),
    sessionsRootPath: sessionRootPaths,
    codexSessionStatus,
  });

  const codexSessionId = metadata.codexSessionId ?? null;
  if (!codexSessionId) {
    return jsonResponse(200, {
      status: 'no-session',
      versionId,
      codexSessionStatus,
      eyeState: turnInfo.eyeState,
    });
  }

  const messages = await readCodexTranscriptBySessionId(sessionRootPaths, codexSessionId);
  if (!messages) {
    return jsonResponse(200, {
      status: 'session-file-missing',
      versionId,
      sessionId: codexSessionId,
      codexSessionStatus,
      eyeState: turnInfo.eyeState,
    });
  }

  return jsonResponse(200, {
    status: 'ok',
    versionId,
    sessionId: codexSessionId,
    messages,
    codexSessionStatus,
    eyeState: turnInfo.eyeState,
    latestAssistantMessage: turnInfo.latestAssistantMessage,
  });
}

export async function handleApiTranscribePost(request: Request): Promise<Response> {
  const authFailureResponse = await requireAdminMutationAccess(request);
  if (authFailureResponse) {
    return authFailureResponse;
  }

  if (!process.env.OPENAI_API_KEY) {
    return jsonResponse(503, { error: 'OpenAI realtime transcription is not configured' });
  }

  try {
    const openAiRealtimeTranscriptionSessionFactory = new OpenAiRealtimeTranscriptionSessionFactory();
    const session = await openAiRealtimeTranscriptionSessionFactory.createSession();
    return jsonResponse(200, {
      clientSecret: session.clientSecret,
      expiresAt: session.expiresAt,
      model: session.model,
    });
  } catch (error: unknown) {
    console.error('OpenAI realtime transcription session request failed', error);
    if (error instanceof Error && TRANSCRIPTION_MODEL_UNAVAILABLE_PATTERN.test(error.message)) {
      return jsonResponse(503, {
        error: `OpenAI realtime model ${DEFAULT_REALTIME_MODEL} is unavailable for this API key`,
      });
    }

    return jsonResponse(502, {
      error: 'OpenAI realtime transcription session request failed',
    });
  }
}

export async function handleApiGameFavoritePost(request: Request, versionId: string): Promise<Response> {
  const authFailureResponse = await requireAdminMutationAccess(request);
  if (authFailureResponse) {
    return authFailureResponse;
  }

  if (!isSafeVersionId(versionId)) {
    return jsonResponse(400, { error: 'Invalid version id' });
  }

  const runtimePaths = readRuntimePaths();
  if (!(await hasGameDirectory(runtimePaths.gamesRootPath, versionId))) {
    return jsonResponse(404, { error: 'Game version not found' });
  }

  const metadataPath = path.join(gameDirectoryPath(runtimePaths.gamesRootPath, versionId), 'metadata.json');
  const metadata = await readMetadataFile(metadataPath);
  if (!metadata) {
    return jsonResponse(404, { error: 'Game metadata not found' });
  }

  const favorite = metadata.favorite !== true;
  await writeMetadataFile(metadataPath, {
    ...metadata,
    favorite,
  });

  return jsonResponse(200, {
    status: 'ok',
    versionId,
    favorite,
  });
}

export async function handleApiGameTileSnapshotPost(request: Request, versionId: string): Promise<Response> {
  const authFailureResponse = await requireAdminMutationAccess(request);
  if (authFailureResponse) {
    return authFailureResponse;
  }

  if (!isSafeVersionId(versionId)) {
    return jsonResponse(400, { error: 'Invalid version id' });
  }

  const runtimePaths = readRuntimePaths();
  if (!(await hasGameDirectory(runtimePaths.gamesRootPath, versionId))) {
    return jsonResponse(404, { error: 'Game version not found' });
  }

  const requestBody = await readJsonBody(request);
  const tilePngDataUrlInput = requestBody.tilePngDataUrl;
  if (typeof tilePngDataUrlInput !== 'string' || tilePngDataUrlInput.trim().length === 0) {
    return jsonResponse(400, { error: 'Tile snapshot must be a non-empty string' });
  }

  const tilePngBytes = decodeGameScreenshotPngDataUrl(tilePngDataUrlInput.trim());
  if (tilePngBytes === null) {
    return jsonResponse(400, {
      error: 'Tile snapshot must be a PNG data URL (data:image/png;base64,...)',
    });
  }

  const targetDirectoryPath = gameDirectoryPath(runtimePaths.gamesRootPath, versionId);
  const snapshotsDirectoryPath = path.join(targetDirectoryPath, 'snapshots');
  const tileSnapshotPath = path.join(snapshotsDirectoryPath, 'tile.png');
  await fs.mkdir(snapshotsDirectoryPath, { recursive: true });
  await fs.writeFile(tileSnapshotPath, tilePngBytes);

  return jsonResponse(200, {
    status: 'ok',
    versionId,
    tileSnapshotPath: `/games/${encodeURIComponent(versionId)}/snapshots/tile.png`,
  });
}

export async function handleApiGameDelete(request: Request, versionId: string): Promise<Response> {
  const authFailureResponse = await requireAdminMutationAccess(request);
  if (authFailureResponse) {
    return authFailureResponse;
  }

  if (!isSafeVersionId(versionId)) {
    return jsonResponse(400, { error: 'Invalid version id' });
  }

  const runtimePaths = readRuntimePaths();
  const directoryPath = gameDirectoryPath(runtimePaths.gamesRootPath, versionId);
  if (!(await hasGameDirectory(runtimePaths.gamesRootPath, versionId))) {
    return jsonResponse(404, { error: 'Game version not found' });
  }

  await fs.rm(directoryPath, { recursive: true, force: false });
  return jsonResponse(200, {
    status: 'ok',
    versionId,
  });
}

export async function handleApiGamePromptsPost(request: Request, versionId: string): Promise<Response> {
  const authFailureResponse = await requireAdminMutationAccess(request);
  if (authFailureResponse) {
    return authFailureResponse;
  }

  if (!isSafeVersionId(versionId)) {
    return jsonResponse(400, { error: 'Invalid version id' });
  }

  const runtimePaths = readRuntimePaths();
  if (!(await hasGameDirectory(runtimePaths.gamesRootPath, versionId))) {
    return jsonResponse(404, { error: 'Game version not found' });
  }

  const requestBody = await readJsonBody(request);

  const promptInput = requestBody.prompt;
  if (typeof promptInput !== 'string' || promptInput.trim().length === 0) {
    return jsonResponse(400, { error: 'Prompt must be a non-empty string' });
  }

  const annotationPngDataUrlInput = requestBody.annotationPngDataUrl;
  if (
    annotationPngDataUrlInput !== undefined &&
    annotationPngDataUrlInput !== null &&
    typeof annotationPngDataUrlInput !== 'string'
  ) {
    return jsonResponse(400, { error: 'Annotation pixels must be a string when provided' });
  }

  const annotationPngDataUrl =
    typeof annotationPngDataUrlInput === 'string' && annotationPngDataUrlInput.trim().length > 0
      ? annotationPngDataUrlInput.trim()
      : null;
  const annotationPngBytes =
    annotationPngDataUrl !== null ? decodeAnnotationPngDataUrl(annotationPngDataUrl) : null;
  if (annotationPngDataUrl !== null && annotationPngBytes === null) {
    return jsonResponse(400, {
      error: 'Annotation pixels must be a PNG data URL (data:image/png;base64,...)',
    });
  }

  const gameScreenshotPngDataUrlInput = requestBody.gameScreenshotPngDataUrl;
  if (
    gameScreenshotPngDataUrlInput !== undefined &&
    gameScreenshotPngDataUrlInput !== null &&
    typeof gameScreenshotPngDataUrlInput !== 'string'
  ) {
    return jsonResponse(400, { error: 'Game screenshot must be a string when provided' });
  }

  const gameScreenshotPngDataUrl =
    typeof gameScreenshotPngDataUrlInput === 'string' && gameScreenshotPngDataUrlInput.trim().length > 0
      ? gameScreenshotPngDataUrlInput.trim()
      : null;
  const gameScreenshotPngBytes =
    gameScreenshotPngDataUrl !== null
      ? decodeGameScreenshotPngDataUrl(gameScreenshotPngDataUrl)
      : null;
  if (gameScreenshotPngDataUrl !== null && gameScreenshotPngBytes === null) {
    return jsonResponse(400, {
      error: 'Game screenshot must be a PNG data URL (data:image/png;base64,...)',
    });
  }

  const submitResult = await submitPromptForVersion({
    gamesRootPath: runtimePaths.gamesRootPath,
    buildPromptPath: runtimePaths.buildPromptPath,
    codegenProvider: readSharedCodegenConfigStore().read().provider,
    versionId,
    promptInput,
    annotationPngDataUrl,
    annotationPngBytes,
    gameScreenshotPngDataUrl,
    gameScreenshotPngBytes,
    codexRunner: readSharedCodexRunner(),
    captureTileSnapshot: captureTileSnapshotForGame,
    logError: (message, error) => {
      console.error(message, error);
    },
  });

  return jsonResponse(202, {
    forkId: submitResult.forkId,
  });
}

export async function handleApiDevReloadTokenGet(versionId: string): Promise<Response> {
  if (process.env.GAME_SPACE_DEV_LIVE_RELOAD !== '1') {
    return textResponse(404, 'Not found');
  }

  if (!isSafeVersionId(versionId)) {
    return jsonResponse(400, { error: 'Invalid version id' });
  }

  const runtimePaths = readRuntimePaths();
  if (!(await hasGameDirectory(runtimePaths.gamesRootPath, versionId))) {
    return jsonResponse(404, { error: 'Game version not found' });
  }

  const tokenPath = reloadTokenPath(runtimePaths.gamesRootPath, versionId);
  if (!(await pathExists(tokenPath))) {
    return jsonResponse(404, { error: 'Reload token not found' });
  }

  const token = (await fs.readFile(tokenPath, 'utf8')).trim();
  if (token.length === 0) {
    return jsonResponse(404, { error: 'Reload token not found' });
  }

  return textResponse(200, token);
}
