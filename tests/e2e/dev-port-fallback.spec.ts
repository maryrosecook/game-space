import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type Server } from 'node:http';

import { expect, test } from '@playwright/test';

const TEST_ADMIN_PASSWORD_HASH =
  'scrypt$ASNFZ4mrze8BI0VniavN7w==$M+OVA7qtmUR3CHE87sPzm7h2MpJU1PXNk9qSpl2YPwHyaL8eByBbvuCTXEVTUVc/mwL9EhXgQ14qdOIyRUXu1Q==';
const TEST_ADMIN_SESSION_SECRET = 'session-secret-for-tests-must-be-long';

async function listen(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    function handleError(error: Error): void {
      server.off('listening', handleListening);
      reject(error);
    }

    function handleListening(): void {
      server.off('error', handleError);
      resolve();
    }

    server.once('error', handleError);
    server.once('listening', handleListening);
    server.listen(port);
  });
}

async function closeServer(server: Server | null): Promise<void> {
  if (server === null) {
    return;
  }

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

async function occupyDefaultPortIfNeeded(): Promise<Server | null> {
  const blocker = createServer((_request, response) => {
    response.statusCode = 200;
    response.end('occupied');
  });

  try {
    await listen(blocker, 3000);
    return blocker;
  } catch (error: unknown) {
    await closeServer(blocker).catch(() => undefined);

    if (error instanceof Error && 'code' in error && error.code === 'EADDRINUSE') {
      return null;
    }

    throw error;
  }
}

async function stopProcess(childProcess: ChildProcessWithoutNullStreams | null): Promise<void> {
  if (childProcess === null || childProcess.exitCode !== null) {
    return;
  }

  childProcess.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    childProcess.once('exit', () => {
      resolve();
    });
  });
}

async function waitForListeningPort(childProcess: ChildProcessWithoutNullStreams): Promise<number> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for server startup\n${output}`));
    }, 60_000);

    function cleanup(): void {
      clearTimeout(timeout);
      childProcess.off('error', handleProcessError);
      childProcess.off('exit', handleExit);
      childProcess.stdout.off('data', handleOutput);
      childProcess.stderr.off('data', handleOutput);
    }

    function handleProcessError(error: Error): void {
      cleanup();
      reject(error);
    }

    function handleExit(code: number | null, signal: NodeJS.Signals | null): void {
      cleanup();
      reject(new Error(`Server exited before listening (code=${code}, signal=${signal})\n${output}`));
    }

    function handleOutput(chunk: string | Buffer): void {
      output += chunk.toString();
      const match = output.match(/Game Space listening on http:\/\/localhost:(\d+)/);
      if (match === null) {
        return;
      }

      const portText = match[1];
      if (typeof portText !== 'string') {
        cleanup();
        reject(new Error(`Expected listening port in startup log\n${output}`));
        return;
      }

      cleanup();
      resolve(Number.parseInt(portText, 10));
    }

    childProcess.once('error', handleProcessError);
    childProcess.once('exit', handleExit);
    childProcess.stdout.on('data', handleOutput);
    childProcess.stderr.on('data', handleOutput);
  });
}

test('server falls forward from port 3000 when dev port fallback is enabled', async ({ page }) => {
  test.setTimeout(90_000);

  let occupiedDefaultPortServer: Server | null = null;
  let childProcess: ChildProcessWithoutNullStreams | null = null;

  try {
    occupiedDefaultPortServer = await occupyDefaultPortIfNeeded();

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GAME_SPACE_ADMIN_PASSWORD_HASH: TEST_ADMIN_PASSWORD_HASH,
      GAME_SPACE_ADMIN_SESSION_SECRET: TEST_ADMIN_SESSION_SECRET,
      GAME_SPACE_ALLOW_PORT_FALLBACK: '1'
    };
    delete env.PORT;

    childProcess = spawn('node', ['dist/server.js'], {
      cwd: process.cwd(),
      env,
      stdio: 'pipe'
    });

    const port = await waitForListeningPort(childProcess);
    expect(port).toBeGreaterThan(3000);

    const response = await page.goto(`http://127.0.0.1:${port}/`);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle('Fountain');
  } finally {
    await stopProcess(childProcess);
    await closeServer(occupiedDefaultPortServer);
  }
});
