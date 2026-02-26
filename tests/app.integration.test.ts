import { promises as fs } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { ADMIN_SESSION_COOKIE_NAME, ADMIN_SESSION_TTL_SECONDS } from '../src/services/adminAuth';
import { CSRF_COOKIE_NAME } from '../src/services/csrf';
import { reloadTokenPath } from '../src/services/devLiveReload';
import type { CodexRunOptions, CodexRunResult, CodexRunner } from '../src/services/promptExecution';
import type {
  OpenAiRealtimeTranscriptionSessionCreator,
  RealtimeTranscriptionSession
} from '../src/services/openaiTranscription';
import { createGameFixture, createTempDirectory } from './testHelpers';

const TEST_HOST = 'game-space.local';
const TEST_ORIGIN = `https://${TEST_HOST}`;
const TEST_ADMIN_PASSWORD = 'correct horse battery staple';
const TEST_ADMIN_PASSWORD_HASH =
  'scrypt$ASNFZ4mrze8BI0VniavN7w==$M+OVA7qtmUR3CHE87sPzm7h2MpJU1PXNk9qSpl2YPwHyaL8eByBbvuCTXEVTUVc/mwL9EhXgQ14qdOIyRUXu1Q==';
const TEST_ADMIN_SESSION_SECRET = 'session-secret-for-tests-must-be-long';
const TEST_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ0QAAAAASUVORK5CYII=';

const originalPasswordHash = process.env.GAME_SPACE_ADMIN_PASSWORD_HASH;
const originalSessionSecret = process.env.GAME_SPACE_ADMIN_SESSION_SECRET;
const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
const originalCodegenProvider = process.env.CODEGEN_PROVIDER;
const originalCodegenClaudeModel = process.env.CODEGEN_CLAUDE_MODEL;
const originalCodegenClaudeThinking = process.env.CODEGEN_CLAUDE_THINKING;

type CapturedRun = {
  prompt: string;
  cwd: string;
  imagePaths: string[];
};

class CapturingRunner implements CodexRunner {
  public readonly calls: CapturedRun[] = [];
  private readonly sessionId: string | null;

  constructor(sessionId: string | null = null) {
    this.sessionId = sessionId;
  }

  async run(prompt: string, cwd: string, options?: CodexRunOptions): Promise<CodexRunResult> {
    this.calls.push({
      prompt,
      cwd,
      imagePaths: Array.isArray(options?.imagePaths) ? [...options.imagePaths] : []
    });
    return {
      sessionId: this.sessionId,
      success: true,
      failureMessage: null
    };
  }
}

class FailingRunner implements CodexRunner {
  private readonly sessionId: string | null;

  constructor(sessionId: string | null = null) {
    this.sessionId = sessionId;
  }

  async run(prompt: string, cwd: string, options?: CodexRunOptions): Promise<CodexRunResult> {
    void prompt;
    void cwd;
    void options;
    return {
      sessionId: this.sessionId,
      success: false,
      failureMessage: 'codex exec failed with exit code 1: approval denied'
    };
  }
}

class CapturingRealtimeTranscriptionSessionCreator implements OpenAiRealtimeTranscriptionSessionCreator {
  public calls = 0;
  private readonly session: RealtimeTranscriptionSession;

  constructor(
    session: RealtimeTranscriptionSession = {
      clientSecret: 'ephemeral-token',
      expiresAt: 1_737_000_000,
      model: 'gpt-realtime-1.5'
    }
  ) {
    this.session = session;
  }

  async createSession(): Promise<RealtimeTranscriptionSession> {
    this.calls += 1;
    return this.session;
  }
}

class FailingRealtimeTranscriptionSessionCreator implements OpenAiRealtimeTranscriptionSessionCreator {
  async createSession(): Promise<RealtimeTranscriptionSession> {
    throw new Error('OpenAI rejected session creation');
  }
}

class ModelUnavailableRealtimeTranscriptionSessionCreator implements OpenAiRealtimeTranscriptionSessionCreator {
  async createSession(): Promise<RealtimeTranscriptionSession> {
    throw new Error('model_not_found: requested model was not found');
  }
}

class SessionCallbackOnlyRunner implements CodexRunner {
  private readonly sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async run(prompt: string, cwd: string, options?: CodexRunOptions): Promise<CodexRunResult> {
    void prompt;
    void cwd;
    options?.onSessionId?.(this.sessionId);

    return new Promise<CodexRunResult>(() => {
      // Simulate a long-running codex process that has started but not exited yet.
    });
  }
}

type StoredMetadata = {
  id: string;
  parentId: string | null;
  threeWords?: string;
  prompt?: string;
  createdTime: string;
  tileColor?: string;
  favorite?: boolean;
  codexSessionId?: string | null;
  codexSessionStatus?: 'none' | 'created' | 'stopped' | 'error';
};

type AuthSession = {
  cookies: Map<string, string>;
  cookieHeader: string;
  csrfToken: string;
};

function readSetCookieHeaders(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) {
    return value;
  }

  return typeof value === 'string' ? [value] : [];
}

function parseSetCookieHeaders(setCookieHeaders: readonly string[]): Map<string, string> {
  const cookies = new Map<string, string>();

  for (const header of setCookieHeaders) {
    const firstPart = header.split(';')[0];
    if (typeof firstPart !== 'string' || firstPart.length === 0) {
      continue;
    }

    const separatorIndex = firstPart.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const cookieName = firstPart.slice(0, separatorIndex);
    const rawValue = firstPart.slice(separatorIndex + 1);
    try {
      cookies.set(cookieName, decodeURIComponent(rawValue));
    } catch {
      cookies.set(cookieName, rawValue);
    }
  }

  return cookies;
}

function mergeCookies(base: ReadonlyMap<string, string>, updates: ReadonlyMap<string, string>): Map<string, string> {
  const merged = new Map(base);
  for (const [name, value] of updates) {
    merged.set(name, value);
  }

  return merged;
}

function serializeCookieHeader(cookies: ReadonlyMap<string, string>): string {
  return Array.from(cookies.entries())
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
}

function readCookieValue(cookies: ReadonlyMap<string, string>, cookieName: string): string {
  const value = cookies.get(cookieName);
  if (typeof value !== 'string') {
    throw new Error(`Expected cookie ${cookieName} to exist`);
  }

  return value;
}

function readCsrfTokenFromHtml(html: string): string {
  const csrfMatch = html.match(/name="csrfToken" value="([^"]+)"/);
  if (!csrfMatch || typeof csrfMatch[1] !== 'string') {
    throw new Error('Expected csrf token hidden field in HTML response');
  }

  return csrfMatch[1];
}

async function loginAsAdmin(app: express.Express, password: string = TEST_ADMIN_PASSWORD): Promise<AuthSession> {
  const authPageResponse = await request(app).get('/auth').set('Host', TEST_HOST).expect(200);
  const authPageCookies = parseSetCookieHeaders(readSetCookieHeaders(authPageResponse.headers['set-cookie']));
  const csrfToken = readCsrfTokenFromHtml(authPageResponse.text);

  const loginResponse = await request(app)
    .post('/auth/login')
    .set('Host', TEST_HOST)
    .set('Origin', TEST_ORIGIN)
    .set('Cookie', serializeCookieHeader(authPageCookies))
    .type('form')
    .send({
      password,
      csrfToken
    })
    .expect(303);

  const loginCookies = parseSetCookieHeaders(readSetCookieHeaders(loginResponse.headers['set-cookie']));
  const mergedCookies = mergeCookies(authPageCookies, loginCookies);
  const csrfCookieValue = readCookieValue(mergedCookies, CSRF_COOKIE_NAME);

  return {
    cookies: mergedCookies,
    cookieHeader: serializeCookieHeader(mergedCookies),
    csrfToken: csrfCookieValue
  };
}

async function postPromptAsAdmin(
  app: express.Express,
  authSession: AuthSession,
  sourceVersionId: string,
  prompt: string,
  csrfToken: string = authSession.csrfToken,
  annotationPngDataUrl: string | null = null,
  gameScreenshotPngDataUrl: string | null = null
): Promise<request.Response> {
  return request(app)
    .post(`/api/games/${encodeURIComponent(sourceVersionId)}/prompts`)
    .set('Host', TEST_HOST)
    .set('Origin', TEST_ORIGIN)
    .set('Cookie', authSession.cookieHeader)
    .set('X-CSRF-Token', csrfToken)
    .set('Content-Type', 'application/json')
    .send({ prompt, annotationPngDataUrl, gameScreenshotPngDataUrl });
}

async function readMetadata(metadataPath: string): Promise<StoredMetadata> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const serialized = await fs.readFile(metadataPath, 'utf8');
    try {
      return JSON.parse(serialized) as StoredMetadata;
    } catch (error: unknown) {
      if (!(error instanceof SyntaxError) || attempt === 4) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  throw new Error(`Unable to read metadata: ${metadataPath}`);
}

async function waitForSessionId(metadataPath: string, expectedSessionId: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const metadata = await readMetadata(metadataPath);
    if (metadata.codexSessionId === expectedSessionId) {
      return;
    }

    await delay(5);
  }

  throw new Error(`Session id ${expectedSessionId} was not persisted in time`);
}

async function waitForSessionStatus(
  metadataPath: string,
  expectedSessionStatus: 'none' | 'created' | 'stopped' | 'error'
): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const metadata = await readMetadata(metadataPath);
    if (metadata.codexSessionStatus === expectedSessionStatus) {
      return;
    }

    await delay(5);
  }

  throw new Error(`Session status ${expectedSessionStatus} was not persisted in time`);
}

async function waitForErrorLog(loggedErrors: readonly string[], expectedMessagePart: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (loggedErrors.some((message) => message.includes(expectedMessagePart))) {
      return;
    }

    await delay(5);
  }

  throw new Error(`Expected log containing "${expectedMessagePart}" was not emitted in time`);
}

beforeEach(() => {
  process.env.GAME_SPACE_ADMIN_PASSWORD_HASH = TEST_ADMIN_PASSWORD_HASH;
  process.env.GAME_SPACE_ADMIN_SESSION_SECRET = TEST_ADMIN_SESSION_SECRET;
  delete process.env.OPENAI_API_KEY;
  delete process.env.CODEGEN_PROVIDER;
  process.env.CODEGEN_CLAUDE_MODEL = 'claude-sonnet-4-6';
  process.env.CODEGEN_CLAUDE_THINKING = 'adaptive';
});

afterAll(() => {
  if (typeof originalPasswordHash === 'string') {
    process.env.GAME_SPACE_ADMIN_PASSWORD_HASH = originalPasswordHash;
  } else {
    delete process.env.GAME_SPACE_ADMIN_PASSWORD_HASH;
  }

  if (typeof originalSessionSecret === 'string') {
    process.env.GAME_SPACE_ADMIN_SESSION_SECRET = originalSessionSecret;
  } else {
    delete process.env.GAME_SPACE_ADMIN_SESSION_SECRET;
  }

  if (typeof originalOpenAiApiKey === 'string') {
    process.env.OPENAI_API_KEY = originalOpenAiApiKey;
  } else {
    delete process.env.OPENAI_API_KEY;
  }

  if (typeof originalCodegenProvider === 'string') {
    process.env.CODEGEN_PROVIDER = originalCodegenProvider;
  } else {
    delete process.env.CODEGEN_PROVIDER;
  }

  if (typeof originalCodegenClaudeModel === 'string') {
    process.env.CODEGEN_CLAUDE_MODEL = originalCodegenClaudeModel;
  } else {
    delete process.env.CODEGEN_CLAUDE_MODEL;
  }

  if (typeof originalCodegenClaudeThinking === 'string') {
    process.env.CODEGEN_CLAUDE_THINKING = originalCodegenClaudeThinking;
  } else {
    delete process.env.CODEGEN_CLAUDE_THINKING;
  }
});

describe('express app integration', () => {
  it('renders homepage in reverse chronological order and toggles auth CTA by session state', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-home-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'older-build',
        parentId: null,
        createdTime: '2026-01-01T00:00:00.000Z',
        favorite: true
      }
    });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'newer-game',
        parentId: 'older-build',
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    const app = createApp({
      gamesRootPath,
      buildPromptPath: path.join(process.cwd(), 'game-build-prompt.md')
    });

    const homepage = await request(app).get('/').set('Host', TEST_HOST).expect(200);
    expect(homepage.text).toContain('<title>Fountain</title>');
    expect(homepage.text).toContain('<h1>Fountain</h1>');
    expect(homepage.text).toContain('>Login<');
    expect(homepage.text).toContain('>older build<');
    expect(homepage.text).toContain('class="game-tile game-tile--favorite"');
    expect(homepage.text).not.toContain('>newer game<');
    expect(homepage.text).not.toContain('>newer-game<');
    expect(homepage.text).not.toContain('tile-created');
    expect(homepage.text).toContain('style="--tile-color: #1D3557;"');
    const olderIndex = homepage.text.indexOf('data-version-id="older-build"');
    expect(olderIndex).toBeGreaterThan(-1);
    const hiddenGameView = await request(app).get('/game/newer-game').set('Host', TEST_HOST).expect(200);
    expect(hiddenGameView.text).toContain('id="game-canvas"');

    const authSession = await loginAsAdmin(app);
    const adminHomepage = await request(app)
      .get('/')
      .set('Host', TEST_HOST)
      .set('Cookie', authSession.cookieHeader)
      .expect(200);
    expect(adminHomepage.text).toContain('>Admin<');
    expect(adminHomepage.text).toContain('>newer game<');
    const adminNewerIndex = adminHomepage.text.indexOf('data-version-id="newer-game"');
    const adminOlderIndex = adminHomepage.text.indexOf('data-version-id="older-build"');
    expect(adminNewerIndex).toBeGreaterThan(-1);
    expect(adminOlderIndex).toBeGreaterThan(adminNewerIndex);

    const css = await request(app).get('/public/styles.css').expect(200);
    expect(css.text).toContain('grid-template-columns: repeat(auto-fit, minmax(min(100%, 90px), 1fr));');
    expect(css.text).toContain('--render-aspect-width: 9;');
    expect(css.text).toContain('--bottom-tab-height: 68px;');
    expect(css.text).toContain('--game-top-strip-height: 5px;');
    expect(css.text).toContain('--game-layout-height: calc(100dvh - var(--bottom-tab-height) - var(--game-top-strip-height));');
    expect(css.text).toContain('border-radius: 18px 18px 0 0;');
    expect(css.text).toContain('overflow-wrap: anywhere;');
    expect(css.text).toContain('.game-page--codex-expanded .prompt-panel');
    expect(css.text).not.toContain('border-bottom-left-radius: 0;');
    expect(css.text).not.toContain('border-bottom-right-radius: 0;');
    expect(css.text).toContain(
      'width: min(100%, calc(var(--game-layout-height) * var(--render-aspect-width) / var(--render-aspect-height)));'
    );
    expect(css.text).toContain(
      'flex: 0 0 min(calc(var(--game-layout-height) * var(--render-aspect-width) / var(--render-aspect-height)), 58vw);'
    );
    expect(css.text).toContain('.codex-session-view--game');
    expect(css.text).toContain('.game-view-tab-spinner');
    expect(css.text).toContain('display: none;');
    expect(css.text).toContain('border: 2px solid transparent;');
    expect(css.text).toContain('border-top-color: #f7f9ff;');
    expect(css.text).toContain('.game-view-tab--edit');
    expect(css.text).toContain('gap: 16px;');
    expect(css.text).toContain('.game-home-link');
    expect(css.text).toContain('align-self: center;');
    expect(css.text).toContain('padding: 16px;');
    expect(css.text).toContain('.game-tile--favorite');
    expect(css.text).toContain('border-color: #facc15;');
    expect(css.text).toContain('.game-view-icon-tab');
    expect(css.text).toContain('border: 0;');
    expect(css.text).toContain('background: transparent;');
    expect(css.text).toContain('.prompt-overlay {');
    expect(css.text).toContain('overflow-y: auto;');
    expect(css.text).toContain('text-align: left;');
    expect(css.text).toContain('font-size: clamp(1.36rem, 4vw, 2.88rem);');
    expect(css.text).toContain('.prompt-overlay--visible {');
    expect(css.text).toContain('display: block;');
    expect(css.text).toContain('.game-view-tab--generating .game-view-tab-spinner');
    expect(css.text).toContain('display: inline-block;');
    expect(css.text).not.toContain('game-tab-spinner-flash');
  });

  it('renders auth page with login form while logged out', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-auth-page-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    const app = createApp({
      gamesRootPath,
      buildPromptPath: path.join(process.cwd(), 'game-build-prompt.md')
    });

    const response = await request(app).get('/auth').set('Host', TEST_HOST).expect(200);
    expect(response.text).toContain('Enter the admin password');
    expect(response.text).toContain('action="/auth/login"');
    expect(response.text).not.toContain('action="/auth/provider"');
    expect(response.text).not.toContain('Codegen provider');
    expect(response.text).toContain('name="csrfToken"');

    const setCookieHeaders = readSetCookieHeaders(response.headers['set-cookie']);
    expect(setCookieHeaders.some((header) => header.startsWith(`${CSRF_COOKIE_NAME}=`))).toBe(true);
  });

  it('sets secure fixed-TTL admin session cookie on successful login', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-auth-login-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    const app = createApp({
      gamesRootPath,
      buildPromptPath: path.join(process.cwd(), 'game-build-prompt.md')
    });

    const authPage = await request(app).get('/auth').set('Host', TEST_HOST).expect(200);
    const csrfToken = readCsrfTokenFromHtml(authPage.text);
    const authCookies = parseSetCookieHeaders(readSetCookieHeaders(authPage.headers['set-cookie']));

    const loginResponse = await request(app)
      .post('/auth/login')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', serializeCookieHeader(authCookies))
      .type('form')
      .send({
        password: TEST_ADMIN_PASSWORD,
        csrfToken
      })
      .expect(303);

    const setCookieHeaders = readSetCookieHeaders(loginResponse.headers['set-cookie']);
    const adminCookie = setCookieHeaders.find((header) => header.startsWith(`${ADMIN_SESSION_COOKIE_NAME}=`));
    expect(typeof adminCookie).toBe('string');
    expect(adminCookie).toContain('HttpOnly');
    expect(adminCookie).toContain('Secure');
    expect(adminCookie).toContain('SameSite=Strict');
    expect(adminCookie).toContain(`Max-Age=${ADMIN_SESSION_TTL_SECONDS}`);
    expect(loginResponse.headers.location).toBe('/auth');
  });

  it('rejects invalid login attempts and does not authenticate', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-auth-invalid-login-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    const app = createApp({
      gamesRootPath,
      buildPromptPath: path.join(process.cwd(), 'game-build-prompt.md')
    });

    const authPage = await request(app).get('/auth').set('Host', TEST_HOST).expect(200);
    const csrfToken = readCsrfTokenFromHtml(authPage.text);
    const authCookies = parseSetCookieHeaders(readSetCookieHeaders(authPage.headers['set-cookie']));

    const loginResponse = await request(app)
      .post('/auth/login')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', serializeCookieHeader(authCookies))
      .type('form')
      .send({
        password: 'wrong password',
        csrfToken
      })
      .expect(401);

    expect(loginResponse.text).toContain('Invalid password.');

    const protectedResponse = await request(app)
      .get('/codex')
      .set('Host', TEST_HOST)
      .set('Cookie', serializeCookieHeader(authCookies))
      .expect(404);

    expect(protectedResponse.text).toContain('Not found');
  });

  it('clears the admin session cookie on logout', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-auth-logout-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    const app = createApp({
      gamesRootPath,
      buildPromptPath: path.join(process.cwd(), 'game-build-prompt.md')
    });

    const authSession = await loginAsAdmin(app);

    const logoutResponse = await request(app)
      .post('/auth/logout')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', authSession.cookieHeader)
      .type('form')
      .send({ csrfToken: authSession.csrfToken })
      .expect(303);

    const logoutSetCookieHeaders = readSetCookieHeaders(logoutResponse.headers['set-cookie']);
    const logoutSessionCookie = logoutSetCookieHeaders.find((header) =>
      header.startsWith(`${ADMIN_SESSION_COOKIE_NAME}=`)
    );
    expect(typeof logoutSessionCookie).toBe('string');
    expect(logoutSessionCookie).toContain('Max-Age=0');
    expect(logoutSessionCookie).toContain('Secure');

    const loggedOutCookies = mergeCookies(authSession.cookies, parseSetCookieHeaders(logoutSetCookieHeaders));
    await request(app)
      .get('/codex')
      .set('Host', TEST_HOST)
      .set('Cookie', serializeCookieHeader(loggedOutCookies))
      .expect(404);
  });

  it('lets authenticated admins switch codegen provider from the auth page', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-auth-provider-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'v1',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    const app = createApp({
      gamesRootPath,
      buildPromptPath: path.join(process.cwd(), 'game-build-prompt.md')
    });

    const authSession = await loginAsAdmin(app);

    const adminAuthPage = await request(app)
      .get('/auth')
      .set('Host', TEST_HOST)
      .set('Cookie', authSession.cookieHeader)
      .expect(200);
    expect(adminAuthPage.text).toContain('action="/auth/provider"');
    expect(adminAuthPage.text).toContain('Active provider: Codex');
    expect(adminAuthPage.text).toContain('value="codex" selected');

    const switchResponse = await request(app)
      .post('/auth/provider')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', authSession.cookieHeader)
      .type('form')
      .send({
        provider: 'claude',
        csrfToken: authSession.csrfToken
      })
      .expect(303);
    expect(switchResponse.headers.location).toBe('/auth');

    const switchedAuthPage = await request(app)
      .get('/auth')
      .set('Host', TEST_HOST)
      .set('Cookie', authSession.cookieHeader)
      .expect(200);
    expect(switchedAuthPage.text).toContain('Active provider: Claude');
    expect(switchedAuthPage.text).toContain('Active model: claude-sonnet-4-6');
    expect(switchedAuthPage.text).toContain('Thinking mode: adaptive');
    expect(switchedAuthPage.text).toContain('value="claude" selected');

    const adminGameView = await request(app)
      .get('/game/v1')
      .set('Host', TEST_HOST)
      .set('Cookie', authSession.cookieHeader)
      .expect(200);
    expect(adminGameView.text).toContain('data-codegen-provider="claude"');
    expect(adminGameView.text).toContain('aria-label="Build prompt"');
    expect(adminGameView.text).toContain('aria-label="Toggle Claude session"');
    expect(adminGameView.text).toContain('<span>Build</span>');
    expect(adminGameView.text).not.toContain('<span>Submit</span>');
    expect(adminGameView.text).not.toContain('>Transcript</span>');
    expect(adminGameView.text).toContain('<h2>Claude Transcript</h2>');

    const claudeCodexPage = await request(app)
      .get('/codex')
      .set('Host', TEST_HOST)
      .set('Cookie', authSession.cookieHeader)
      .expect(200);
    expect(claudeCodexPage.text).toContain('data-codegen-provider="claude"');
    expect(claudeCodexPage.text).toContain('Select a game version to inspect its Claude transcript.');

    await request(app)
      .post('/auth/provider')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', authSession.cookieHeader)
      .type('form')
      .send({
        provider: 'codex',
        csrfToken: authSession.csrfToken
      })
      .expect(303);

    const codexGameView = await request(app)
      .get('/game/v1')
      .set('Host', TEST_HOST)
      .set('Cookie', authSession.cookieHeader)
      .expect(200);
    expect(codexGameView.text).toContain('data-codegen-provider="codex"');
    expect(codexGameView.text).toContain('aria-label="Build prompt"');
    expect(codexGameView.text).toContain('aria-label="Toggle Codex session"');
    expect(codexGameView.text).toContain('<span>Build</span>');
    expect(codexGameView.text).not.toContain('<span>Submit</span>');
    expect(codexGameView.text).not.toContain('>Transcript</span>');
    expect(codexGameView.text).toContain('<h2>Codex Transcript</h2>');

    const codexPage = await request(app)
      .get('/codex')
      .set('Host', TEST_HOST)
      .set('Cookie', authSession.cookieHeader)
      .expect(200);
    expect(codexPage.text).toContain('data-codegen-provider="codex"');
    expect(codexPage.text).toContain('Select a game version to inspect its Codex transcript.');
  });

  it('creates realtime transcription sessions for admin users', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-transcribe-');
    await createGameFixture({
      gamesRootPath: path.join(tempDirectoryPath, 'games'),
      metadata: {
        id: 'source',
        parentId: null,
        createdTime: new Date().toISOString()
      }
    });
    const sessionCreator = new CapturingRealtimeTranscriptionSessionCreator({
      clientSecret: 'realtime-token',
      expiresAt: 1_737_000_321,
      model: 'gpt-realtime-1.5'
    });

    const app = createApp({
      repoRootPath: tempDirectoryPath,
      gamesRootPath: path.join(tempDirectoryPath, 'games'),
      buildPromptPath: path.join(tempDirectoryPath, 'game-build-prompt.md'),
      codexRunner: new CapturingRunner(),
      openAiRealtimeTranscriptionSessionCreator: sessionCreator
    });

    const authSession = await loginAsAdmin(app);

    const response = await request(app)
      .post('/api/transcribe')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', authSession.cookieHeader)
      .set('X-CSRF-Token', authSession.csrfToken)
      .expect(200);

    expect(response.body).toEqual({
      clientSecret: 'realtime-token',
      expiresAt: 1_737_000_321,
      model: 'gpt-realtime-1.5'
    });
    expect(sessionCreator.calls).toBe(1);
  });

  it('returns 503 when realtime transcription is not configured', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-transcribe-missing-');
    await createGameFixture({
      gamesRootPath: path.join(tempDirectoryPath, 'games'),
      metadata: {
        id: 'source',
        parentId: null,
        createdTime: new Date().toISOString()
      }
    });

    const app = createApp({
      repoRootPath: tempDirectoryPath,
      gamesRootPath: path.join(tempDirectoryPath, 'games'),
      buildPromptPath: path.join(tempDirectoryPath, 'game-build-prompt.md'),
      codexRunner: new CapturingRunner()
    });

    const authSession = await loginAsAdmin(app);

    const response = await request(app)
      .post('/api/transcribe')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', authSession.cookieHeader)
      .set('X-CSRF-Token', authSession.csrfToken)
      .expect(503);

    expect(response.body).toEqual({ error: 'OpenAI realtime transcription is not configured' });
  });

  it('returns 502 when realtime transcription session creation fails', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-transcribe-failure-');
    await createGameFixture({
      gamesRootPath: path.join(tempDirectoryPath, 'games'),
      metadata: {
        id: 'source',
        parentId: null,
        createdTime: new Date().toISOString()
      }
    });

    const app = createApp({
      repoRootPath: tempDirectoryPath,
      gamesRootPath: path.join(tempDirectoryPath, 'games'),
      buildPromptPath: path.join(tempDirectoryPath, 'game-build-prompt.md'),
      codexRunner: new CapturingRunner(),
      openAiRealtimeTranscriptionSessionCreator: new FailingRealtimeTranscriptionSessionCreator(),
      logError: () => {}
    });

    const authSession = await loginAsAdmin(app);

    const response = await request(app)
      .post('/api/transcribe')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', authSession.cookieHeader)
      .set('X-CSRF-Token', authSession.csrfToken)
      .expect(502);

    expect(response.body).toEqual({ error: 'OpenAI realtime transcription session request failed' });
  });

  it('returns 503 when gpt-realtime-1.5 is unavailable for the API key', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-transcribe-model-unavailable-');
    await createGameFixture({
      gamesRootPath: path.join(tempDirectoryPath, 'games'),
      metadata: {
        id: 'source',
        parentId: null,
        createdTime: new Date().toISOString()
      }
    });

    const app = createApp({
      repoRootPath: tempDirectoryPath,
      gamesRootPath: path.join(tempDirectoryPath, 'games'),
      buildPromptPath: path.join(tempDirectoryPath, 'game-build-prompt.md'),
      codexRunner: new CapturingRunner(),
      openAiRealtimeTranscriptionSessionCreator: new ModelUnavailableRealtimeTranscriptionSessionCreator(),
      logError: () => {}
    });

    const authSession = await loginAsAdmin(app);

    const response = await request(app)
      .post('/api/transcribe')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', authSession.cookieHeader)
      .set('X-CSRF-Token', authSession.csrfToken)
      .expect(503);

    expect(response.body).toEqual({ error: 'OpenAI realtime model gpt-realtime-1.5 is unavailable for this API key' });
  });

  it('returns 404 for protected routes when unauthenticated', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-auth-gating-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'v1',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    const app = createApp({
      gamesRootPath,
      buildPromptPath: path.join(process.cwd(), 'game-build-prompt.md')
    });

    await request(app).get('/codex').set('Host', TEST_HOST).expect(404);
    await request(app).get('/api/codex-sessions/v1').set('Host', TEST_HOST).expect(404);
    await request(app)
      .post('/api/games/v1/favorite')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .expect(404);
    await request(app)
      .post('/api/games/v1/prompts')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Content-Type', 'application/json')
      .send({ prompt: 'add gravity' })
      .expect(404);
  });

  it('allows protected codex page and transcript API when authenticated', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-codex-auth-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    const codexSessionsRootPath = path.join(tempDirectoryPath, 'codex-sessions');
    await fs.mkdir(gamesRootPath, { recursive: true });

    const sessionId = '019c48a7-3918-7123-bc60-0d7cddb4d5d4';
    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'v1',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z',
        codexSessionId: sessionId
      }
    });

    const sessionDirectoryPath = path.join(codexSessionsRootPath, '2026', '02', '10');
    await fs.mkdir(sessionDirectoryPath, { recursive: true });
    await fs.writeFile(
      path.join(sessionDirectoryPath, `rollout-2026-02-10T10-00-00-${sessionId}.jsonl`),
      [
        `{"type":"session_meta","payload":{"cwd":"${path.join(gamesRootPath, 'v1').replaceAll('\\', '\\\\')}"}}`,
        '{"timestamp":"2026-02-10T10:00:00.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"add gravity"}]}}',
        '{"timestamp":"2026-02-10T10:00:01.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Adding gravity now."}]}}'
      ].join('\n') + '\n',
      'utf8'
    );

    const app = createApp({
      gamesRootPath,
      codexSessionsRootPath,
      buildPromptPath: path.join(process.cwd(), 'game-build-prompt.md')
    });

    const authSession = await loginAsAdmin(app);

    const codexPage = await request(app)
      .get('/codex')
      .set('Host', TEST_HOST)
      .set('Cookie', authSession.cookieHeader)
      .expect(200);
    expect(codexPage.text).toContain('id="codex-game-select"');

    const response = await request(app)
      .get('/api/codex-sessions/v1')
      .set('Host', TEST_HOST)
      .set('Cookie', authSession.cookieHeader)
      .expect(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.sessionId).toBe(sessionId);
    expect(response.body.codexSessionStatus).toBe('stopped');
    expect(response.body.eyeState).toBe('idle');
    expect(response.body.messages).toEqual([
      {
        role: 'user',
        text: 'add gravity',
        timestamp: '2026-02-10T10:00:00.000Z'
      },
      {
        role: 'assistant',
        text: 'Adding gravity now.',
        timestamp: '2026-02-10T10:00:01.000Z'
      }
    ]);
  });

  it('reads claude transcript files through the existing codex sessions endpoint', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-claude-transcript-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    const codexSessionsRootPath = path.join(tempDirectoryPath, 'codex-sessions');
    const claudeSessionsRootPath = path.join(tempDirectoryPath, 'claude-projects');
    await fs.mkdir(gamesRootPath, { recursive: true });
    await fs.mkdir(codexSessionsRootPath, { recursive: true });

    const sessionId = '77e122f3-31c9-4f14-acd4-886d3d8479af';
    const versionId = 'v1';
    const worktreePath = path.join(gamesRootPath, versionId);
    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: versionId,
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z',
        codexSessionId: sessionId
      }
    });

    const claudeProjectPath = path.join(claudeSessionsRootPath, '-Users-test-project');
    await fs.mkdir(claudeProjectPath, { recursive: true });
    const escapedWorktreePath = worktreePath.replaceAll('\\', '\\\\');
    await fs.writeFile(
      path.join(claudeProjectPath, `${sessionId}.jsonl`),
      [
        `{"timestamp":"2026-02-10T10:00:00.000Z","cwd":"${escapedWorktreePath}","sessionId":"${sessionId}","type":"user","message":{"role":"user","content":"add gravity"}}`,
        `{"timestamp":"2026-02-10T10:00:01.000Z","cwd":"${escapedWorktreePath}","sessionId":"${sessionId}","type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Gravity added."}]}}`
      ].join('\n') + '\n',
      'utf8'
    );

    const app = createApp({
      gamesRootPath,
      codexSessionsRootPath,
      claudeSessionsRootPath,
      buildPromptPath: path.join(process.cwd(), 'game-build-prompt.md')
    });

    const authSession = await loginAsAdmin(app);
    const response = await request(app)
      .get('/api/codex-sessions/v1')
      .set('Host', TEST_HOST)
      .set('Cookie', authSession.cookieHeader)
      .expect(200);

    expect(response.body.status).toBe('ok');
    expect(response.body.sessionId).toBe(sessionId);
    expect(response.body.codexSessionStatus).toBe('stopped');
    expect(response.body.eyeState).toBe('idle');
    expect(response.body.messages).toEqual([
      {
        role: 'user',
        text: 'add gravity',
        timestamp: '2026-02-10T10:00:00.000Z'
      },
      {
        role: 'assistant',
        text: 'Gravity added.',
        timestamp: '2026-02-10T10:00:01.000Z'
      }
    ]);
  });

  it('returns no-session runtime state when metadata has no linked codex session', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-codex-no-session-state-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'v1',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    const app = createApp({
      gamesRootPath,
      buildPromptPath: path.join(process.cwd(), 'game-build-prompt.md')
    });

    const authSession = await loginAsAdmin(app);
    const response = await request(app)
      .get('/api/codex-sessions/v1')
      .set('Host', TEST_HOST)
      .set('Cookie', authSession.cookieHeader)
      .expect(200);

    expect(response.body).toEqual({
      status: 'no-session',
      versionId: 'v1',
      codexSessionStatus: 'none',
      eyeState: 'stopped'
    });
  });

  it('returns session-file-missing runtime state when linked session file is absent', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-codex-missing-file-state-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    const codexSessionsRootPath = path.join(tempDirectoryPath, 'codex-sessions');
    await fs.mkdir(gamesRootPath, { recursive: true });
    await fs.mkdir(codexSessionsRootPath, { recursive: true });

    const sessionId = '019c48a7-3918-7123-bc60-0d7cddb4d5d4';
    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'v1',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z',
        codexSessionId: sessionId
      }
    });

    const app = createApp({
      gamesRootPath,
      codexSessionsRootPath,
      buildPromptPath: path.join(process.cwd(), 'game-build-prompt.md')
    });

    const authSession = await loginAsAdmin(app);
    const response = await request(app)
      .get('/api/codex-sessions/v1')
      .set('Host', TEST_HOST)
      .set('Cookie', authSession.cookieHeader)
      .expect(200);

    expect(response.body).toEqual({
      status: 'session-file-missing',
      versionId: 'v1',
      sessionId,
      codexSessionStatus: 'stopped',
      eyeState: 'stopped'
    });
  });

  it('maps created lifecycle state to generating eyeState when no session file is present yet', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-codex-created-state-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'v1',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z',
        codexSessionStatus: 'created'
      }
    });

    const app = createApp({
      gamesRootPath,
      buildPromptPath: path.join(process.cwd(), 'game-build-prompt.md')
    });

    const authSession = await loginAsAdmin(app);
    const response = await request(app)
      .get('/api/codex-sessions/v1')
      .set('Host', TEST_HOST)
      .set('Cookie', authSession.cookieHeader)
      .expect(200);

    expect(response.body).toEqual({
      status: 'no-session',
      versionId: 'v1',
      codexSessionStatus: 'created',
      eyeState: 'generating'
    });
  });

  it('hides admin controls on game page when logged out and shows them when logged in', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-game-auth-controls-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'v1',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    const app = createApp({
      gamesRootPath,
      buildPromptPath: path.join(process.cwd(), 'game-build-prompt.md'),
      enableGameLiveReload: true
    });

    const publicView = await request(app).get('/game/v1').set('Host', TEST_HOST).expect(200);
    expect(publicView.text).not.toContain('Prompt editing and Codex transcripts require admin login.');
    expect(publicView.text).not.toContain('game-admin-notice');
    expect(publicView.text).not.toContain('id="prompt-panel"');
    expect(publicView.text).not.toContain('id="prompt-record-button"');
    expect(publicView.text).not.toContain('id="game-tab-capture-tile"');
    expect(publicView.text).not.toContain('id="game-codex-toggle"');
    expect(publicView.text).not.toContain('id="game-codex-transcript"');
    expect(publicView.text).not.toContain('id="game-tab-favorite"');
    expect(publicView.text).not.toContain('id="game-tab-delete"');
    expect(publicView.text).not.toContain('id="game-tab-edit"');
    expect(publicView.text).toContain('id="game-home-button"');
    expect(publicView.text).not.toContain('/public/game-view.js');
    expect(publicView.text).toContain('/public/game-live-reload.js');
    expect(publicView.text).toContain("'touchend'");
    expect(publicView.text).toContain("'dblclick'");
    expect(publicView.text).toContain("'selectstart'");
    expect(publicView.text).toContain("'contextmenu'");

    const authSession = await loginAsAdmin(app);
    const adminView = await request(app)
      .get('/game/v1')
      .set('Host', TEST_HOST)
      .set('Cookie', authSession.cookieHeader)
      .expect(200);

    expect(adminView.text).toContain('id="prompt-panel"');
    expect(adminView.text).toContain('id="prompt-record-button"');
    expect(adminView.text).toContain('id="game-tab-capture-tile"');
    expect(adminView.text).toContain('id="game-codex-toggle"');
    expect(adminView.text).toContain('id="game-codex-transcript"');
    expect(adminView.text).toContain('id="game-tab-edit"');
    expect(adminView.text).toContain('id="prompt-submit-button"');
    expect(adminView.text).toMatch(/id="prompt-submit-button"[\s\S]*class="game-view-icon lucide lucide-rocket"/);
    expect(adminView.text).toContain('<span>Build</span>');
    expect(adminView.text).not.toContain('<span>Submit</span>');
    expect(adminView.text).not.toContain('>Transcript</span>');
    expect(adminView.text).toContain('id="game-tab-favorite"');
    expect(adminView.text).toContain('id="game-tab-delete"');
    expect(adminView.text).toContain('class="game-view-icon lucide lucide-trash-2"');
    expect(adminView.text).toContain('class="game-view-icon lucide lucide-video"');
    expect(adminView.text).toContain('class="game-view-tab-spinner"');
    expect(adminView.text).toContain('aria-label="Favorite game"');
    expect(adminView.text).toContain('aria-pressed="false"');
    expect(adminView.text).toContain('/public/game-view.js');
    expect(adminView.text).toContain('data-csrf-token="');
    expect(adminView.text).toContain('data-game-favorited="false"');
    expect(adminView.text).toContain('data-codegen-provider="codex"');
    expect(adminView.text).toContain('aria-label="Build prompt"');
    expect(adminView.text).toContain('aria-label="Toggle Codex session"');
    expect(adminView.text).toMatch(/id="game-codex-toggle"[\s\S]*class="prompt-action-button prompt-action-button--icon"/);
    expect(adminView.text).toContain('class="game-view-icon lucide lucide-bot"');
    expect(adminView.text).toContain('<h2>Codex Transcript</h2>');
    expect(adminView.text).toContain('class="game-top-strip"');
    expect(adminView.text).toContain('style="--game-tile-color: #1D3557;"');
  });

  it('toggles game favorite metadata when called by an authenticated admin', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-favorite-toggle-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'v1',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    const app = createApp({
      gamesRootPath,
      buildPromptPath: path.join(process.cwd(), 'game-build-prompt.md')
    });

    const authSession = await loginAsAdmin(app);

    const firstToggle = await request(app)
      .post('/api/games/v1/favorite')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', authSession.cookieHeader)
      .set('X-CSRF-Token', authSession.csrfToken)
      .expect(200);
    expect(firstToggle.body).toEqual({
      status: 'ok',
      versionId: 'v1',
      favorite: true
    });
    expect((await readMetadata(path.join(gamesRootPath, 'v1', 'metadata.json'))).favorite).toBe(true);

    const secondToggle = await request(app)
      .post('/api/games/v1/favorite')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', authSession.cookieHeader)
      .set('X-CSRF-Token', authSession.csrfToken)
      .expect(200);
    expect(secondToggle.body).toEqual({
      status: 'ok',
      versionId: 'v1',
      favorite: false
    });
    expect((await readMetadata(path.join(gamesRootPath, 'v1', 'metadata.json'))).favorite).toBe(false);
  });

  it('stores a manual tile snapshot PNG for a game when called by an authenticated admin', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-tile-snapshot-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'v1',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    const app = createApp({
      gamesRootPath,
      buildPromptPath: path.join(process.cwd(), 'game-build-prompt.md')
    });

    const authSession = await loginAsAdmin(app);
    const response = await request(app)
      .post('/api/games/v1/tile-snapshot')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', authSession.cookieHeader)
      .set('X-CSRF-Token', authSession.csrfToken)
      .set('Content-Type', 'application/json')
      .send({ tilePngDataUrl: TEST_PNG_DATA_URL })
      .expect(200);

    expect(response.body).toEqual({
      status: 'ok',
      versionId: 'v1',
      tileSnapshotPath: '/games/v1/snapshots/tile.png'
    });

    const persistedTilePath = path.join(gamesRootPath, 'v1', 'snapshots', 'tile.png');
    const persistedTile = await fs.readFile(persistedTilePath);
    const encodedPayload = TEST_PNG_DATA_URL.replace(/^data:image\/png;base64,/, '');
    const expectedTile = Buffer.from(encodedPayload, 'base64');
    expect(persistedTile.equals(expectedTile)).toBe(true);
  });

  it('rejects invalid manual tile snapshot payloads', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-tile-snapshot-invalid-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'v1',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    const app = createApp({
      gamesRootPath,
      buildPromptPath: path.join(process.cwd(), 'game-build-prompt.md')
    });

    const authSession = await loginAsAdmin(app);
    const response = await request(app)
      .post('/api/games/v1/tile-snapshot')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', authSession.cookieHeader)
      .set('X-CSRF-Token', authSession.csrfToken)
      .set('Content-Type', 'application/json')
      .send({ tilePngDataUrl: 'not-a-data-url' })
      .expect(400);

    expect(response.body).toEqual({
      error: 'Tile snapshot must be a PNG data URL (data:image/png;base64,...)'
    });
    await expect(fs.stat(path.join(gamesRootPath, 'v1', 'snapshots', 'tile.png'))).rejects.toThrow();
  });

  it('deletes a game directory when called by an authenticated admin', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-delete-game-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    const gamePath = await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'v1',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    const app = createApp({
      gamesRootPath,
      buildPromptPath: path.join(process.cwd(), 'game-build-prompt.md')
    });

    const authSession = await loginAsAdmin(app);

    await request(app)
      .delete('/api/games/v1')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', authSession.cookieHeader)
      .set('X-CSRF-Token', authSession.csrfToken)
      .expect(200)
      .expect({
        status: 'ok',
        versionId: 'v1'
      });

    await expect(fs.stat(gamePath)).rejects.toThrow();
  });

  it('serves dev reload tokens from /api/dev/reload-token when live reload is enabled', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-dev-reload-token-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'v1',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    const tokenPath = reloadTokenPath(gamesRootPath, 'v1');
    await fs.mkdir(path.dirname(tokenPath), { recursive: true });
    await fs.writeFile(tokenPath, 'token-123\n', 'utf8');

    const app = createApp({
      gamesRootPath,
      buildPromptPath: path.join(process.cwd(), 'game-build-prompt.md'),
      enableGameLiveReload: true
    });

    const response = await request(app)
      .get('/api/dev/reload-token/v1')
      .set('Host', TEST_HOST)
      .expect(200);

    expect(response.text).toBe('token-123');
  });

  it('enforces CSRF on admin POST routes and accepts valid CSRF tokens', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-prompt-csrf-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'source',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'starter',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    const buildPromptPath = path.join(tempDirectoryPath, 'game-build-prompt.md');
    await fs.writeFile(buildPromptPath, 'BASE PROMPT\n', 'utf8');

    const codexRunner = new CapturingRunner();
    const app = createApp({
      gamesRootPath,
      buildPromptPath,
      codexRunner
    });

    const authSession = await loginAsAdmin(app);

    await request(app)
      .post('/api/games/source/prompts')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', authSession.cookieHeader)
      .set('Content-Type', 'application/json')
      .send({ prompt: 'add gravity' })
      .expect(403);

    await request(app)
      .post('/api/games/source/prompts')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', authSession.cookieHeader)
      .set('X-CSRF-Token', 'wrong-token')
      .set('Content-Type', 'application/json')
      .send({ prompt: 'add gravity' })
      .expect(403);

    await request(app)
      .post('/api/games/source/favorite')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', authSession.cookieHeader)
      .expect(403);

    await request(app)
      .post('/api/games/source/favorite')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', authSession.cookieHeader)
      .set('X-CSRF-Token', 'wrong-token')
      .expect(403);

    await request(app)
      .post('/api/games/source/tile-snapshot')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', authSession.cookieHeader)
      .set('Content-Type', 'application/json')
      .send({ tilePngDataUrl: TEST_PNG_DATA_URL })
      .expect(403);

    await request(app)
      .post('/api/games/source/tile-snapshot')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', authSession.cookieHeader)
      .set('X-CSRF-Token', 'wrong-token')
      .set('Content-Type', 'application/json')
      .send({ tilePngDataUrl: TEST_PNG_DATA_URL })
      .expect(403);

    await request(app)
      .delete('/api/games/source')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', authSession.cookieHeader)
      .expect(403);

    await request(app)
      .delete('/api/games/source')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', authSession.cookieHeader)
      .set('X-CSRF-Token', 'wrong-token')
      .expect(403);

    const accepted = await postPromptAsAdmin(app, authSession, 'source', 'line 1\nline 2');
    expect(accepted.status).toBe(202);
    expect(typeof accepted.body.forkId).toBe('string');
    expect(codexRunner.calls).toHaveLength(1);

    const favoriteAccepted = await request(app)
      .post('/api/games/source/favorite')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', authSession.cookieHeader)
      .set('X-CSRF-Token', authSession.csrfToken)
      .expect(200);
    expect(favoriteAccepted.body.favorite).toBe(true);

    const tileSnapshotAccepted = await request(app)
      .post('/api/games/source/tile-snapshot')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', authSession.cookieHeader)
      .set('X-CSRF-Token', authSession.csrfToken)
      .set('Content-Type', 'application/json')
      .send({ tilePngDataUrl: TEST_PNG_DATA_URL })
      .expect(200);
    expect(tileSnapshotAccepted.body.status).toBe('ok');
  });

  it('serves only runtime-safe /games assets and denies sensitive files', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-games-allowlist-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    const gameDirectoryPath = await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'v1',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    await fs.mkdir(path.join(gameDirectoryPath, 'dist', 'assets'), { recursive: true });
    await fs.writeFile(path.join(gameDirectoryPath, 'dist', 'assets', 'chunk.js'), 'export const v = 1;\n', 'utf8');
    await fs.writeFile(path.join(gameDirectoryPath, 'dist', 'reload-token.txt'), 'token\n', 'utf8');
    await fs.writeFile(path.join(gameDirectoryPath, 'dist', 'game.js.map'), '{}\n', 'utf8');
    await fs.mkdir(path.join(gameDirectoryPath, 'node_modules', 'pkg'), { recursive: true });
    await fs.writeFile(path.join(gameDirectoryPath, 'node_modules', 'pkg', 'index.js'), 'export {};\n', 'utf8');

    const app = createApp({
      gamesRootPath,
      buildPromptPath: path.join(process.cwd(), 'game-build-prompt.md')
    });

    await request(app).get('/games/v1/dist/game.js').expect(200);
    await request(app).get('/games/v1/dist/assets/chunk.js').expect(200);

    await request(app).get('/games/v1/metadata.json').expect(404);
    await request(app).get('/games/v1/src/main.ts').expect(404);
    await request(app).get('/games/v1/package.json').expect(404);
    await request(app).get('/games/v1/node_modules/pkg/index.js').expect(404);
    await request(app).get('/games/v1/dist/reload-token.txt').expect(404);
    await request(app).get('/games/v1/dist/game.js.map').expect(404);
    await request(app).get('/games/v1/dist/%2e%2e/metadata.json').expect(404);
  });

  it('forks before launching codex prompt execution, returns immediately, and stores session id', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-prompt-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'source',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    const buildPromptPath = path.join(tempDirectoryPath, 'game-build-prompt.md');
    await fs.writeFile(buildPromptPath, 'BASE PROMPT\n', 'utf8');

    const persistedSessionId = '019c48a7-3918-7123-bc60-0d7cddb4d5d4';
    const codexRunner = new CapturingRunner(persistedSessionId);
    const app = createApp({
      gamesRootPath,
      buildPromptPath,
      codexRunner
    });

    const authSession = await loginAsAdmin(app);
    const userPrompt = 'line 1\n"quoted"\nline 3';
    const response = await postPromptAsAdmin(app, authSession, 'source', userPrompt);

    expect(response.status).toBe(202);
    expect(typeof response.body.forkId).toBe('string');

    const forkId = response.body.forkId as string;
    expect(forkId).toMatch(/^line-quoted-game-[a-z0-9]{10}$/);

    expect(codexRunner.calls).toHaveLength(1);
    expect(codexRunner.calls[0]?.cwd).toBe(path.join(gamesRootPath, forkId));
    expect(codexRunner.calls[0]?.prompt).toBe(`BASE PROMPT\n\n${userPrompt}`);

    const forkMetadataPath = path.join(gamesRootPath, forkId, 'metadata.json');
    await waitForSessionId(forkMetadataPath, persistedSessionId);

    const forkMetadata = await readMetadata(forkMetadataPath);
    expect(forkMetadata.id).toBe(forkId);
    expect(forkMetadata.parentId).toBe('source');
    expect(forkMetadata.threeWords).toBe('line-quoted-game');
    expect(forkMetadata.prompt).toBe(userPrompt);
    expect(forkMetadata.tileColor).toMatch(/^#[0-9A-F]{6}$/);
    expect(forkMetadata.codexSessionId).toBe(persistedSessionId);
    await waitForSessionStatus(forkMetadataPath, 'stopped');
    expect((await readMetadata(forkMetadataPath)).codexSessionStatus).toBe('stopped');
  });

  it('shows only the three-word name on homepage tiles for forked games', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-homepage-three-words-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'source',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    const buildPromptPath = path.join(tempDirectoryPath, 'game-build-prompt.md');
    await fs.writeFile(buildPromptPath, 'BASE PROMPT\n', 'utf8');

    const codexRunner = new SessionCallbackOnlyRunner('019c48a7-3918-7123-bc60-0d7cddb4d5d4');
    const app = createApp({
      gamesRootPath,
      buildPromptPath,
      codexRunner
    });

    const authSession = await loginAsAdmin(app);
    const prompt = 'Build a neon racing game with drifting cars and boost pads';
    const response = await postPromptAsAdmin(app, authSession, 'source', prompt);
    expect(response.status).toBe(202);

    const forkId = response.body.forkId as string;
    expect(forkId).toMatch(/^build-neon-racing-[a-z0-9]{10}$/);

    await waitForSessionId(path.join(gamesRootPath, forkId, 'metadata.json'), '019c48a7-3918-7123-bc60-0d7cddb4d5d4');

    const homepage = await request(app)
      .get('/')
      .set('Host', TEST_HOST)
      .set('Cookie', authSession.cookieHeader)
      .expect(200);

    expect(homepage.text).toContain('>build neon racing<');
    expect(homepage.text).not.toContain(`>${forkId.replaceAll('-', ' ')}<`);
  });

  it('stores session id and logs failure when codex run returns unsuccessful result', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-prompt-failure-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'source',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    const buildPromptPath = path.join(tempDirectoryPath, 'game-build-prompt.md');
    await fs.writeFile(buildPromptPath, 'BASE PROMPT\n', 'utf8');

    const persistedSessionId = '019c48a7-3918-7123-bc60-0d7cddb4d5d4';
    const loggedErrors: string[] = [];
    const app = createApp({
      gamesRootPath,
      buildPromptPath,
      codexRunner: new FailingRunner(persistedSessionId),
      logError: (message: string) => {
        loggedErrors.push(message);
      }
    });

    const authSession = await loginAsAdmin(app);
    const response = await postPromptAsAdmin(app, authSession, 'source', 'try to change movement');

    expect(response.status).toBe(202);

    const forkId = response.body.forkId as string;
    const forkMetadataPath = path.join(gamesRootPath, forkId, 'metadata.json');
    await waitForSessionId(forkMetadataPath, persistedSessionId);
    await waitForErrorLog(loggedErrors, `codex exec failed for ${forkId}`);
    await waitForSessionStatus(forkMetadataPath, 'error');

    const forkMetadata = await readMetadata(forkMetadataPath);
    expect(forkMetadata.codexSessionId).toBe(persistedSessionId);
    expect(forkMetadata.codexSessionStatus).toBe('error');
  });

  it('stores session id immediately when runner emits it before completion', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-prompt-early-session-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'source',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    const buildPromptPath = path.join(tempDirectoryPath, 'game-build-prompt.md');
    await fs.writeFile(buildPromptPath, 'BASE PROMPT\n', 'utf8');

    const emittedSessionId = '019c49ae-107f-7790-8634-176d6ce7df3b';
    const app = createApp({
      gamesRootPath,
      buildPromptPath,
      codexRunner: new SessionCallbackOnlyRunner(emittedSessionId)
    });

    const authSession = await loginAsAdmin(app);
    const response = await postPromptAsAdmin(app, authSession, 'source', 'darken the ball fill color');

    expect(response.status).toBe(202);

    const forkId = response.body.forkId as string;
    const forkMetadataPath = path.join(gamesRootPath, forkId, 'metadata.json');
    await waitForSessionId(forkMetadataPath, emittedSessionId);

    const forkMetadata = await readMetadata(forkMetadataPath);
    expect(forkMetadata.codexSessionId).toBe(emittedSessionId);
    expect(forkMetadata.codexSessionStatus).toBe('created');
  });


  it('passes annotation image as codex attachment when provided', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-prompt-annotation-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'source',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    const buildPromptPath = path.join(tempDirectoryPath, 'game-build-prompt.md');
    await fs.writeFile(buildPromptPath, 'BASE PROMPT\n', 'utf8');

    const codexRunner = new CapturingRunner();
    const app = createApp({
      gamesRootPath,
      buildPromptPath,
      codexRunner
    });

    const authSession = await loginAsAdmin(app);
    const response = await postPromptAsAdmin(
      app,
      authSession,
      'source',
      'add a jump arc',
      authSession.csrfToken,
      TEST_PNG_DATA_URL
    );

    expect(response.status).toBe(202);
    expect(codexRunner.calls).toHaveLength(1);
    expect(codexRunner.calls[0]?.prompt).toBe(
      'BASE PROMPT\n\nadd a jump arc\n\n[visual_context_png_attached]\nUse the attached annotation PNG as visual context for this prompt.'
    );
    expect(codexRunner.calls[0]?.prompt).not.toContain('data:image/png;base64');
    expect(codexRunner.calls[0]?.imagePaths).toHaveLength(1);

    const forkId = response.body.forkId as string;
    const expectedPrefix = path.join(gamesRootPath, forkId, '.annotation-overlay-');
    expect(codexRunner.calls[0]?.imagePaths[0]?.startsWith(expectedPrefix)).toBe(true);
    expect(codexRunner.calls[0]?.imagePaths[0]?.endsWith('.png')).toBe(true);
  });

  it('passes annotation image as attachment when provider is claude', async () => {
    process.env.CODEGEN_PROVIDER = 'claude';

    const tempDirectoryPath = await createTempDirectory('game-space-app-prompt-annotation-claude-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'source',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    const buildPromptPath = path.join(tempDirectoryPath, 'game-build-prompt.md');
    await fs.writeFile(buildPromptPath, 'BASE PROMPT\n', 'utf8');

    const codexRunner = new CapturingRunner();
    const app = createApp({
      gamesRootPath,
      buildPromptPath,
      codexRunner
    });

    const authSession = await loginAsAdmin(app);
    const response = await postPromptAsAdmin(
      app,
      authSession,
      'source',
      'add a jump arc',
      authSession.csrfToken,
      TEST_PNG_DATA_URL
    );

    expect(response.status).toBe(202);
    expect(codexRunner.calls).toHaveLength(1);
    expect(codexRunner.calls[0]?.prompt).toBe(
      'BASE PROMPT\n\nadd a jump arc\n\n[visual_context_png_attached]\nUse the attached annotation PNG as visual context for this prompt.'
    );
    expect(codexRunner.calls[0]?.prompt).not.toContain('data:image/png;base64');
    expect(codexRunner.calls[0]?.imagePaths).toHaveLength(1);

    const forkId = response.body.forkId as string;
    const expectedPrefix = path.join(gamesRootPath, forkId, '.annotation-overlay-');
    expect(codexRunner.calls[0]?.imagePaths[0]?.startsWith(expectedPrefix)).toBe(true);
    expect(codexRunner.calls[0]?.imagePaths[0]?.endsWith('.png')).toBe(true);
  });

  it('rejects invalid annotation payloads', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-prompt-invalid-annotation-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'source',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    const codexRunner = new CapturingRunner();
    const app = createApp({
      gamesRootPath,
      codexRunner
    });

    const authSession = await loginAsAdmin(app);
    const response = await postPromptAsAdmin(
      app,
      authSession,
      'source',
      'add a jump arc',
      authSession.csrfToken,
      'data:image/png;base64,not-valid-base64'
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Annotation pixels must be a PNG data URL (data:image/png;base64,...)'
    });
    expect(codexRunner.calls).toHaveLength(0);
  });

  it('returns idea generation status in ideas api responses', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-ideas-status-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    const ideasPath = path.join(tempDirectoryPath, 'ideas.json');
    await fs.writeFile(
      ideasPath,
      `${JSON.stringify([{ prompt: 'idea one', hasBeenBuilt: false }], null, 2)}
`,
      'utf8'
    );

    const app = createApp({
      gamesRootPath,
      ideasPath
    });

    const authSession = await loginAsAdmin(app);
    const response = await request(app)
      .get('/api/ideas')
      .set('Host', TEST_HOST)
      .set('Cookie', authSession.cookieHeader)
      .expect(200);

    expect(response.body).toEqual({
      ideas: [{ prompt: 'idea one', hasBeenBuilt: false }],
      isGenerating: false
    });
  });

  it('hides ideas features from unauthenticated users and shows ideas link for admins', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-ideas-auth-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'source',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    const app = createApp({
      gamesRootPath,
      ideasPath: path.join(tempDirectoryPath, 'ideas.json')
    });

    const publicHomepage = await request(app).get('/').set('Host', TEST_HOST).expect(200);
    expect(publicHomepage.text).not.toContain('href="/ideas"');

    await request(app).get('/ideas').set('Host', TEST_HOST).expect(404);
    await request(app).get('/api/ideas').set('Host', TEST_HOST).expect(404);

    const adminSession = await loginAsAdmin(app);
    const adminHomepage = await request(app)
      .get('/')
      .set('Host', TEST_HOST)
      .set('Cookie', adminSession.cookieHeader)
      .expect(200);
    expect(adminHomepage.text).toContain('href="/ideas"');

    const ideasView = await request(app)
      .get('/ideas')
      .set('Host', TEST_HOST)
      .set('Cookie', adminSession.cookieHeader)
      .expect(200);
    expect(ideasView.text).toContain('class="idea-icon lucide lucide-lightbulb"');
    expect(ideasView.text).toContain('data-idea-build-icon="');
    expect(ideasView.text).toContain('data-idea-delete-icon="');
    expect(ideasView.text).toContain('lucide-rocket');
    expect(ideasView.text).toContain('lucide-trash-2');
  });

  it('builds ideas via the same prompt pipeline and marks idea as built', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-ideas-build-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'source',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'starter',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    const buildPromptPath = path.join(tempDirectoryPath, 'game-build-prompt.md');
    await fs.writeFile(buildPromptPath, 'BASE PROMPT\n', 'utf8');

    const ideasPath = path.join(tempDirectoryPath, 'ideas.json');
    await fs.writeFile(
      ideasPath,
      `${JSON.stringify([{ prompt: 'create gravity flipping pinball', hasBeenBuilt: false }], null, 2)}\n`,
      'utf8'
    );

    const codexRunner = new CapturingRunner();
    const app = createApp({
      gamesRootPath,
      buildPromptPath,
      ideasPath,
      codexRunner
    });

    const authSession = await loginAsAdmin(app);
    const response = await request(app)
      .post('/api/ideas/0/build')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', authSession.cookieHeader)
      .set('X-CSRF-Token', authSession.csrfToken)
      .set('Content-Type', 'application/json')
      .send({})
      .expect(202);

    expect(typeof response.body.forkId).toBe('string');
    expect(codexRunner.calls).toHaveLength(1);
    expect(codexRunner.calls[0]?.prompt).toBe('BASE PROMPT\n\ncreate gravity flipping pinball');

    const forkMetadataPath = path.join(gamesRootPath, response.body.forkId as string, 'metadata.json');
    const forkMetadata = await readMetadata(forkMetadataPath);
    expect(forkMetadata.parentId).toBe('starter');
    expect(forkMetadata.prompt).toBe('create gravity flipping pinball');

    const ideasAfterBuild = JSON.parse(await fs.readFile(ideasPath, 'utf8')) as Array<{ hasBeenBuilt: boolean }>;
    expect(ideasAfterBuild[0]?.hasBeenBuilt).toBe(true);
  });

  it('deletes ideas entries through the protected delete endpoint', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-ideas-delete-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    const ideasPath = path.join(tempDirectoryPath, 'ideas.json');
    await fs.writeFile(
      ideasPath,
      `${JSON.stringify(
        [
          { prompt: 'idea one', hasBeenBuilt: false },
          { prompt: 'idea two', hasBeenBuilt: false }
        ],
        null,
        2
      )}
`,
      'utf8'
    );

    const app = createApp({
      gamesRootPath,
      ideasPath
    });

    const authSession = await loginAsAdmin(app);
    await request(app)
      .delete('/api/ideas/0')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', authSession.cookieHeader)
      .set('X-CSRF-Token', authSession.csrfToken)
      .expect(200);

    const ideasAfterDelete = JSON.parse(await fs.readFile(ideasPath, 'utf8')) as Array<{ prompt: string }>;
    expect(ideasAfterDelete).toHaveLength(1);
    expect(ideasAfterDelete[0]?.prompt).toBe('idea two');
  });

});
