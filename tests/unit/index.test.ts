/**
 * Tests for the main hook pipeline (src/index.ts).
 *
 * All dependencies are mocked so we can test the orchestration logic
 * in isolation. Each test exercises a specific code path through main().
 */

import { HookInput, PermissionRequestOutput, PreToolUseOutput, ApproverConfig } from '../../src/types';

// Mock all dependencies before importing the module under test
jest.mock('fs', () => ({ readFileSync: jest.fn() }));
jest.mock('../../src/config', () => ({ loadConfig: jest.fn() }));
jest.mock('../../src/context', () => ({ loadContext: jest.fn() }));
jest.mock('../../src/prompt', () => ({ buildPrompt: jest.fn() }));
jest.mock('../../src/evaluator', () => ({ evaluate: jest.fn() }));
jest.mock('../../src/rules', () => ({ checkRules: jest.fn() }));
jest.mock('../../src/logger', () => ({
  logDecision: jest.fn(),
  logDebug: jest.fn(),
  logError: jest.fn(),
  logWarning: jest.fn(),
}));

import { readFileSync } from 'fs';
import { loadConfig } from '../../src/config';
import { loadContext } from '../../src/context';
import { buildPrompt } from '../../src/prompt';
import { evaluate } from '../../src/evaluator';
import { checkRules } from '../../src/rules';
import { logDecision, logError } from '../../src/logger';
import { main, writePermissionApproval, writePreToolUseAllow, writePreToolUseDeny } from '../../src/index';

const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;
const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>;
const mockLoadContext = loadContext as jest.MockedFunction<typeof loadContext>;
const mockBuildPrompt = buildPrompt as jest.MockedFunction<typeof buildPrompt>;
const mockEvaluate = evaluate as jest.MockedFunction<typeof evaluate>;
const mockCheckRules = checkRules as jest.MockedFunction<typeof checkRules>;
const mockLogDecision = logDecision as jest.MockedFunction<typeof logDecision>;
const mockLogError = logError as jest.MockedFunction<typeof logError>;

const validInput: HookInput = {
  session_id: 'test',
  cwd: '/project',
  hook_event_name: 'PermissionRequest',
  tool_name: 'Bash',
  tool_input: { command: 'npm test' },
};

const defaultConfig: ApproverConfig = {
  enabled: true,
  mode: 'allow-or-ask' as const,
  backend: 'cli',
  model: 'haiku',
  confidenceThreshold: 'high',
  timeoutMs: 10000,
  maxContextLength: 2000,
  logFile: '/tmp/test.log',
  logLevel: 'info',
  alwaysEscalatePatterns: [],
  alwaysApprovePatterns: [],
};

const emptyContext = {
  userSettings: null,
  projectSettings: null,
  claudeMd: null,
  projectClaudeMd: null,
  globalApprovalPolicy: null,
  projectApprovalPolicy: null,
};

describe('main()', () => {
  let stdoutSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    // Default mocks for the happy path
    mockReadFileSync.mockReturnValue(JSON.stringify(validInput));
    mockLoadConfig.mockReturnValue(defaultConfig);
    mockLoadContext.mockReturnValue(emptyContext);
    mockBuildPrompt.mockReturnValue({ systemPrompt: 'sys', userMessage: 'usr' });
    mockCheckRules.mockReturnValue('evaluate');
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  // --- Approval flows ---

  it('auto-approves when AI returns approve with high confidence', async () => {
    mockEvaluate.mockResolvedValue({
      decision: 'approve',
      confidence: 'high',
      reasoning: 'Safe dev command',
      model: 'cli:haiku',
      latencyMs: 1000,
    });

    await main();

    // Should write approval JSON to stdout
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(output.hookSpecificOutput.decision.behavior).toBe('allow');

    // Should log the decision
    expect(mockLogDecision).toHaveBeenCalledTimes(1);

    // Should NOT call process.exit
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('auto-approves when static rules match approve pattern', async () => {
    mockCheckRules.mockReturnValue('approve');

    await main();

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(output.hookSpecificOutput.decision.behavior).toBe('allow');

    // Should log with model=static
    expect(mockLogDecision).toHaveBeenCalledWith(
      validInput,
      expect.objectContaining({ model: 'static', decision: 'approve' }),
      defaultConfig,
    );

    // Should NOT call the AI evaluator
    expect(mockEvaluate).not.toHaveBeenCalled();
  });

  // --- Escalation flows ---

  it('escalates when AI confidence is below threshold', async () => {
    mockEvaluate.mockResolvedValue({
      decision: 'approve',
      confidence: 'medium', // below 'high' threshold
      reasoning: 'Uncertain',
      model: 'cli:haiku',
      latencyMs: 1000,
    });

    await main();

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(mockLogDecision).toHaveBeenCalledTimes(1);
  });

  it('escalates when AI returns escalate decision', async () => {
    mockEvaluate.mockResolvedValue({
      decision: 'escalate',
      confidence: 'high',
      reasoning: 'Looks dangerous',
      model: 'cli:haiku',
      latencyMs: 1000,
    });

    await main();

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('escalates when static rules match escalate pattern', async () => {
    mockCheckRules.mockReturnValue('escalate');

    await main();

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(stdoutSpy).not.toHaveBeenCalled();

    // Should log with model=static
    expect(mockLogDecision).toHaveBeenCalledWith(
      validInput,
      expect.objectContaining({ model: 'static', decision: 'escalate' }),
      defaultConfig,
    );

    // Should NOT call the AI evaluator
    expect(mockEvaluate).not.toHaveBeenCalled();
  });

  it('escalates when config is disabled', async () => {
    mockLoadConfig.mockReturnValue({ ...defaultConfig, enabled: false });

    await main();

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(mockCheckRules).not.toHaveBeenCalled();
    expect(mockEvaluate).not.toHaveBeenCalled();
  });

  // --- Error flows (all result in escalation) ---

  it('escalates on invalid stdin JSON', async () => {
    mockReadFileSync.mockReturnValue('not valid json{{{');

    await main();

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('escalates on stdin read error', async () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('stdin read failed');
    });

    await main();

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('escalates on config load error', async () => {
    mockLoadConfig.mockImplementation(() => {
      throw new Error('config load failed');
    });

    await main();

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('escalates on evaluator error and logs it', async () => {
    mockEvaluate.mockRejectedValue(new Error('network timeout'));

    await main();

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith(
      validInput,
      expect.any(Error),
      defaultConfig,
    );
  });

  it('escalates silently when both evaluator and logger throw', async () => {
    mockEvaluate.mockRejectedValue(new Error('network timeout'));
    mockLogError.mockImplementation(() => {
      throw new Error('log disk full');
    });

    await main();

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  // --- Pipeline integration checks ---

  it('passes correct context through the pipeline', async () => {
    mockEvaluate.mockResolvedValue({
      decision: 'approve',
      confidence: 'high',
      reasoning: 'Safe',
      model: 'cli:haiku',
      latencyMs: 500,
    });

    await main();

    // Verify context was loaded with correct cwd
    expect(mockLoadContext).toHaveBeenCalledWith('/project', defaultConfig);

    // Verify prompt was built with the loaded context
    expect(mockBuildPrompt).toHaveBeenCalledWith(validInput, emptyContext, 'allow-or-ask', '/project');

    // Verify evaluator was called with the built prompt
    expect(mockEvaluate).toHaveBeenCalledWith('sys', 'usr', defaultConfig);
  });
});

describe('writePermissionApproval()', () => {
  it('writes correct PermissionRequest allow JSON', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    writePermissionApproval();
    const output = JSON.parse(spy.mock.calls[0][0] as string) as PermissionRequestOutput;
    expect(output.hookSpecificOutput.hookEventName).toBe('PermissionRequest');
    expect(output.hookSpecificOutput.decision.behavior).toBe('allow');
    spy.mockRestore();
  });
});

describe('writePreToolUseAllow()', () => {
  it('writes correct PreToolUse allow JSON', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    writePreToolUseAllow();
    const output = JSON.parse(spy.mock.calls[0][0] as string) as PreToolUseOutput;
    expect(output.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow');
    spy.mockRestore();
  });
});

describe('writePreToolUseDeny()', () => {
  it('writes correct PreToolUse deny JSON with reason', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    writePreToolUseDeny('too dangerous');
    const output = JSON.parse(spy.mock.calls[0][0] as string) as PreToolUseOutput;
    expect(output.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain('too dangerous');
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain('Claude Gatekeeper');
    spy.mockRestore();
  });
});
