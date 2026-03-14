export const DEFAULT_SERVER_PORT = 3000;
const MAX_SERVER_PORT = 65_535;
const PORT_FALLBACK_ENV_NAME = 'GAME_SPACE_ALLOW_PORT_FALLBACK';

export type RequestedServerPort = {
  port: number;
  allowFallback: boolean;
};

export type StartedServer<T> = {
  port: number;
  server: T;
  usedFallback: boolean;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isAddressInUseError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EADDRINUSE';
}

export function readRequestedServerPort(env: NodeJS.ProcessEnv = process.env): RequestedServerPort {
  if (!isNonEmptyString(env.PORT)) {
    return {
      port: DEFAULT_SERVER_PORT,
      allowFallback: env[PORT_FALLBACK_ENV_NAME] === '1'
    };
  }

  const port = Number.parseInt(env.PORT, 10);
  if (!Number.isInteger(port) || port < 0 || port > MAX_SERVER_PORT) {
    throw new Error(`PORT must be an integer between 0 and ${MAX_SERVER_PORT}`);
  }

  return {
    port,
    allowFallback: false
  };
}

export async function startServerOnRequestedPort<T>(
  startServer: (port: number) => Promise<T>,
  requestedPort: RequestedServerPort
): Promise<StartedServer<T>> {
  let port = requestedPort.port;

  while (true) {
    try {
      const server = await startServer(port);
      return {
        port,
        server,
        usedFallback: port !== requestedPort.port
      };
    } catch (error: unknown) {
      if (!requestedPort.allowFallback || !isAddressInUseError(error) || port >= MAX_SERVER_PORT) {
        throw error;
      }

      port += 1;
    }
  }
}
