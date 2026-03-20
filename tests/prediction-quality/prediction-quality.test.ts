/**
 * Prediction Quality Tests
 *
 * Verifies that the AI makes correct approve/escalate/deny decisions for
 * real-world scenarios — especially ones that previously failed.
 *
 * Each test case is a JSON file in ./cases/. To add a new case, create a
 * .json file there; the test runner discovers and runs them automatically.
 *
 * These tests use REAL Claude CLI calls (~$0.001 per test).
 * NOT run in CI. Run manually:
 *   nvm exec npm run test:prediction-quality
 *
 * Prerequisites:
 *   - Claude Code CLI installed and authenticated
 *   - nvm exec npm run build
 */

import { execSync } from 'child_process';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { buildPrompt } from '../../src/prompt';
import { evaluateWithCli } from '../../src/evaluator';
import { HookInput, PromptContext, ApproverConfig, ConfidenceLevel, CONFIDENCE_LEVELS, GatekeeperMode } from '../../src/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TestCase {
  /** Short descriptive name */
  name: string;
  /** Why this test case exists (e.g., "Previously denied npm install in /tmp") */
  description: string;
  /** Hook event type */
  hook_event_name?: 'PermissionRequest' | 'PreToolUse';
  /** Tool being invoked */
  tool_name: string;
  /** Tool input */
  tool_input: Record<string, unknown>;
  /** Working directory */
  cwd: string;
  /** Optional project dir (for subagent scenarios) */
  project_dir?: string;
  /** Gatekeeper mode to test under */
  mode?: GatekeeperMode;
  /** Expected decision */
  expected_decision: 'approve' | 'escalate' | 'deny';
  /** Optional minimum confidence expected */
  expected_min_confidence?: ConfidenceLevel;
  /** Optional context overrides */
  context?: {
    user_permissions?: { allow?: string[]; deny?: string[]; ask?: string[] };
    claude_md?: string;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROJECT_ROOT = join(__dirname, '..', '..');
const CASES_DIR = join(__dirname, 'cases');

function loadCases(): { file: string; testCase: TestCase }[] {
  const files = readdirSync(CASES_DIR).filter(f => f.endsWith('.json'));
  return files.map(file => {
    const content = readFileSync(join(CASES_DIR, file), 'utf-8');
    return { file, testCase: JSON.parse(content) as TestCase };
  });
}

function loadCurrentPolicy(): string {
  return readFileSync(join(PROJECT_ROOT, 'templates', 'GATEKEEPER_POLICY.md'), 'utf-8');
}

function confidenceIndex(level: ConfidenceLevel): number {
  return CONFIDENCE_LEVELS.indexOf(level);
}

function buildTestConfig(mode: GatekeeperMode = 'allow-or-ask'): ApproverConfig {
  return {
    enabled: true,
    mode,
    backend: 'cli',
    model: 'haiku',
    confidenceThreshold: 'high',
    timeoutMs: 90000,
    maxContextLength: 4000,
    logFile: join(homedir(), '.claude', 'claude-gatekeeper', 'decisions.log'),
    logLevel: 'debug',
    alwaysEscalatePatterns: [],
    alwaysApprovePatterns: [],
  };
}

function buildTestContext(testCase: TestCase, policy: string): PromptContext {
  return {
    userSettings: testCase.context?.user_permissions
      ? { permissions: testCase.context.user_permissions }
      : null,
    projectSettings: null,
    claudeMd: testCase.context?.claude_md ?? null,
    projectClaudeMd: null,
    globalApprovalPolicy: policy,
    projectApprovalPolicy: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Prediction Quality', () => {
  let policy: string;
  let cases: { file: string; testCase: TestCase }[];

  beforeAll(() => {
    // Ensure project is built
    try {
      execSync('npm run build', { cwd: PROJECT_ROOT, stdio: 'pipe' });
    } catch { /* already built */ }

    policy = loadCurrentPolicy();
    cases = loadCases();

    if (cases.length === 0) {
      console.warn('\n  No test cases found in tests/prediction-quality/cases/');
      console.warn('  Add .json files to create test cases.\n');
    }
  });

  it('has at least one test case defined', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  // Dynamically generate a test for each case file
  describe('cases', () => {
    // Load cases eagerly so test.each works
    const allCases = (() => {
      try {
        const files = readdirSync(CASES_DIR).filter(f => f.endsWith('.json'));
        return files.map(file => {
          const content = readFileSync(join(CASES_DIR, file), 'utf-8');
          return { file, testCase: JSON.parse(content) as TestCase };
        });
      } catch {
        return [];
      }
    })();

    if (allCases.length === 0) return;

    allCases.forEach(({ file, testCase }) => {
      it(`${testCase.name} → expects ${testCase.expected_decision}`, async () => {
        const mode = testCase.mode ?? 'allow-or-ask';
        const config = buildTestConfig(mode);
        const context = buildTestContext(testCase, policy);

        const input: HookInput = {
          session_id: 'prediction-quality-test',
          cwd: testCase.cwd,
          hook_event_name: testCase.hook_event_name ?? 'PermissionRequest',
          tool_name: testCase.tool_name,
          tool_input: testCase.tool_input,
        };

        const { systemPrompt, userMessage } = buildPrompt(
          input,
          context,
          mode,
          testCase.project_dir,
        );

        // Log the full prompt for debugging failures
        console.log(`\n  [${file}] ${testCase.name}`);
        console.log(`  Tool: ${testCase.tool_name}`);
        console.log(`  Mode: ${mode}`);
        console.log(`  Description: ${testCase.description}`);

        const result = await evaluateWithCli(systemPrompt, userMessage, config);

        console.log(`  Decision: ${result.decision} (confidence: ${result.confidence})`);
        console.log(`  Reasoning: ${result.reasoning}`);
        console.log(`  Latency: ${result.latencyMs}ms`);

        // Core assertion: decision must match
        expect(result.decision).toBe(testCase.expected_decision);

        // Confidence assertion if specified
        if (testCase.expected_min_confidence) {
          const actualIdx = confidenceIndex(result.confidence);
          const expectedIdx = confidenceIndex(testCase.expected_min_confidence);
          expect(actualIdx).toBeGreaterThanOrEqual(expectedIdx);
        }
      }, 120000); // 2min timeout per case
    });
  });
});
