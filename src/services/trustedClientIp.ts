import type { Request as ExpressRequest } from 'express';

export const TRUSTED_CLIENT_IP_HEADER_NAME = 'x-game-space-client-ip';

function readNonEmptyTrimmedText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : null;
}

export function readTrustedClientIpFromWebRequest(request: Request): string | null {
  return readNonEmptyTrimmedText(request.headers.get(TRUSTED_CLIENT_IP_HEADER_NAME));
}

export function setTrustedClientIpOnExpressRequest(request: ExpressRequest): void {
  const remoteAddress = readNonEmptyTrimmedText(request.socket.remoteAddress);
  if (!remoteAddress) {
    delete request.headers[TRUSTED_CLIENT_IP_HEADER_NAME];
    return;
  }

  request.headers[TRUSTED_CLIENT_IP_HEADER_NAME] = remoteAddress;
}
