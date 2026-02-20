import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

type ConductorScriptConfig = {
  setup: string;
  run: string;
};

type ConductorConfig = {
  scripts: ConductorScriptConfig;
};

async function readRepoFile(relativePath: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relativePath), 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseConductorConfig(value: unknown): ConductorConfig | null {
  if (!isRecord(value)) {
    return null;
  }

  const scripts = value.scripts;
  if (!isRecord(scripts)) {
    return null;
  }

  if (typeof scripts.setup !== 'string' || typeof scripts.run !== 'string') {
    return null;
  }

  return {
    scripts: {
      setup: scripts.setup,
      run: scripts.run
    }
  };
}

describe('repo automation configuration', () => {
  it('maps package start script to the dev command', async () => {
    const packageJson = await readRepoFile('package.json');
    expect(packageJson).toContain('"start": "npm run dev"');
  });

  it('defines conductor setup and run scripts for this repo', async () => {
    const text = await readRepoFile('conductor.json');
    const config = parseConductorConfig(JSON.parse(text));

    expect(config).not.toBeNull();
    if (config === null) {
      throw new Error('Expected valid conductor config');
    }
    expect(config.scripts.setup).toBe('npm install');
    expect(config.scripts.run).toBe('npm run dev');
  });

  it('deploy workflow targets main and deploys via ssh + pm2 on do2 layout', async () => {
    const workflow = await readRepoFile('.github/workflows/deploy-main.yml');

    expect(workflow).toContain('name: Deploy Game Space');
    expect(workflow).toContain('push:');
    expect(workflow).toContain('- main');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('secrets.DEPLOY_KEY');
    expect(workflow).toContain('secrets.DEPLOY_KNOWN_HOSTS');
    expect(workflow).toContain('secrets.DEPLOY_USER');
    expect(workflow).toContain('secrets.DEPLOY_HOST');
    expect(workflow).toContain('$HOME/node_sites/game-space');
    expect(workflow).toContain('$HOME/node-sites/game-space');
    expect(workflow).toContain('nvm use --silent --lts');
    expect(workflow).toContain('git fetch origin main');
    expect(workflow).toContain('git reset --hard origin/main');
    expect(workflow).not.toContain('git pull origin main');
    expect(workflow).toContain('npm run build');
    expect(workflow).toContain('pm2 restart game-space');
  });

  it('pr feature video workflow remains valid yaml after script updates', () => {
    const workflowPath = path.join(process.cwd(), '.github/workflows/pr-feature-videos.yml');

    expect(() =>
      execFileSync('ruby', ['-e', 'require "yaml"; YAML.load_file(ARGV.fetch(0))', workflowPath], {
        stdio: 'pipe'
      })
    ).not.toThrow();
  });
});
