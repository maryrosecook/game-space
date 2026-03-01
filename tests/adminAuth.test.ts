import type { Request } from 'express';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_TTL_MS,
  createAdminSessionCookieHeader,
  createClearedAdminSessionCookieHeader,
  createAdminSessionToken,
  isAdminAuthenticatedFromCookieHeader,
  LoginAttemptLimiter,
  readAdminSessionToken,
  verifyAdminPassword
} from '../src/services/adminAuth';
import {
  CSRF_COOKIE_NAME,
  createCsrfToken,
  ensureCsrfTokenFromCookieHeader,
  isCsrfRequestValid,
  isCsrfTokenValid,
  isSameOriginRequest
} from '../src/services/csrf';

const TEST_PASSWORD_HASH =
  'scrypt$ASNFZ4mrze8BI0VniavN7w==$M+OVA7qtmUR3CHE87sPzm7h2MpJU1PXNk9qSpl2YPwHyaL8eByBbvuCTXEVTUVc/mwL9EhXgQ14qdOIyRUXu1Q==';
const TEST_SESSION_SECRET = 'session-secret-for-tests-must-be-long';

type MockRequestOptions = {
  host: string;
  origin?: string;
  referer?: string;
  cookie?: string;
  body?: Record<string, unknown>;
  csrfHeader?: string;
};

function createMockRequest(options: MockRequestOptions): Request {
  const normalizedHeaders = new Map<string, string>();
  normalizedHeaders.set('host', options.host);

  if (typeof options.origin === 'string') {
    normalizedHeaders.set('origin', options.origin);
  }

  if (typeof options.referer === 'string') {
    normalizedHeaders.set('referer', options.referer);
  }

  if (typeof options.csrfHeader === 'string') {
    normalizedHeaders.set('x-csrf-token', options.csrfHeader);
  }

  const requestLike = {
    headers: {
      cookie: options.cookie
    },
    body: options.body ?? {},
    get(name: string): string | undefined {
      return normalizedHeaders.get(name.toLowerCase());
    }
  };

  return requestLike as unknown as Request;
}

describe('admin auth helpers', () => {
  it('verifies scrypt password hashes', async () => {
    await expect(verifyAdminPassword('correct horse battery staple', TEST_PASSWORD_HASH)).resolves.toBe(true);
    await expect(verifyAdminPassword('incorrect password', TEST_PASSWORD_HASH)).resolves.toBe(false);
  });

  it('validates sealed session payloads and strict expiry boundary', async () => {
    const issuedAtMs = 1_700_000_000_000;
    const token = await createAdminSessionToken(TEST_SESSION_SECRET, issuedAtMs);

    const validSession = await readAdminSessionToken(token, TEST_SESSION_SECRET, issuedAtMs + ADMIN_SESSION_TTL_MS - 1);
    expect(validSession).not.toBeNull();
    if (validSession === null) {
      throw new Error('Expected valid session payload');
    }

    expect(validSession.exp - validSession.iat).toBe(ADMIN_SESSION_TTL_MS);

    const expiredSession = await readAdminSessionToken(token, TEST_SESSION_SECRET, issuedAtMs + ADMIN_SESSION_TTL_MS);
    expect(expiredSession).toBeNull();

    const firstCharacter = token[0];
    const replacementCharacter = firstCharacter === 'x' ? 'y' : 'x';
    const tamperedToken = token.length > 0 ? `${replacementCharacter}${token.slice(1)}` : token;
    await expect(readAdminSessionToken(tamperedToken, TEST_SESSION_SECRET, issuedAtMs)).resolves.toBeNull();
  });

  it('keeps fixed non-sliding TTL semantics across repeated reads', async () => {
    const issuedAtMs = 1_700_000_000_000;
    const token = await createAdminSessionToken(TEST_SESSION_SECRET, issuedAtMs);

    const earlyRead = await readAdminSessionToken(token, TEST_SESSION_SECRET, issuedAtMs + 10_000);
    const laterRead = await readAdminSessionToken(token, TEST_SESSION_SECRET, issuedAtMs + 30_000);

    expect(earlyRead).not.toBeNull();
    expect(laterRead).not.toBeNull();
    if (!earlyRead || !laterRead) {
      throw new Error('Expected both reads to be valid before expiry');
    }

    expect(earlyRead.iat).toBe(issuedAtMs);
    expect(laterRead.iat).toBe(issuedAtMs);
    expect(earlyRead.exp).toBe(issuedAtMs + ADMIN_SESSION_TTL_MS);
    expect(laterRead.exp).toBe(issuedAtMs + ADMIN_SESSION_TTL_MS);
  });

  it('tracks login attempt blocking windows', () => {
    const limiter = new LoginAttemptLimiter({
      maxFailures: 2,
      windowMs: 10_000,
      blockDurationMs: 20_000
    });

    const key = '127.0.0.1';
    const nowMs = 10_000;

    limiter.registerFailure(key, nowMs);
    expect(limiter.getBlockRemainingMs(key, nowMs)).toBe(0);

    limiter.registerFailure(key, nowMs + 1);
    expect(limiter.getBlockRemainingMs(key, nowMs + 1)).toBe(20_000);

    limiter.registerSuccess(key);
    expect(limiter.getBlockRemainingMs(key, nowMs + 2)).toBe(0);
  });

  it('authenticates valid admin session tokens from cookie headers', async () => {
    const issuedAtMs = 1_700_000_000_000;
    const token = await createAdminSessionToken(TEST_SESSION_SECRET, issuedAtMs);
    const cookieHeader = `theme=dark; ${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;

    const isAdmin = await isAdminAuthenticatedFromCookieHeader(
      cookieHeader,
      {
        passwordHash: TEST_PASSWORD_HASH,
        sessionSecret: TEST_SESSION_SECRET
      },
      issuedAtMs + 1_000
    );

    expect(isAdmin).toBe(true);
  });

  it('creates strict session cookie headers and clears them explicitly', async () => {
    const issuedAtMs = 1_700_000_000_000;
    const sessionCookie = await createAdminSessionCookieHeader(TEST_SESSION_SECRET, issuedAtMs);
    expect(sessionCookie.cookieHeader).toContain(`${ADMIN_SESSION_COOKIE_NAME}=`);
    expect(sessionCookie.cookieHeader).toContain('HttpOnly');
    expect(sessionCookie.cookieHeader).toContain('Secure');
    expect(sessionCookie.cookieHeader).toContain('SameSite=Strict');
    expect(sessionCookie.cookieHeader).toContain('Max-Age=259200');

    const clearedCookieHeader = createClearedAdminSessionCookieHeader();
    expect(clearedCookieHeader).toContain(`${ADMIN_SESSION_COOKIE_NAME}=`);
    expect(clearedCookieHeader).toContain('Max-Age=0');
    expect(clearedCookieHeader).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  });

  it('rejects missing, invalid, or expired cookie-header session tokens', async () => {
    const issuedAtMs = 1_700_000_000_000;
    const token = await createAdminSessionToken(TEST_SESSION_SECRET, issuedAtMs);

    await expect(
      isAdminAuthenticatedFromCookieHeader(undefined, {
        passwordHash: TEST_PASSWORD_HASH,
        sessionSecret: TEST_SESSION_SECRET
      })
    ).resolves.toBe(false);

    await expect(
      isAdminAuthenticatedFromCookieHeader(
        `${ADMIN_SESSION_COOKIE_NAME}=not-a-real-token`,
        {
          passwordHash: TEST_PASSWORD_HASH,
          sessionSecret: TEST_SESSION_SECRET
        },
        issuedAtMs + 1_000
      )
    ).resolves.toBe(false);

    await expect(
      isAdminAuthenticatedFromCookieHeader(
        `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
        {
          passwordHash: TEST_PASSWORD_HASH,
          sessionSecret: TEST_SESSION_SECRET
        },
        issuedAtMs + ADMIN_SESSION_TTL_MS
      )
    ).resolves.toBe(false);
  });
});

describe('csrf helpers', () => {
  it('generates CSRF tokens', () => {
    const firstToken = createCsrfToken();
    const secondToken = createCsrfToken();

    expect(firstToken.length).toBeGreaterThan(20);
    expect(secondToken.length).toBeGreaterThan(20);
    expect(firstToken).not.toBe(secondToken);
  });

  it('requires same-origin host matching', () => {
    const allowedRequest = createMockRequest({
      host: 'game-space.local',
      origin: 'https://game-space.local'
    });

    const deniedRequest = createMockRequest({
      host: 'game-space.local',
      origin: 'https://evil.example'
    });

    expect(isSameOriginRequest(allowedRequest)).toBe(true);
    expect(isSameOriginRequest(deniedRequest)).toBe(false);
  });

  it('validates double-submit CSRF token with same-origin enforcement', () => {
    const csrfToken = createCsrfToken();

    const validRequest = createMockRequest({
      host: 'game-space.local',
      origin: 'https://game-space.local',
      cookie: `${CSRF_COOKIE_NAME}=${encodeURIComponent(csrfToken)}`,
      csrfHeader: csrfToken
    });

    const invalidTokenRequest = createMockRequest({
      host: 'game-space.local',
      origin: 'https://game-space.local',
      cookie: `${CSRF_COOKIE_NAME}=${encodeURIComponent(csrfToken)}`,
      csrfHeader: 'different-token'
    });

    const crossOriginRequest = createMockRequest({
      host: 'game-space.local',
      origin: 'https://evil.example',
      cookie: `${CSRF_COOKIE_NAME}=${encodeURIComponent(csrfToken)}`,
      csrfHeader: csrfToken
    });

    expect(isCsrfRequestValid(validRequest)).toBe(true);
    expect(isCsrfRequestValid(invalidTokenRequest)).toBe(false);
    expect(isCsrfRequestValid(crossOriginRequest)).toBe(false);
  });

  it('ensures CSRF token from cookie header and reuses existing cookie token', () => {
    const existingToken = createCsrfToken();
    const fromExistingCookie = ensureCsrfTokenFromCookieHeader(
      `${CSRF_COOKIE_NAME}=${encodeURIComponent(existingToken)}`
    );
    expect(fromExistingCookie.token).toBe(existingToken);
    expect(fromExistingCookie.setCookieHeader).toBeUndefined();

    const generated = ensureCsrfTokenFromCookieHeader(undefined);
    expect(generated.token.length).toBeGreaterThan(20);
    expect(generated.setCookieHeader).toContain(`${CSRF_COOKIE_NAME}=`);
  });

  it('validates CSRF token using explicit request headers and cookie header', () => {
    const csrfToken = createCsrfToken();
    expect(
      isCsrfTokenValid({
        cookieHeader: `${CSRF_COOKIE_NAME}=${encodeURIComponent(csrfToken)}`,
        hostHeader: 'game-space.local',
        originHeader: 'https://game-space.local',
        refererHeader: null,
        requestToken: csrfToken
      })
    ).toBe(true);

    expect(
      isCsrfTokenValid({
        cookieHeader: `${CSRF_COOKIE_NAME}=${encodeURIComponent(csrfToken)}`,
        hostHeader: 'game-space.local',
        originHeader: 'https://evil.example',
        refererHeader: null,
        requestToken: csrfToken
      })
    ).toBe(false);
  });
});
