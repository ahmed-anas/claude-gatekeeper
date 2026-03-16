/**
 * Interactive setup wizard.
 *
 * Registers the PermissionRequest hook in ~/.claude/settings.json,
 * optionally creates a config file, and optionally installs a
 * global APPROVAL_POLICY.md template to ~/.claude/.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { ask, closePrompt } from './prompt-utils';

const HOOK_TIMEOUT = 15000;

/** Resolve the absolute path to the bin/gatekeeper script. */
function getBinPath(): string {
  return resolve(join(__dirname, '..', 'bin', 'gatekeeper'));
}

/** Resolve the absolute path to the templates directory. */
function getTemplatesDir(): string {
  return resolve(join(__dirname, '..', 'templates'));
}

/** Check if Claude Code CLI is available. */
function checkClaude(): boolean {
  try {
    execSync('which claude', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** Read and parse a JSON file, returning null on failure. */
export function readJson(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/** Write a JSON file, creating directories as needed. */
export function writeJson(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

/** Register the PermissionRequest hook in ~/.claude/settings.json. */
function registerHook(binPath: string): { created: boolean; alreadyExists: boolean } {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  const settings = readJson(settingsPath) ?? {};

  // Ensure hooks object exists
  if (!settings.hooks || typeof settings.hooks !== 'object') {
    settings.hooks = {};
  }
  const hooks = settings.hooks as Record<string, unknown>;

  // Check if our hook is already registered
  const permReqs = hooks.PermissionRequest;
  if (Array.isArray(permReqs)) {
    const alreadyRegistered = permReqs.some((entry: Record<string, unknown>) => {
      const innerHooks = entry.hooks;
      if (!Array.isArray(innerHooks)) return false;
      return innerHooks.some(
        (h: Record<string, unknown>) => typeof h.command === 'string' && h.command.includes('gatekeeper')
      );
    });
    if (alreadyRegistered) {
      return { created: false, alreadyExists: true };
    }
  }

  // Build our hook entry
  const hookEntry = {
    matcher: '',
    hooks: [
      {
        type: 'command',
        command: binPath,
        timeout: HOOK_TIMEOUT,
      },
    ],
  };

  // Merge into existing PermissionRequest array or create new
  if (Array.isArray(permReqs)) {
    permReqs.push(hookEntry);
  } else {
    hooks.PermissionRequest = [hookEntry];
  }

  writeJson(settingsPath, settings);
  return { created: true, alreadyExists: false };
}

/** Create a default config file. */
function createConfig(): string {
  const configPath = join(homedir(), '.claude', 'claude-gatekeeper', 'config.json');
  const defaultConfig = {
    enabled: true,
    backend: 'cli',
    model: 'haiku',
    confidenceThreshold: 'high',
    timeoutMs: 30000,
    logLevel: 'info',
  };
  writeJson(configPath, defaultConfig);
  return configPath;
}

export async function setup(): Promise<void> {
  console.log('\nClaude Gatekeeper Setup');
  console.log('======================\n');

  // 1. Check prerequisites
  const hasClaude = checkClaude();
  if (hasClaude) {
    console.log('  [ok] Claude Code CLI found');
  } else {
    console.log('  [!!] Claude Code CLI not found on PATH');
    console.log('       The hook uses `claude -p` by default. Install Claude Code or use the API backend.\n');
  }

  const nodeVersion = process.version;
  console.log(`  [ok] Node.js ${nodeVersion}\n`);

  // 2. Register hook
  const binPath = getBinPath();
  if (!existsSync(binPath)) {
    console.error(`  [error] bin/gatekeeper not found at ${binPath}`);
    console.error('          Run `npm run build` first.\n');
    process.exit(1);
  }

  console.log('Registering hook in ~/.claude/settings.json...');
  const hookResult = registerHook(binPath);
  if (hookResult.alreadyExists) {
    console.log('  [ok] Hook already registered\n');
  } else {
    console.log('  [ok] PermissionRequest hook registered\n');
  }

  // 3. Optional config
  const configPath = join(homedir(), '.claude', 'claude-gatekeeper', 'config.json');
  if (existsSync(configPath)) {
    console.log(`Config file exists: ${configPath}`);
  } else {
    const wantConfig = await ask('Create config file with defaults?');
    if (wantConfig) {
      const path = createConfig();
      console.log(`  [ok] Created ${path}`);
    } else {
      console.log('  [skip] Using built-in defaults');
    }
  }
  console.log('');

  // 4. Optional global approval policy
  const policyDest = join(homedir(), '.claude', 'claude-gatekeeper', 'APPROVAL_POLICY.md');
  if (existsSync(policyDest)) {
    console.log('Approval policy exists: ~/.claude/claude-gatekeeper/APPROVAL_POLICY.md');
  } else {
    const wantPolicy = await ask('Install default approval policy?');
    if (wantPolicy) {
      const templatePath = join(getTemplatesDir(), 'APPROVAL_POLICY.md');
      if (existsSync(templatePath)) {
        mkdirSync(dirname(policyDest), { recursive: true });
        copyFileSync(templatePath, policyDest);
        console.log('  [ok] Installed ~/.claude/claude-gatekeeper/APPROVAL_POLICY.md');
      } else {
        console.log('  [warn] Template not found — skipping');
      }
    } else {
      console.log('  [skip] No approval policy installed');
    }
  }
  console.log('       Tip: add a per-project override with <project>/APPROVAL_POLICY.md');

  // 5. Done
  closePrompt();
  console.log('\n---');
  console.log('Setup complete! Start a new Claude Code session to activate.');
  console.log('Run `claude-gatekeeper status` to verify.\n');
}
