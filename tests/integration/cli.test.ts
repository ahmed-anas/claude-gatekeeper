/**
 * Integration tests for CLI commands: setup, uninstall, status.
 *
 * Each test creates a temp HOME directory, runs the real compiled CLI
 * as a subprocess, and verifies the filesystem effects. Nothing is
 * mocked in-process — these test the full code path.
 */

import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const PROJECT_ROOT = join(__dirname, '..', '..');
const CLI_PATH = join(PROJECT_ROOT, 'dist', 'cli.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run a CLI command in a subprocess with a controlled HOME. */
function runCli(
  args: string[],
  env: Record<string, string>,
  stdinInput?: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn('node', [CLI_PATH, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      timeout: 15000,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
    proc.on('error', (err) => resolve({ stdout, stderr: err.message, exitCode: 1 }));

    if (stdinInput !== undefined) {
      proc.stdin.write(stdinInput);
    }
    proc.stdin.end();
  });
}

/** Create a temp HOME with ~/.claude/ directory. */
function createTmpHome(): string {
  const tmpHome = join(tmpdir(), `gatekeeper-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(tmpHome, '.claude'), { recursive: true });
  return tmpHome;
}

/** Read and parse a JSON file. */
function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CLI: setup', () => {
  let tmpHome: string;

  beforeAll(() => {
    try {
      execSync('npm run build', { cwd: PROJECT_ROOT, stdio: 'pipe' });
    } catch { /* already built */ }
  });

  beforeEach(() => {
    tmpHome = createTmpHome();
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('registers both hooks in settings.json', async () => {
    const result = await runCli(['setup'], { HOME: tmpHome }, 'n\nn\n');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('PermissionRequest hook registered');
    expect(result.stdout).toContain('PreToolUse hook registered');

    const settingsPath = join(tmpHome, '.claude', 'settings.json');
    expect(existsSync(settingsPath)).toBe(true);

    const settings = readJson(settingsPath);
    const hooks = settings.hooks as any;
    expect(hooks.PermissionRequest).toHaveLength(1);
    expect(hooks.PermissionRequest[0].hooks[0].command).toContain('gatekeeper');
    expect(hooks.PreToolUse).toHaveLength(1);
    expect(hooks.PreToolUse[0].hooks[0].command).toContain('gatekeeper');
  });

  it('preserves existing hooks when registering', async () => {
    const settingsPath = join(tmpHome, '.claude', 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        Notification: [{ matcher: 'test', hooks: [{ type: 'command', command: 'echo hi' }] }],
      },
    }));

    await runCli(['setup'], { HOME: tmpHome }, 'n\nn\n');

    const settings = readJson(settingsPath);
    const hooks = settings.hooks as any;
    expect(hooks.Notification).toHaveLength(1);
    expect(hooks.PermissionRequest).toHaveLength(1);
  });

  it('does not duplicate hook if already registered', async () => {
    // Run setup twice
    await runCli(['setup'], { HOME: tmpHome }, 'n\nn\n');
    const result = await runCli(['setup'], { HOME: tmpHome }, 'n\nn\n');

    expect(result.stdout).toContain('Hooks already registered');

    const settings = readJson(join(tmpHome, '.claude', 'settings.json'));
    const permReqs = (settings.hooks as any).PermissionRequest;
    expect(permReqs).toHaveLength(1);
  });

  it('creates config file when user says yes', async () => {
    // "yes" to config, "no" to policy
    await runCli(['setup'], { HOME: tmpHome }, 'y\nn\n');

    const configPath = join(tmpHome, '.claude', 'claude-gatekeeper', 'config.json');
    expect(existsSync(configPath)).toBe(true);

    const config = readJson(configPath);
    expect(config.enabled).toBe(true);
    expect(config.backend).toBe('cli');
    expect(config.confidenceThreshold).toBe('high');
  });

  it('skips config file when user says no', async () => {
    await runCli(['setup'], { HOME: tmpHome }, 'n\nn\n');

    const configPath = join(tmpHome, '.claude', 'claude-gatekeeper', 'config.json');
    expect(existsSync(configPath)).toBe(false);
  });

  it('installs gatekeeper policy when user says yes', async () => {
    // "no" to config, "yes" to policy
    await runCli(['setup'], { HOME: tmpHome }, 'n\ny\n');

    const policyPath = join(tmpHome, '.claude', 'claude-gatekeeper', 'GATEKEEPER_POLICY.md');
    expect(existsSync(policyPath)).toBe(true);

    const content = readFileSync(policyPath, 'utf-8');
    expect(content).toContain('APPROVE');
    expect(content).toContain('ESCALATE');
  });
});

describe('CLI: uninstall', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = createTmpHome();
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('removes hook from settings.json', async () => {
    // First setup
    await runCli(['setup'], { HOME: tmpHome }, 'n\nn\n');

    // Then uninstall — "no" to delete config dir
    const result = await runCli(['uninstall'], { HOME: tmpHome }, 'n\n');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Hooks removed');

    const settings = readJson(join(tmpHome, '.claude', 'settings.json'));
    const hooks = settings.hooks as any;
    expect(hooks.PermissionRequest).toBeUndefined();
    expect(hooks.PreToolUse).toBeUndefined();
  });

  it('preserves other hooks when removing gatekeeper', async () => {
    const settingsPath = join(tmpHome, '.claude', 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        Notification: [{ matcher: 'test', hooks: [{ type: 'command', command: 'echo hi' }] }],
        PermissionRequest: [
          { matcher: '', hooks: [{ type: 'command', command: '/path/to/other-hook' }] },
          { matcher: '', hooks: [{ type: 'command', command: '/path/to/gatekeeper' }] },
        ],
      },
    }));

    await runCli(['uninstall'], { HOME: tmpHome }, 'n\n');

    const settings = readJson(settingsPath);
    const hooks = settings.hooks as any;
    expect(hooks.Notification).toHaveLength(1);
    expect(hooks.PermissionRequest).toHaveLength(1);
    expect(hooks.PermissionRequest[0].hooks[0].command).toBe('/path/to/other-hook');
  });

  it('handles already-removed hook gracefully', async () => {
    const result = await runCli(['uninstall'], { HOME: tmpHome }, 'n\n');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('already removed');
  });

  it('deletes config directory when user says yes', async () => {
    // Create config dir with files
    const configDir = join(tmpHome, '.claude', 'claude-gatekeeper');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), '{}');
    writeFileSync(join(configDir, 'decisions.log'), 'log entry');

    await runCli(['uninstall'], { HOME: tmpHome }, 'y\n');

    expect(existsSync(configDir)).toBe(false);
  });

  it('keeps config directory when user says no', async () => {
    const configDir = join(tmpHome, '.claude', 'claude-gatekeeper');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), '{}');

    await runCli(['uninstall'], { HOME: tmpHome }, 'n\n');

    expect(existsSync(configDir)).toBe(true);
  });

  it('shows per-project warning', async () => {
    const result = await runCli(['uninstall'], { HOME: tmpHome }, 'n\n');
    expect(result.stdout).toContain('per-project GATEKEEPER_POLICY.md files were NOT removed');
  });
});

describe('CLI: status', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = createTmpHome();
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('shows NOT registered when hook is absent', async () => {
    const result = await runCli(['status'], { HOME: tmpHome });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('NOT registered');
  });

  it('shows registered after setup', async () => {
    await runCli(['setup'], { HOME: tmpHome }, 'n\nn\n');

    const result = await runCli(['status'], { HOME: tmpHome });
    expect(result.stdout).toContain('registered');
    expect(result.stdout).not.toContain('NOT registered');
  });

  it('shows default config values when no config file exists', async () => {
    const result = await runCli(['status'], { HOME: tmpHome });
    expect(result.stdout).toContain('using defaults');
    expect(result.stdout).toContain('Enabled:  true');
    expect(result.stdout).toContain('Backend:  cli');
    expect(result.stdout).toContain('Threshold: high');
  });

  it('shows config path when config file exists', async () => {
    await runCli(['setup'], { HOME: tmpHome }, 'y\nn\n');

    const result = await runCli(['status'], { HOME: tmpHome });
    expect(result.stdout).toContain('claude-gatekeeper/config.json');
    expect(result.stdout).not.toContain('using defaults');
  });

  it('shows gatekeeper policy status', async () => {
    const result = await runCli(['status'], { HOME: tmpHome });
    expect(result.stdout).toContain('global=no');
  });

  it('shows global policy as yes after setup with policy', async () => {
    await runCli(['setup'], { HOME: tmpHome }, 'n\ny\n');

    const result = await runCli(['status'], { HOME: tmpHome });
    expect(result.stdout).toContain('global=yes');
  });
});

describe('CLI: setup → uninstall round-trip', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = createTmpHome();
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('fully cleans up after setup', async () => {
    // Setup with config + policy
    await runCli(['setup'], { HOME: tmpHome }, 'y\ny\n');

    const configDir = join(tmpHome, '.claude', 'claude-gatekeeper');
    expect(existsSync(join(configDir, 'config.json'))).toBe(true);
    expect(existsSync(join(configDir, 'GATEKEEPER_POLICY.md'))).toBe(true);

    // Uninstall with cleanup
    await runCli(['uninstall'], { HOME: tmpHome }, 'y\n');

    expect(existsSync(configDir)).toBe(false);

    const settings = readJson(join(tmpHome, '.claude', 'settings.json'));
    const hooks = settings.hooks as any;
    expect(hooks.PermissionRequest).toBeUndefined();
  });
});

describe('CLI: enable/disable', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = createTmpHome();
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('disable sets enabled:false in config', async () => {
    const result = await runCli(['disable'], { HOME: tmpHome });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('disabled');

    const configPath = join(tmpHome, '.claude', 'claude-gatekeeper', 'config.json');
    const config = readJson(configPath);
    expect(config.enabled).toBe(false);
  });

  it('enable sets enabled:true in config', async () => {
    // First disable, then enable
    await runCli(['disable'], { HOME: tmpHome });
    const result = await runCli(['enable'], { HOME: tmpHome });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('enabled');

    const configPath = join(tmpHome, '.claude', 'claude-gatekeeper', 'config.json');
    const config = readJson(configPath);
    expect(config.enabled).toBe(true);
  });

  it('shows "already enabled" when already enabled', async () => {
    // Default state is enabled, but we need a config file for it to be explicit
    const configDir = join(tmpHome, '.claude', 'claude-gatekeeper');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({ enabled: true }));

    const result = await runCli(['enable'], { HOME: tmpHome });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toLowerCase()).toContain('already enabled');
  });

  it('shows "already disabled" when already disabled', async () => {
    // First disable
    await runCli(['disable'], { HOME: tmpHome });
    // Then disable again
    const result = await runCli(['disable'], { HOME: tmpHome });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toLowerCase()).toContain('already disabled');
  });

  it('status after disable shows "paused"', async () => {
    // Setup hooks first, then disable
    await runCli(['setup'], { HOME: tmpHome }, 'n\nn\n');
    await runCli(['disable'], { HOME: tmpHome });

    const result = await runCli(['status'], { HOME: tmpHome });
    expect(result.stdout).toContain('paused');
  });

  it('round-trip: setup → disable → enable → status shows active', async () => {
    await runCli(['setup'], { HOME: tmpHome }, 'n\nn\n');
    await runCli(['disable'], { HOME: tmpHome });
    await runCli(['enable'], { HOME: tmpHome });

    const result = await runCli(['status'], { HOME: tmpHome });
    expect(result.stdout).toContain('active');
  });
});
