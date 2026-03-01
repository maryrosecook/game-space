import { scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

import { parse as parseCookieHeader, serialize as serializeCookie } from 'cookie';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { sealData, unsealData } from 'iron-session';

import { isObjectRecord } from './fsUtils';

const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = {
  N: 16384,
  r: 8,
  p: 1
};
const ADMIN_SESSION_SUBJECT = 'admin';
const ADMIN_SESSION_VERSION = 1;

export const ADMIN_SESSION_TTL_MS = 259_200_000;
export const ADMIN_SESSION_TTL_SECONDS = ADMIN_SESSION_TTL_MS / 1_000;
export const ADMIN_SESSION_COOKIE_NAME = 'game_space_admin_session';

export type AdminAuthConfig = {
  passwordHash: string;
  sessionSecret: string;
};

type ScryptPasswordHash = {
  salt: Buffer;
  hash: Buffer;
};

type AdminSessionPayload = {
  sub: string;
  v: number;
  iat: number;
  exp: number;
};

function timingSafeEqualBuffers(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

export function timingSafeEqualText(left: string, right: string): boolean {
  return timingSafeEqualBuffers(Buffer.from(left), Buffer.from(right));
}

function parseScryptPasswordHash(serializedHash: string): ScryptPasswordHash | null {
  const parts = serializedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return null;
  }

  const encodedSalt = parts[1];
  const encodedHash = parts[2];
  if (typeof encodedSalt !== 'string' || typeof encodedHash !== 'string') {
    return null;
  }

  let salt: Buffer;
  let hash: Buffer;
  try {
    salt = Buffer.from(encodedSalt, 'base64');
    hash = Buffer.from(encodedHash, 'base64');
  } catch {
    return null;
  }

  if (salt.length === 0 || hash.length !== SCRYPT_KEY_LENGTH) {
    return null;
  }

  return { salt, hash };
}

function deriveScryptHash(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS, (error, derivedHash) => {
      if (error) {
        reject(error);
        return;
      }

      if (!(derivedHash instanceof Buffer)) {
        reject(new Error('Unexpected scrypt output type'));
        return;
      }

      resolve(derivedHash);
    });
  });
}

export async function verifyAdminPassword(password: string, serializedHash: string): Promise<boolean> {
  const parsedHash = parseScryptPasswordHash(serializedHash);
  if (!parsedHash) {
    return false;
  }

  const derivedHash = await deriveScryptHash(password, parsedHash.salt);
  return timingSafeEqualBuffers(derivedHash, parsedHash.hash);
}

function parseSessionPayload(value: unknown): AdminSessionPayload | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  if (value.sub !== ADMIN_SESSION_SUBJECT || value.v !== ADMIN_SESSION_VERSION) {
    return null;
  }

  if (typeof value.iat !== 'number' || typeof value.exp !== 'number') {
    return null;
  }

  const iat = value.iat;
  const exp = value.exp;

  if (!Number.isInteger(iat) || !Number.isInteger(exp)) {
    return null;
  }

  if (iat <= 0 || exp <= iat || exp - iat !== ADMIN_SESSION_TTL_MS) {
    return null;
  }

  return {
    sub: ADMIN_SESSION_SUBJECT,
    v: ADMIN_SESSION_VERSION,
    iat,
    exp
  };
}

function readNonEmptyEnv(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function readAdminAuthConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AdminAuthConfig {
  const passwordHash = readNonEmptyEnv('GAME_SPACE_ADMIN_PASSWORD_HASH', env);
  const sessionSecret = readNonEmptyEnv('GAME_SPACE_ADMIN_SESSION_SECRET', env);

  if (!parseScryptPasswordHash(passwordHash)) {
    throw new Error(
      'GAME_SPACE_ADMIN_PASSWORD_HASH must be formatted as scrypt$<saltBase64>$<hashBase64> with a 64-byte hash'
    );
  }

  if (sessionSecret.length < 32) {
    throw new Error('GAME_SPACE_ADMIN_SESSION_SECRET must be at least 32 characters long');
  }

  return {
    passwordHash,
    sessionSecret
  };
}

export async function createAdminSessionToken(
  sessionSecret: string,
  issuedAtMs: number = Date.now()
): Promise<string> {
  const payload: AdminSessionPayload = {
    sub: ADMIN_SESSION_SUBJECT,
    v: ADMIN_SESSION_VERSION,
    iat: issuedAtMs,
    exp: issuedAtMs + ADMIN_SESSION_TTL_MS
  };

  return sealData(payload, {
    password: sessionSecret,
    ttl: ADMIN_SESSION_TTL_SECONDS
  });
}

export async function readAdminSessionToken(
  token: string,
  sessionSecret: string,
  nowMs: number = Date.now()
): Promise<AdminSessionPayload | null> {
  if (token.length === 0) {
    return null;
  }

  let unsealedPayload: unknown;
  try {
    unsealedPayload = await unsealData<unknown>(token, {
      password: sessionSecret,
      ttl: ADMIN_SESSION_TTL_SECONDS
    });
  } catch {
    return null;
  }

  const payload = parseSessionPayload(unsealedPayload);
  if (!payload) {
    return null;
  }

  return nowMs < payload.exp ? payload : null;
}

export async function setAdminSessionCookie(
  response: Response,
  sessionSecret: string,
  issuedAtMs: number = Date.now()
): Promise<string> {
  const { sessionToken, cookieHeader } = await createAdminSessionCookieHeader(sessionSecret, issuedAtMs);

  response.append('Set-Cookie', cookieHeader);
  return sessionToken;
}

export async function createAdminSessionCookieHeader(
  sessionSecret: string,
  issuedAtMs: number = Date.now()
): Promise<{ sessionToken: string; cookieHeader: string }> {
  const sessionToken = await createAdminSessionToken(sessionSecret, issuedAtMs);
  const cookieHeader = serializeCookie(ADMIN_SESSION_COOKIE_NAME, sessionToken, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: ADMIN_SESSION_TTL_SECONDS
  });

  return {
    sessionToken,
    cookieHeader
  };
}

export function clearAdminSessionCookie(response: Response): void {
  response.append('Set-Cookie', createClearedAdminSessionCookieHeader());
}

export function createClearedAdminSessionCookieHeader(): string {
  return serializeCookie(ADMIN_SESSION_COOKIE_NAME, '', {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 0,
    expires: new Date(0)
  });
}

export async function isAdminAuthenticated(
  request: Request,
  authConfig: AdminAuthConfig,
  nowMs: number = Date.now()
): Promise<boolean> {
  return isAdminAuthenticatedFromCookieHeader(request.headers.cookie, authConfig, nowMs);
}

export async function isAdminAuthenticatedFromCookieHeader(
  cookieHeader: string | undefined,
  authConfig: AdminAuthConfig,
  nowMs: number = Date.now()
): Promise<boolean> {
  const cookies = parseCookieHeader(cookieHeader ?? '');
  const sessionToken = cookies[ADMIN_SESSION_COOKIE_NAME];
  if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
    return false;
  }

  return (await readAdminSessionToken(sessionToken, authConfig.sessionSecret, nowMs)) !== null;
}

export function requireAdminOr404(authConfig: AdminAuthConfig): RequestHandler {
  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      if (!(await isAdminAuthenticated(request, authConfig))) {
        response.status(404).type('text/plain').send('Not found');
        return;
      }

      next();
    } catch (error: unknown) {
      next(error);
    }
  };
}

type LoginAttemptRecord = {
  failures: number;
  firstFailureAtMs: number;
  blockedUntilMs: number;
};

type LoginAttemptLimiterOptions = {
  maxFailures: number;
  windowMs: number;
  blockDurationMs: number;
};

const defaultLoginAttemptLimiterOptions: LoginAttemptLimiterOptions = {
  maxFailures: 5,
  windowMs: 10 * 60 * 1_000,
  blockDurationMs: 5 * 60 * 1_000
};

export class LoginAttemptLimiter {
  private readonly options: LoginAttemptLimiterOptions;
  private readonly attemptsByKey = new Map<string, LoginAttemptRecord>();

  constructor(options: Partial<LoginAttemptLimiterOptions> = {}) {
    this.options = {
      ...defaultLoginAttemptLimiterOptions,
      ...options
    };
  }

  private resetExpiredWindow(key: string, nowMs: number): LoginAttemptRecord {
    const existing = this.attemptsByKey.get(key);
    if (!existing || nowMs - existing.firstFailureAtMs > this.options.windowMs) {
      const freshRecord: LoginAttemptRecord = {
        failures: 0,
        firstFailureAtMs: nowMs,
        blockedUntilMs: 0
      };
      this.attemptsByKey.set(key, freshRecord);
      return freshRecord;
    }

    return existing;
  }

  getBlockRemainingMs(key: string, nowMs: number = Date.now()): number {
    const record = this.attemptsByKey.get(key);
    if (!record) {
      return 0;
    }

    if (record.blockedUntilMs <= nowMs) {
      return 0;
    }

    return record.blockedUntilMs - nowMs;
  }

  registerFailure(key: string, nowMs: number = Date.now()): void {
    const record = this.resetExpiredWindow(key, nowMs);
    record.failures += 1;

    if (record.failures >= this.options.maxFailures) {
      record.blockedUntilMs = nowMs + this.options.blockDurationMs;
      record.failures = 0;
      record.firstFailureAtMs = nowMs;
    }
  }

  registerSuccess(key: string): void {
    this.attemptsByKey.delete(key);
  }
}
