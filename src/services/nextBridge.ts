import path from 'node:path';

import type { Request, Response } from 'express';
import next from 'next';

export type NextRouteHandler = (request: Request, response: Response) => Promise<void>;

type NextBridge = {
  handleRequest: NextRouteHandler;
  close: () => Promise<void>;
};

type CreateNextBridgeOptions = {
  repoRootPath?: string;
  nextAppPath?: string;
  dev?: boolean;
};

export async function createNextBridge(options: CreateNextBridgeOptions = {}): Promise<NextBridge> {
  const repoRootPath = options.repoRootPath ?? process.cwd();
  const nextAppPath = options.nextAppPath ?? path.join(repoRootPath, 'next-app');
  const dev = options.dev ?? false;

  const nextServer = next({
    dev,
    dir: nextAppPath
  });
  await nextServer.prepare();
  const nextRequestHandler = nextServer.getRequestHandler();

  return {
    async handleRequest(request: Request, response: Response): Promise<void> {
      await nextRequestHandler(request, response);
    },
    async close(): Promise<void> {
      await nextServer.close();
    }
  };
}
