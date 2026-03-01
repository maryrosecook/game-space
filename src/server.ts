import dotenv from 'dotenv';
import express from 'express';

import { createNextBridge } from './services/nextBridge';
import { setTrustedClientIpOnExpressRequest } from './services/trustedClientIp';

dotenv.config();

async function main(): Promise<void> {
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
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

  app.listen(port, () => {
    console.log(`Game Space listening on http://localhost:${port}`);
  });
}

void main().catch((error: unknown) => {
  console.error('Failed to start Game Space server', error);
  process.exit(1);
});
