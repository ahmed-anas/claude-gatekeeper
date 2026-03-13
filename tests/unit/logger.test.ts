import { logDecision, logWarning, logError, logDebug } from '../../src/logger';
import { appendFileSync, mkdirSync } from 'fs';
import { ApproverConfig, EvaluationResult, HookInput } from '../../src/types';

jest.mock('fs');

const mockAppendFileSync = appendFileSync as jest.MockedFunction<typeof appendFileSync>;
const mockMkdirSync = mkdirSync as jest.MockedFunction<typeof mkdirSync>;

const baseConfig: ApproverConfig = {
  enabled: true,
  backend: 'cli',
  model: 'haiku',
  confidenceThreshold: 'high',
  timeoutMs: 10000,
  maxContextLength: 2000,
  logFile: '/tmp/test-decisions.log',
  logLevel: 'info',
  alwaysEscalatePatterns: [],
  alwaysApprovePatterns: [],
};

const baseInput: HookInput = {
  session_id: 'test-session',
  cwd: '/home/user/project',
  hook_event_name: 'PermissionRequest',
  tool_name: 'Bash',
  tool_input: { command: 'npm test' },
};

const baseResult: EvaluationResult = {
  decision: 'approve',
  confidence: 'high',
  reasoning: 'Safe dev command',
  model: 'cli:haiku',
  latencyMs: 1200,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockMkdirSync.mockReturnValue(undefined);
});

describe('logDecision', () => {
  it('writes a formatted log line', () => {
    logDecision(baseInput, baseResult, baseConfig);

    expect(mockAppendFileSync).toHaveBeenCalledTimes(1);
    const logLine = mockAppendFileSync.mock.calls[0][1] as string;
    expect(logLine).toContain('decision=approve');
    expect(logLine).toContain('confidence=high');
    expect(logLine).toContain('model=cli:haiku');
    expect(logLine).toContain('tool=Bash');
    expect(logLine).toContain('npm test');
    expect(logLine).toContain('Safe dev command');
  });

  it('does not log when logLevel is warn', () => {
    logDecision(baseInput, baseResult, { ...baseConfig, logLevel: 'warn' });
    expect(mockAppendFileSync).not.toHaveBeenCalled();
  });

  it('truncates long commands', () => {
    const longInput = {
      ...baseInput,
      tool_input: { command: 'x'.repeat(200) },
    };
    logDecision(longInput, baseResult, baseConfig);

    const logLine = mockAppendFileSync.mock.calls[0][1] as string;
    expect(logLine).toContain('...');
    expect(logLine.length).toBeLessThan(500);
  });

  it('summarizes Write tool input as file_path', () => {
    const writeInput: HookInput = {
      ...baseInput,
      tool_name: 'Write',
      tool_input: { file_path: '/src/index.ts', content: 'lots of code' },
    };
    logDecision(writeInput, baseResult, baseConfig);

    const logLine = mockAppendFileSync.mock.calls[0][1] as string;
    expect(logLine).toContain('/src/index.ts');
  });

  it('swallows errors silently', () => {
    mockAppendFileSync.mockImplementation(() => {
      throw new Error('disk full');
    });

    expect(() => logDecision(baseInput, baseResult, baseConfig)).not.toThrow();
  });
});

describe('logWarning', () => {
  it('writes a warning line', () => {
    logWarning('API key not set', baseConfig);

    const logLine = mockAppendFileSync.mock.calls[0][1] as string;
    expect(logLine).toContain('WARN');
    expect(logLine).toContain('API key not set');
  });
});

describe('logError', () => {
  it('writes an error line with tool info', () => {
    logError(baseInput, new Error('timeout'), baseConfig);

    const logLine = mockAppendFileSync.mock.calls[0][1] as string;
    expect(logLine).toContain('ERROR');
    expect(logLine).toContain('tool=Bash');
    expect(logLine).toContain('timeout');
  });

  it('handles null input', () => {
    logError(null, new Error('startup failure'), baseConfig);

    const logLine = mockAppendFileSync.mock.calls[0][1] as string;
    expect(logLine).toContain('ERROR');
    expect(logLine).toContain('startup failure');
  });

  it('handles non-Error objects', () => {
    logError(null, 'string error', baseConfig);

    const logLine = mockAppendFileSync.mock.calls[0][1] as string;
    expect(logLine).toContain('string error');
  });
});

describe('logDebug', () => {
  it('writes when logLevel is debug', () => {
    logDebug('detailed info', { ...baseConfig, logLevel: 'debug' });
    expect(mockAppendFileSync).toHaveBeenCalledTimes(1);
  });

  it('does not write when logLevel is info', () => {
    logDebug('detailed info', baseConfig);
    expect(mockAppendFileSync).not.toHaveBeenCalled();
  });
});
