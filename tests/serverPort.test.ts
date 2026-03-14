import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_SERVER_PORT,
  readRequestedServerPort,
  startServerOnRequestedPort
} from '../src/services/serverPort';

function createEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    ...overrides
  };
}

async function listen(server: Server, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    function handleError(error: Error): void {
      server.off('listening', handleListening);
      reject(error);
    }

    function handleListening(): void {
      server.off('error', handleError);
      resolve(server);
    }

    server.once('error', handleError);
    server.once('listening', handleListening);
    server.listen(port);
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function createStartedServer(port: number): Promise<Server> {
  const server = createServer((_request, response) => {
    response.statusCode = 200;
    response.end('ok');
  });

  try {
    return await listen(server, port);
  } catch (error: unknown) {
    await close(server).catch(() => undefined);
    throw error;
  }
}

function readPort(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected tcp server address');
  }

  return address.port;
}

describe('readRequestedServerPort', () => {
  it('uses the default port without fallback when no dev flag is present', () => {
    expect(readRequestedServerPort(createEnv())).toEqual({
      port: DEFAULT_SERVER_PORT,
      allowFallback: false
    });
  });

  it('uses the default port and enables fallback when requested', () => {
    expect(readRequestedServerPort(createEnv({ GAME_SPACE_ALLOW_PORT_FALLBACK: '1' }))).toEqual({
      port: DEFAULT_SERVER_PORT,
      allowFallback: true
    });
  });

  it('disables fallback when an explicit port is configured', () => {
    expect(readRequestedServerPort(createEnv({ PORT: '4100', GAME_SPACE_ALLOW_PORT_FALLBACK: '1' }))).toEqual(
      {
        port: 4100,
        allowFallback: false
      }
    );
  });

  it('rejects invalid port values', () => {
    expect(() => readRequestedServerPort(createEnv({ PORT: 'hello' }))).toThrow(
      'PORT must be an integer between 0 and 65535'
    );
  });
});

describe('startServerOnRequestedPort', () => {
  const startedServers = new Set<Server>();

  afterEach(async () => {
    await Promise.all([...startedServers].map((server) => close(server)));
    startedServers.clear();
  });

  it('walks forward to the next open port when fallback is enabled', async () => {
    const occupiedServer = await createStartedServer(0);
    startedServers.add(occupiedServer);
    const occupiedPort = readPort(occupiedServer);

    const result = await startServerOnRequestedPort(
      async (port) => {
        const server = await createStartedServer(port);
        startedServers.add(server);
        return server;
      },
      {
        port: occupiedPort,
        allowFallback: true
      }
    );

    expect(result.usedFallback).toBe(true);
    expect(result.port).toBeGreaterThan(occupiedPort);
  });

  it('preserves explicit port behavior when fallback is disabled', async () => {
    const occupiedServer = await createStartedServer(0);
    startedServers.add(occupiedServer);
    const occupiedPort = readPort(occupiedServer);

    await expect(
      startServerOnRequestedPort(
        async (port) => {
          const server = await createStartedServer(port);
          startedServers.add(server);
          return server;
        },
        {
          port: occupiedPort,
          allowFallback: false
        }
      )
    ).rejects.toMatchObject({
      code: 'EADDRINUSE'
    });
  });
});
