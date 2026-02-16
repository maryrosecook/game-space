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
import { createGameFixture, createTempDirectory } from './testHelpers';

const TEST_HOST = 'game-space.local';
const TEST_ORIGIN = `https://${TEST_HOST}`;
const TEST_ADMIN_PASSWORD = 'correct horse battery staple';
const TEST_ADMIN_PASSWORD_HASH =
  'scrypt$ASNFZ4mrze8BI0VniavN7w==$M+OVA7qtmUR3CHE87sPzm7h2MpJU1PXNk9qSpl2YPwHyaL8eByBbvuCTXEVTUVc/mwL9EhXgQ14qdOIyRUXu1Q==';
const TEST_ADMIN_SESSION_SECRET = 'session-secret-for-tests-must-be-long';

const originalPasswordHash = process.env.GAME_SPACE_ADMIN_PASSWORD_HASH;
const originalSessionSecret = process.env.GAME_SPACE_ADMIN_SESSION_SECRET;

type CapturedRun = {
  prompt: string;
  cwd: string;
};

class CapturingRunner implements CodexRunner {
  public readonly calls: CapturedRun[] = [];
  private readonly sessionId: string | null;

  constructor(sessionId: string | null = null) {
    this.sessionId = sessionId;
  }

  async run(prompt: string, cwd: string, options?: CodexRunOptions): Promise<CodexRunResult> {
    void options;
    this.calls.push({ prompt, cwd });
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
  createdTime: string;
  codexSessionId?: string | null;
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
  csrfToken: string = authSession.csrfToken
): Promise<request.Response> {
  return request(app)
    .post(`/api/games/${encodeURIComponent(sourceVersionId)}/prompts`)
    .set('Host', TEST_HOST)
    .set('Origin', TEST_ORIGIN)
    .set('Cookie', authSession.cookieHeader)
    .set('X-CSRF-Token', csrfToken)
    .set('Content-Type', 'application/json')
    .send({ prompt });
}

async function readMetadata(metadataPath: string): Promise<StoredMetadata> {
  const serialized = await fs.readFile(metadataPath, 'utf8');
  return JSON.parse(serialized) as StoredMetadata;
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
        createdTime: '2026-01-01T00:00:00.000Z'
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
    expect(homepage.text).toContain('<title>Infinity</title>');
    expect(homepage.text).toContain('<h1>Infinity</h1>');
    expect(homepage.text).toContain('>Login<');
    expect(homepage.text).toContain('>newer game<');
    expect(homepage.text).not.toContain('>newer-game<');
    expect(homepage.text).toContain('>February, 2026<');
    expect(homepage.text).toContain('>January, 2026<');
    expect(homepage.text).not.toMatch(/<span class="tile-created">[^<]*\d{1,2}:\d{2}/);
    const newerIndex = homepage.text.indexOf('data-version-id="newer-game"');
    const olderIndex = homepage.text.indexOf('data-version-id="older-build"');
    expect(newerIndex).toBeGreaterThan(-1);
    expect(olderIndex).toBeGreaterThan(newerIndex);

    const authSession = await loginAsAdmin(app);
    const adminHomepage = await request(app)
      .get('/')
      .set('Host', TEST_HOST)
      .set('Cookie', authSession.cookieHeader)
      .expect(200);
    expect(adminHomepage.text).toContain('>Auth<');

    const css = await request(app).get('/public/styles.css').expect(200);
    expect(css.text).toContain('grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));');
    expect(css.text).toContain('--render-aspect-width: 9;');
    expect(css.text).toContain('--bottom-tab-height: 68px;');
    expect(css.text).toContain('--game-layout-height: calc(100dvh - var(--bottom-tab-height));');
    expect(css.text).toContain('border-radius: 18px 18px 0 0;');
    expect(css.text).toContain('overflow-wrap: anywhere;');
    expect(css.text).toContain('.game-page--edit-open .game-bottom-tabs');
    expect(css.text).not.toContain('border-bottom-left-radius: 0;');
    expect(css.text).not.toContain('border-bottom-right-radius: 0;');
    expect(css.text).toContain(
      'width: min(100%, calc(var(--game-layout-height) * var(--render-aspect-width) / var(--render-aspect-height)));'
    );
    expect(css.text).toContain(
      'flex: 0 0 min(calc(var(--game-layout-height) * var(--render-aspect-width) / var(--render-aspect-height)), 58vw);'
    );
    expect(css.text).toContain('.codex-session-view--game');
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
        '{"timestamp":"2026-02-10T10:00:00.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"add gravity"}]}}',
        '{"timestamp":"2026-02-10T10:00:01.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Adding gravity now."}]}}'
      ].join('\n'),
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
    expect(publicView.text).not.toContain('id="game-tab-codex"');
    expect(publicView.text).not.toContain('/public/game-view.js');
    expect(publicView.text).toContain('/public/game-live-reload.js');

    const authSession = await loginAsAdmin(app);
    const adminView = await request(app)
      .get('/game/v1')
      .set('Host', TEST_HOST)
      .set('Cookie', authSession.cookieHeader)
      .expect(200);

    expect(adminView.text).toContain('id="prompt-panel"');
    expect(adminView.text).toContain('id="game-tab-codex"');
    expect(adminView.text).toContain('/public/game-view.js');
    expect(adminView.text).toContain('data-csrf-token="');
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

  it('enforces CSRF on prompt POST and accepts valid CSRF token', async () => {
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

    const accepted = await postPromptAsAdmin(app, authSession, 'source', 'line 1\nline 2');
    expect(accepted.status).toBe(202);
    expect(typeof accepted.body.forkId).toBe('string');
    expect(codexRunner.calls).toHaveLength(1);
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
    expect(forkId).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);

    expect(codexRunner.calls).toHaveLength(1);
    expect(codexRunner.calls[0]?.cwd).toBe(path.join(gamesRootPath, forkId));
    expect(codexRunner.calls[0]?.prompt).toBe(`BASE PROMPT\n\n${userPrompt}`);

    const forkMetadataPath = path.join(gamesRootPath, forkId, 'metadata.json');
    await waitForSessionId(forkMetadataPath, persistedSessionId);

    const forkMetadata = await readMetadata(forkMetadataPath);
    expect(forkMetadata.id).toBe(forkId);
    expect(forkMetadata.parentId).toBe('source');
    expect(forkMetadata.codexSessionId).toBe(persistedSessionId);
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

    const forkMetadata = await readMetadata(forkMetadataPath);
    expect(forkMetadata.codexSessionId).toBe(persistedSessionId);
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
  });
});
