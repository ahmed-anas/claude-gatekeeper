/**
 * Interactive setup wizard.
 *
 * Registers the PermissionRequest hook in ~/.claude/settings.json,
 * optionally creates a config file, and optionally installs a
 * global GATEKEEPER_POLICY.md template to ~/.claude/.
 */

import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { readJson, writeJson } from './fs-utils';
import { ask, closePrompt } from './cli-prompt';

const HOOK_TIMEOUT = 90000;

function getBinPath(): string {
  return resolve(join(__dirname, '..', 'bin', 'gatekeeper'));
}

function getTemplatesDir(): string {
  return resolve(join(__dirname, '..', 'templates'));
}

function checkClaude(): boolean {
  try {
    execSync('which claude', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function isGatekeeperHook(h: Record<string, unknown>): boolean {
  return typeof h.command === 'string' && h.command.includes('gatekeeper');
}

function registerHookType(
  hooks: Record<string, unknown>,
  hookType: string,
  binPath: string
): boolean {
  const existing = hooks[hookType];
  if (Array.isArray(existing)) {
    const alreadyRegistered = existing.some((entry: Record<string, unknown>) => {
      const innerHooks = entry.hooks;
      if (!Array.isArray(innerHooks)) return false;
      return innerHooks.some(isGatekeeperHook);
    });
    if (alreadyRegistered) return false;
    existing.push(makeHookEntry(binPath));
  } else {
    hooks[hookType] = [makeHookEntry(binPath)];
  }
  return true;
}

function makeHookEntry(binPath: string) {
  return {
    matcher: '',
    hooks: [{ type: 'command', command: binPath, timeout: HOOK_TIMEOUT }],
  };
}

/** Register both PermissionRequest and PreToolUse hooks. */
function registerHooks(binPath: string): { permCreated: boolean; preToolCreated: boolean } {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  const settings = readJson(settingsPath) ?? {};

  if (!settings.hooks || typeof settings.hooks !== 'object') {
    settings.hooks = {};
  }
  const hooks = settings.hooks as Record<string, unknown>;

  const permCreated = registerHookType(hooks, 'PermissionRequest', binPath);
  const preToolCreated = registerHookType(hooks, 'PreToolUse', binPath);

  if (permCreated || preToolCreated) {
    writeJson(settingsPath, settings);
  }

  return { permCreated, preToolCreated };
}

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

  const hasClaude = checkClaude();
  if (hasClaude) {
    console.log('  [ok] Claude Code CLI found');
  } else {
    console.log('  [!!] Claude Code CLI not found on PATH');
    console.log('       The hook uses `claude -p` by default. Install Claude Code or use the API backend.\n');
  }

  const nodeVersion = process.version;
  console.log(`  [ok] Node.js ${nodeVersion}\n`);

  const binPath = getBinPath();
  if (!existsSync(binPath)) {
    console.error(`  [error] bin/gatekeeper not found at ${binPath}`);
    console.error('          Run `npm run build` first.\n');
    process.exit(1);
  }

  console.log('Registering hooks in ~/.claude/settings.json...');
  const hookResult = registerHooks(binPath);
  if (!hookResult.permCreated && !hookResult.preToolCreated) {
    console.log('  [ok] Hooks already registered\n');
  } else {
    if (hookResult.permCreated) console.log('  [ok] PermissionRequest hook registered');
    if (hookResult.preToolCreated) console.log('  [ok] PreToolUse hook registered');
    console.log('');
  }

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

  const policyDest = join(homedir(), '.claude', 'claude-gatekeeper', 'GATEKEEPER_POLICY.md');
  if (existsSync(policyDest)) {
    console.log('Gatekeeper policy exists: ~/.claude/claude-gatekeeper/GATEKEEPER_POLICY.md');
  } else {
    const wantPolicy = await ask('Install default gatekeeper policy?');
    if (wantPolicy) {
      const templatePath = join(getTemplatesDir(), 'GATEKEEPER_POLICY.md');
      if (existsSync(templatePath)) {
        mkdirSync(dirname(policyDest), { recursive: true });
        copyFileSync(templatePath, policyDest);
        console.log('  [ok] Installed ~/.claude/claude-gatekeeper/GATEKEEPER_POLICY.md');
      } else {
        console.log('  [warn] Template not found — skipping');
      }
    } else {
      console.log('  [skip] No gatekeeper policy installed');
    }
  }
  console.log('       Tip: add a per-project override with <project>/GATEKEEPER_POLICY.md');

  closePrompt();
  console.log('\n---');
  console.log('Setup complete! Start a new Claude Code session to activate.');
  console.log('Run `claude-gatekeeper status` to verify.\n');
}
