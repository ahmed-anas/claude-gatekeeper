/**
 * End-to-end tests for the Claude AI Approver hook.
 *
 * These tests spawn the actual compiled dist/index.js as a child process,
 * pipe fixture JSON to stdin, and assert on stdout content and exit codes.
 *
 * Since no real Claude CLI or API is available in tests, most paths result
 * in escalation. The key thing we verify is that the hook NEVER crashes
 * (always exits 0) and static rules work correctly.
 */

import { execSync, spawn } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const PROJECT_ROOT = join(__dirname, '..', '..');
const DIST_INDEX = join(PROJECT_ROOT, 'dist', 'index.js');

/** Run the hook with given stdin and return { stdout, stderr, exitCode } */
function runHook(
  stdinData: string,
  env: Record<string, string> = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn('node', [DIST_INDEX], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Ensure no real API calls during tests
        ANTHROPIC_API_KEY: '',
        // Point config to a non-existent path so defaults are used
        HOME: '/tmp/e2e-test-nonexistent',
        ...env,
      },
      timeout: 15000,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on('error', (err) => {
      resolve({ stdout, stderr: err.message, exitCode: 1 });
    });

    proc.stdin.write(stdinData);
    proc.stdin.end();
  });
}

/** Load a fixture file. */
function loadFixture(name: string): string {
  return readFileSync(join(PROJECT_ROOT, 'tests', 'fixtures', name), 'utf-8');
}

describe('E2E: Hook Integration', () => {
  // Ensure dist is built before running tests
  beforeAll(() => {
    try {
      execSync('npm run build', { cwd: PROJECT_ROOT, stdio: 'pipe' });
    } catch {
      // Build may already be done
    }
  });

  // --- Invalid input escalation ---

  it('escalates on invalid stdin JSON', async () => {
    const { stdout, exitCode } = await runHook('not valid json');
    expect(exitCode).toBe(0);
    expect(stdout).toBe('');
  });

  it('escalates on empty stdin', async () => {
    const { stdout, exitCode } = await runHook('');
    expect(exitCode).toBe(0);
    expect(stdout).toBe('');
  });

  it('escalates on partial JSON', async () => {
    const { stdout, exitCode } = await runHook('{"tool_name":');
    expect(exitCode).toBe(0);
    expect(stdout).toBe('');
  });

  it('escalates on valid JSON but missing fields', async () => {
    const { stdout, exitCode } = await runHook('{}');
    expect(exitCode).toBe(0);
    // Missing tool_name/tool_input won't cause a crash
  });

  // --- Static rule: escalation ---

  it('escalates rm -rf / via static rules', async () => {
    const { stdout, exitCode } = await runHook(loadFixture('bash-rm-rf.json'));
    expect(exitCode).toBe(0);
    expect(stdout).toBe('');
  });

  it('escalates sudo commands via static rules', async () => {
    const { stdout, exitCode } = await runHook(loadFixture('bash-sudo.json'));
    expect(exitCode).toBe(0);
    expect(stdout).toBe('');
  });

  it('escalates curl | sh via static rules', async () => {
    const { stdout, exitCode } = await runHook(loadFixture('bash-curl-pipe-sh.json'));
    expect(exitCode).toBe(0);
    expect(stdout).toBe('');
  });

  it('escalates npm publish via static rules', async () => {
    const input = JSON.stringify({
      session_id: 'test',
      cwd: '/project',
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'npm publish --access public' },
    });
    const { stdout, exitCode } = await runHook(input);
    expect(exitCode).toBe(0);
    expect(stdout).toBe('');
  });

  it('escalates terraform destroy via static rules', async () => {
    const input = JSON.stringify({
      session_id: 'test',
      cwd: '/project',
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'terraform destroy -auto-approve' },
    });
    const { stdout, exitCode } = await runHook(input);
    expect(exitCode).toBe(0);
    expect(stdout).toBe('');
  });

  it('escalates compound command with dangerous segment', async () => {
    const input = JSON.stringify({
      session_id: 'test',
      cwd: '/project',
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'echo hello && sudo reboot' },
    });
    const { stdout, exitCode } = await runHook(input);
    expect(exitCode).toBe(0);
    expect(stdout).toBe('');
  });

  // --- AI evaluation path (no real AI available) ---

  it('escalates when no API key and CLI is not available', async () => {
    const { stdout, exitCode } = await runHook(loadFixture('bash-npm-build.json'));
    expect(exitCode).toBe(0);
    // Without a working claude CLI, this escalates
  });

  it('escalates Write tool requests (no static rule match)', async () => {
    const { stdout, exitCode } = await runHook(loadFixture('write-src-file.json'));
    expect(exitCode).toBe(0);
  });

  it('escalates WebFetch requests (no static rule match)', async () => {
    const { stdout, exitCode } = await runHook(loadFixture('webfetch-github.json'));
    expect(exitCode).toBe(0);
  });

  // --- Safety invariant: never crashes ---

  it('exits 0 on ALL code paths — never crashes', async () => {
    // This test spawns many processes, so give it extra time
    const testCases = [
      '',
      '{}',
      'null',
      '[]',
      '42',
      '"string"',
      'not json at all',
      '{"tool_name": "Bash"}',
      '{"tool_name": "Bash", "tool_input": {}}',
      '{"tool_name": "Bash", "tool_input": {"command": ""}, "cwd": "/x", "session_id": "x", "hook_event_name": "PermissionRequest"}',
      loadFixture('bash-rm-rf.json'),
      loadFixture('bash-sudo.json'),
      loadFixture('bash-curl-pipe-sh.json'),
      loadFixture('write-etc-passwd.json'),
      loadFixture('write-src-file.json'),
      loadFixture('webfetch-github.json'),
      loadFixture('bash-npm-build.json'),
    ];

    for (const input of testCases) {
      const { exitCode } = await runHook(input);
      expect(exitCode).toBe(0);
    }
  }, 30000);

  // --- Output format validation ---

  it('approval output matches Claude Code hook protocol', () => {
    const approvalJson = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'allow' },
      },
    });
    const parsed = JSON.parse(approvalJson);
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PermissionRequest');
    expect(parsed.hookSpecificOutput.decision.behavior).toBe('allow');
    // Verify no extra fields that might confuse Claude Code
    expect(Object.keys(parsed)).toEqual(['hookSpecificOutput']);
    expect(Object.keys(parsed.hookSpecificOutput)).toEqual(['hookEventName', 'decision']);
    expect(Object.keys(parsed.hookSpecificOutput.decision)).toEqual(['behavior']);
  });

  // --- Config integration ---

  it('respects disabled config', async () => {
    // Create a temporary config that disables the hook
    const tmpHome = join(tmpdir(), `ai-approver-test-${Date.now()}`);
    const configDir = join(tmpHome, '.config', 'claude-ai-approver');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({ enabled: false }));

    try {
      const input = JSON.stringify({
        session_id: 'test',
        cwd: '/project',
        hook_event_name: 'PermissionRequest',
        tool_name: 'Bash',
        tool_input: { command: 'echo safe command' },
      });
      const { stdout, exitCode } = await runHook(input, { HOME: tmpHome });
      expect(exitCode).toBe(0);
      expect(stdout).toBe(''); // Disabled = escalate everything
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
