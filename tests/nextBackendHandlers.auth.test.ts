import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { handleAuthLoginPost } from '../src/services/nextBackendHandlers';
import { readSharedLoginAttemptLimiter } from '../src/services/serverRuntimeState';
import { TRUSTED_CLIENT_IP_HEADER_NAME } from '../src/services/trustedClientIp';
import { CSRF_COOKIE_NAME } from '../src/services/csrf';

const TEST_PASSWORD_HASH =
  'scrypt$ASNFZ4mrze8BI0VniavN7w==$M+OVA7qtmUR3CHE87sPzm7h2MpJU1PXNk9qSpl2YPwHyaL8eByBbvuCTXEVTUVc/mwL9EhXgQ14qdOIyRUXu1Q==';
const TEST_SESSION_SECRET = 'session-secret-for-tests-must-be-long';

type AuthEnvSnapshot = {
  passwordHash: string | undefined;
  sessionSecret: string | undefined;
};

function setAuthEnvForTest(): AuthEnvSnapshot {
  const snapshot: AuthEnvSnapshot = {
    passwordHash: process.env.GAME_SPACE_ADMIN_PASSWORD_HASH,
    sessionSecret: process.env.GAME_SPACE_ADMIN_SESSION_SECRET,
  };

  process.env.GAME_SPACE_ADMIN_PASSWORD_HASH = TEST_PASSWORD_HASH;
  process.env.GAME_SPACE_ADMIN_SESSION_SECRET = TEST_SESSION_SECRET;

  return snapshot;
}

function restoreAuthEnv(snapshot: AuthEnvSnapshot): void {
  if (typeof snapshot.passwordHash === 'string') {
    process.env.GAME_SPACE_ADMIN_PASSWORD_HASH = snapshot.passwordHash;
  } else {
    delete process.env.GAME_SPACE_ADMIN_PASSWORD_HASH;
  }

  if (typeof snapshot.sessionSecret === 'string') {
    process.env.GAME_SPACE_ADMIN_SESSION_SECRET = snapshot.sessionSecret;
  } else {
    delete process.env.GAME_SPACE_ADMIN_SESSION_SECRET;
  }
}

function createAuthLoginRequest(options: {
  csrfToken: string;
  password: string;
  trustedClientIp: string;
  spoofedForwardedFor: string;
}): Request {
  const formBody = new URLSearchParams({
    csrfToken: options.csrfToken,
    password: options.password,
  });
  const headers = new Headers({
    host: 'game-space.local',
    origin: 'https://game-space.local',
    cookie: `${CSRF_COOKIE_NAME}=${encodeURIComponent(options.csrfToken)}`,
    [TRUSTED_CLIENT_IP_HEADER_NAME]: options.trustedClientIp,
    'x-forwarded-for': options.spoofedForwardedFor,
  });

  return new Request('https://game-space.local/auth/login', {
    method: 'POST',
    headers,
    body: formBody,
  });
}

describe('next backend auth handlers', () => {
  it('enforces login throttling with trusted client ip even when x-forwarded-for rotates', async () => {
    const envSnapshot = setAuthEnvForTest();
    const csrfToken = randomUUID();
    const trustedClientIp = `trusted-test-ip-${randomUUID()}`;
    const loginAttemptLimiter = readSharedLoginAttemptLimiter();

    try {
      const statuses: number[] = [];
      for (let attemptIndex = 0; attemptIndex < 6; attemptIndex += 1) {
        const spoofedForwardedFor = `203.0.113.${attemptIndex + 1}`;
        const response = await handleAuthLoginPost(
          createAuthLoginRequest({
            csrfToken,
            password: `invalid-password-${attemptIndex}`,
            trustedClientIp,
            spoofedForwardedFor,
          }),
        );
        statuses.push(response.status);
      }

      expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
      expect(statuses[5]).toBe(429);
    } finally {
      loginAttemptLimiter.registerSuccess(trustedClientIp);
      restoreAuthEnv(envSnapshot);
    }
  });
});
