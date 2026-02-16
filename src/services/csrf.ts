import { randomBytes } from 'node:crypto';

import { parse as parseCookieHeader, serialize as serializeCookie } from 'cookie';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { ADMIN_SESSION_TTL_SECONDS, timingSafeEqualText } from './adminAuth';

export const CSRF_COOKIE_NAME = 'game_space_csrf_token';
export const CSRF_FORM_FIELD_NAME = 'csrfToken';

function normalizeHost(value: string): string {
  return value.trim().toLowerCase();
}

function parseHeaderHost(value: string): string | null {
  try {
    return normalizeHost(new URL(value).host);
  } catch {
    return null;
  }
}

export function isSameOriginRequest(request: Request): boolean {
  const hostHeader = request.get('host');
  if (typeof hostHeader !== 'string' || hostHeader.trim().length === 0) {
    return false;
  }

  const expectedHost = normalizeHost(hostHeader);
  const originHeader = request.get('origin');
  if (typeof originHeader === 'string' && originHeader.trim().length > 0) {
    const originHost = parseHeaderHost(originHeader);
    return originHost === expectedHost;
  }

  const refererHeader = request.get('referer');
  if (typeof refererHeader === 'string' && refererHeader.trim().length > 0) {
    const refererHost = parseHeaderHost(refererHeader);
    return refererHost === expectedHost;
  }

  return false;
}

export function createCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

export function setCsrfTokenCookie(response: Response, token: string): void {
  response.append(
    'Set-Cookie',
    serializeCookie(CSRF_COOKIE_NAME, token, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: ADMIN_SESSION_TTL_SECONDS
    })
  );
}

export function issueCsrfToken(response: Response): string {
  const token = createCsrfToken();
  setCsrfTokenCookie(response, token);
  return token;
}

export function ensureCsrfToken(request: Request, response: Response): string {
  const cookies = parseCookieHeader(request.headers.cookie ?? '');
  const existingToken = cookies[CSRF_COOKIE_NAME];
  if (typeof existingToken === 'string' && existingToken.length > 0) {
    return existingToken;
  }

  return issueCsrfToken(response);
}

function readRequestCsrfToken(request: Request): string | null {
  const headerValue = request.get('x-csrf-token');
  if (typeof headerValue === 'string' && headerValue.trim().length > 0) {
    return headerValue.trim();
  }

  const bodyValue = request.body?.[CSRF_FORM_FIELD_NAME];
  return typeof bodyValue === 'string' && bodyValue.trim().length > 0 ? bodyValue.trim() : null;
}

export function isCsrfRequestValid(request: Request): boolean {
  if (!isSameOriginRequest(request)) {
    return false;
  }

  const cookies = parseCookieHeader(request.headers.cookie ?? '');
  const cookieToken = cookies[CSRF_COOKIE_NAME];
  const requestToken = readRequestCsrfToken(request);
  if (typeof cookieToken !== 'string' || cookieToken.length === 0 || !requestToken) {
    return false;
  }

  return timingSafeEqualText(cookieToken, requestToken);
}

export function requireValidCsrf(request: Request, response: Response, next: NextFunction): void {
  if (!isCsrfRequestValid(request)) {
    response.status(403).json({ error: 'Invalid CSRF token' });
    return;
  }

  next();
}

export function requireValidCsrfMiddleware(): RequestHandler {
  return requireValidCsrf;
}
