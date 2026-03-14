import type { Server } from 'node:http';

import dotenv from 'dotenv';
import express, { type Express } from 'express';

import { createNextBridge } from './services/nextBridge';
import { readRequestedServerPort, startServerOnRequestedPort } from './services/serverPort';
import { setTrustedClientIpOnExpressRequest } from './services/trustedClientIp';

dotenv.config();

function listen(app: Express, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port);

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
  });
}

async function main(): Promise<void> {
  const requestedPort = readRequestedServerPort();
  const nextBridge = await createNextBridge({
    repoRootPath: process.cwd(),
    dev: process.env.GAME_SPACE_NEXT_DEV === '1'
  });
  const app = express();

  app.use((request, response) => {
    setTrustedClientIpOnExpressRequest(request);

    void nextBridge.handleRequest(request, response).catch((error: unknown) => {
      console.error(`Failed to handle ${request.method} ${request.originalUrl} via Next`, error);

      if (!response.headersSent) {
        response.status(502).type('text/plain').send('Bad gateway');
        return;
      }

      response.end();
    });
  });

  const { port, usedFallback } = await startServerOnRequestedPort(
    (candidatePort) => listen(app, candidatePort),
    requestedPort
  );

  if (usedFallback) {
    console.warn(`Port ${requestedPort.port} is busy, using ${port} instead`);
  }

  console.log(`Game Space listening on http://localhost:${port}`);
}

void main().catch((error: unknown) => {
  console.error('Failed to start Game Space server', error);
  process.exit(1);
});
