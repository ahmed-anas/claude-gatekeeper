/**
 * QA test: Guided deny behavior in hands-free mode.
 *
 * Tests that when the gatekeeper denies a command, Claude receives
 * the reason and adjusts its approach on retry.
 *
 * This is NOT part of the automated test suite. Run manually:
 *   nvm exec npm run test:qa
 *
 * Prerequisites:
 *   - Claude Code CLI installed and authenticated
 *   - Gatekeeper hooks registered (run `claude-gatekeeper setup`)
 *
 * Scenario:
 *   - Custom GATEKEEPER_POLICY.md: "Files must be written to a 'output' subdirectory"
 *   - Ask Claude to write a file called "result.txt" with some content
 *   - Expected: Claude tries writing to cwd → denied → retries in output/ → approved
 *   - Verify: output/result.txt exists with content
 *
 * Cost: ~$0.02 per run (multiple Haiku calls)
 */

import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir, tmpdir } from 'os';

const PROJECT_ROOT = join(__dirname, '..', '..');
const REAL_HOME = homedir();

// ---------------------------------------------------------------------------
// Claude CLI discovery
// ---------------------------------------------------------------------------

function findClaudeBin(): string {
  try {
    return execSync('which claude', { stdio: 'pipe', timeout: 5000 }).toString().trim();
  } catch { /* not on current PATH */ }

  const nvmDir = process.env.NVM_DIR || join(REAL_HOME, '.nvm');
  try {
    const versionsDir = join(nvmDir, 'versions', 'node');
    if (existsSync(versionsDir)) {
      for (const version of readdirSync(versionsDir)) {
        const bin = join(versionsDir, version, 'bin', 'claude');
        if (existsSync(bin)) return bin;
      }
    }
  } catch { /* nvm not present */ }

  const localBin = join(REAL_HOME, '.claude', 'local', 'bin', 'claude');
  if (existsSync(localBin)) return localBin;

  throw new Error('Claude Code CLI not found.');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runClaude(
  prompt: string,
  opts: { cwd: string; claudeBin: string; env: Record<string, string>; timeoutMs?: number }
): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve) => {
    const timeout = opts.timeoutMs ?? 120000;
    const proc = spawn(opts.claudeBin, ['-p', '--model', 'haiku', '--output-format', 'json'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      timeout,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({ output: `TIMEOUT. stdout: ${stdout}\nstderr: ${stderr}`, exitCode: 1 });
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ output: stdout + (stderr ? `\n[stderr]: ${stderr}` : ''), exitCode: code ?? 1 });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ output: err.message, exitCode: 1 });
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('QA: Guided deny behavior', () => {
  let claudeBin: string;
  let tmpDir: string;
  let configPath: string;
  let settingsBackup: string | null = null;

  beforeAll(() => {
    claudeBin = findClaudeBin();

    execSync('npm run build', { cwd: PROJECT_ROOT, stdio: 'pipe' });

    // Create temp project directory
    tmpDir = join(tmpdir(), `gatekeeper-qa-${Date.now()}`);
    mkdirSync(join(tmpDir, 'output'), { recursive: true });

    // Write a custom gatekeeper policy with a specific testable rule
    writeFileSync(join(tmpDir, 'GATEKEEPER_POLICY.md'), [
      '# Gatekeeper Policy',
      '',
      '## APPROVE',
      '- Writing files ONLY inside the "output" subdirectory (e.g., output/result.txt)',
      '',
      '## DENY',
      '- Writing files anywhere OTHER than the "output" subdirectory',
      '- Writing files directly in the project root (e.g., result.txt without the output/ prefix)',
      '',
    ].join('\n'));

    // Write hands-free config
    configPath = join(tmpDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      enabled: true,
      mode: 'hands-free',
      backend: 'cli',
      model: 'haiku',
      confidenceThreshold: 'medium',
      timeoutMs: 60000,
      logFile: join(tmpDir, 'decisions.log'),
    }));

    // Backup and update settings.json to add PreToolUse hook
    const settingsPath = join(REAL_HOME, '.claude', 'settings.json');
    settingsBackup = readFileSync(settingsPath, 'utf-8');

    const settings = JSON.parse(settingsBackup);
    const binPath = join(PROJECT_ROOT, 'bin', 'gatekeeper');

    // Add PreToolUse hook if not present
    if (!settings.hooks) settings.hooks = {};
    if (!settings.hooks.PreToolUse) {
      settings.hooks.PreToolUse = [{
        matcher: '',
        hooks: [{ type: 'command', command: binPath, timeout: 60000 }],
      }];
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    }
  }, 90000);

  afterAll(() => {
    // Restore original settings.json
    if (settingsBackup) {
      const settingsPath = join(REAL_HOME, '.claude', 'settings.json');
      writeFileSync(settingsPath, settingsBackup);
    }

    // Print the decision log for debugging
    const logPath = join(tmpDir, 'decisions.log');
    if (existsSync(logPath)) {
      console.log('\n--- Decision Log ---');
      console.log(readFileSync(logPath, 'utf-8'));
      console.log('--- End Log ---\n');
    }

    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('Claude adjusts after deny and writes to the correct directory', async () => {
    const result = await runClaude(
      'Write a file called "result.txt" containing the text "hello from claude". Use the Write tool to create the file. Just do it, don\'t explain.',
      {
        cwd: tmpDir,
        claudeBin,
        env: {
          CLAUDE_GATEKEEPER_CONFIG: configPath,
        },
        timeoutMs: 180000,
      }
    );

    console.log('\n--- Claude Response ---');
    try {
      const json = JSON.parse(result.output.split('\n')[0]);
      console.log('Result:', json.result || '(empty)');
      console.log('Turns:', json.num_turns);
      console.log('Cost:', json.total_cost_usd);
    } catch {
      console.log(result.output);
    }
    console.log('--- End Response ---\n');

    // Check that the file was written in the output/ subdirectory
    // (not in the root, which should have been denied)
    const outputFile = join(tmpDir, 'output', 'result.txt');
    const rootFile = join(tmpDir, 'result.txt');

    // At least one should exist — Claude should have written somewhere
    const wroteToOutput = existsSync(outputFile);
    const wroteToRoot = existsSync(rootFile);

    console.log(`Wrote to output/result.txt: ${wroteToOutput}`);
    console.log(`Wrote to root result.txt: ${wroteToRoot}`);

    // The guided deny should have redirected Claude to write in output/
    expect(wroteToOutput).toBe(true);

    if (wroteToOutput) {
      const content = readFileSync(outputFile, 'utf-8');
      expect(content.toLowerCase()).toContain('hello');
    }
  }, 240000);
});
