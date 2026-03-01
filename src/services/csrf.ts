import { randomBytes } from 'node:crypto';

import { parse as parseCookieHeader, serialize as serializeCookie } from 'cookie';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { ADMIN_SESSION_TTL_SECONDS, timingSafeEqualText } from './adminAuth';

export const CSRF_COOKIE_NAME = 'game_space_csrf_token';
export const CSRF_FORM_FIELD_NAME = 'csrfToken';

type SameOriginHeaderValues = {
  hostHeader: string | null | undefined;
  originHeader: string | null | undefined;
  refererHeader: string | null | undefined;
};

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

export function isSameOriginHeaders(values: SameOriginHeaderValues): boolean {
  const hostHeader = values.hostHeader;
  if (typeof hostHeader !== 'string' || hostHeader.trim().length === 0) {
    return false;
  }

  const expectedHost = normalizeHost(hostHeader);
  const originHeader = values.originHeader;
  if (typeof originHeader === 'string' && originHeader.trim().length > 0) {
    const originHost = parseHeaderHost(originHeader);
    return originHost === expectedHost;
  }

  const refererHeader = values.refererHeader;
  if (typeof refererHeader === 'string' && refererHeader.trim().length > 0) {
    const refererHost = parseHeaderHost(refererHeader);
    return refererHost === expectedHost;
  }

  return false;
}

export function isSameOriginRequest(request: Request): boolean {
  return isSameOriginHeaders({
    hostHeader: request.get('host'),
    originHeader: request.get('origin'),
    refererHeader: request.get('referer')
  });
}

export function createCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

export function setCsrfTokenCookie(response: Response, token: string): void {
  response.append('Set-Cookie', serializeCsrfTokenCookie(token));
}

export function issueCsrfToken(response: Response): string {
  const token = createCsrfToken();
  setCsrfTokenCookie(response, token);
  return token;
}

export function ensureCsrfToken(request: Request, response: Response): string {
  const { token, setCookieHeader } = ensureCsrfTokenFromCookieHeader(request.headers.cookie);
  if (typeof setCookieHeader === 'string') {
    response.append('Set-Cookie', setCookieHeader);
  }

  return token;
}

export function serializeCsrfTokenCookie(token: string): string {
  return serializeCookie(CSRF_COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: ADMIN_SESSION_TTL_SECONDS
  });
}

export function readCsrfTokenFromCookieHeader(cookieHeader: string | undefined): string | null {
  const cookies = parseCookieHeader(cookieHeader ?? '');
  const existingToken = cookies[CSRF_COOKIE_NAME];
  return typeof existingToken === 'string' && existingToken.length > 0 ? existingToken : null;
}

export function ensureCsrfTokenFromCookieHeader(cookieHeader: string | undefined): {
  token: string;
  setCookieHeader?: string;
} {
  const existingToken = readCsrfTokenFromCookieHeader(cookieHeader);
  if (typeof existingToken === 'string') {
    return {
      token: existingToken
    };
  }

  const token = createCsrfToken();
  return {
    token,
    setCookieHeader: serializeCsrfTokenCookie(token)
  };
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
  return isCsrfTokenValid({
    cookieHeader: request.headers.cookie,
    hostHeader: request.get('host'),
    originHeader: request.get('origin'),
    refererHeader: request.get('referer'),
    requestToken: readRequestCsrfToken(request)
  });
}

export function isCsrfTokenValid(options: {
  cookieHeader: string | undefined;
  hostHeader: string | null | undefined;
  originHeader: string | null | undefined;
  refererHeader: string | null | undefined;
  requestToken: string | null;
}): boolean {
  if (
    !isSameOriginHeaders({
      hostHeader: options.hostHeader,
      originHeader: options.originHeader,
      refererHeader: options.refererHeader
    })
  ) {
    return false;
  }

  const cookieToken = readCsrfTokenFromCookieHeader(options.cookieHeader);
  if (typeof cookieToken !== 'string' || cookieToken.length === 0 || !options.requestToken) {
    return false;
  }

  return timingSafeEqualText(cookieToken, options.requestToken);
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
