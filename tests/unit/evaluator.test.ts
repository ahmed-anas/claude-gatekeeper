/**
 * Tests for the AI evaluation module (src/evaluator.ts).
 *
 * Tests cover:
 * - AI response parsing (JSON, keywords, edge cases)
 * - CLI backend (mocked child_process.spawn)
 * - API backend (mocked @anthropic-ai/sdk)
 * - evaluate() routing logic (backend selection, API key fallback)
 */

import { parseAiResponse, evaluateWithCli, evaluateWithApi, evaluate } from '../../src/evaluator';
import { spawn } from 'child_process';
import { ApproverConfig } from '../../src/types';
import { EventEmitter } from 'events';

jest.mock('child_process');
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

const baseConfig: ApproverConfig = {
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

// --- Helper to create mock child processes ---

function createMockProcess(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: Error;
  delay?: number;
}) {
  const proc = new EventEmitter() as any;
  proc.stdin = { write: jest.fn(), end: jest.fn() };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn();

  const delay = opts.delay ?? 10;
  setTimeout(() => {
    if (opts.error) {
      proc.emit('error', opts.error);
    } else {
      if (opts.stdout) proc.stdout.emit('data', Buffer.from(opts.stdout));
      if (opts.stderr) proc.stderr.emit('data', Buffer.from(opts.stderr));
      proc.emit('close', opts.exitCode ?? 0);
    }
  }, delay);

  return proc;
}

// --- parseAiResponse ---

describe('parseAiResponse', () => {
  it('parses valid JSON approve response', () => {
    const result = parseAiResponse('{"decision": "approve", "confidence": "high", "reasoning": "Safe command"}');
    expect(result.decision).toBe('approve');
    expect(result.confidence).toBe('high');
    expect(result.reasoning).toBe('Safe command');
  });

  it('parses valid JSON escalate response', () => {
    const result = parseAiResponse('{"decision": "escalate", "confidence": "absolute", "reasoning": "Dangerous"}');
    expect(result.decision).toBe('escalate');
    expect(result.confidence).toBe('absolute');
  });

  it('defaults invalid confidence to low', () => {
    expect(parseAiResponse('{"decision": "approve", "confidence": "banana", "reasoning": "x"}').confidence).toBe('low');
    expect(parseAiResponse('{"decision": "approve", "confidence": 0.95, "reasoning": "x"}').confidence).toBe('low');
  });

  it('defaults confidence to low when missing', () => {
    const result = parseAiResponse('{"decision": "approve", "reasoning": "test"}');
    expect(result.confidence).toBe('low');
  });

  it('handles JSON embedded in text', () => {
    const result = parseAiResponse('Here is my analysis:\n{"decision": "approve", "confidence": "high", "reasoning": "OK"}\nDone.');
    expect(result.decision).toBe('approve');
    expect(result.confidence).toBe('high');
  });

  it('handles invalid decision value in JSON (falls through to keywords)', () => {
    const result = parseAiResponse('{"decision": "maybe", "confidence": "high"}');
    expect(result.decision).toBe('escalate'); // "maybe" is not valid, no approve keyword
  });

  it('handles malformed JSON that matches regex but fails parse', () => {
    const result = parseAiResponse('{"decision": approve}'); // missing quotes
    expect(result.decision).toBe('approve'); // falls back to keyword matching
    expect(result.confidence).toBe('low');
  });

  it('falls back to keyword matching — approve', () => {
    const result = parseAiResponse('I would approve this command as it is safe.');
    expect(result.decision).toBe('approve');
    expect(result.confidence).toBe('low');
  });

  it('falls back to keyword matching — escalate wins over approve', () => {
    const result = parseAiResponse('I would not approve, should escalate this.');
    expect(result.decision).toBe('escalate');
  });

  it('defaults to escalate when no keywords match', () => {
    const result = parseAiResponse('I am not sure about this command.');
    expect(result.decision).toBe('escalate');
  });

  it('handles empty response', () => {
    const result = parseAiResponse('');
    expect(result.decision).toBe('escalate');
  });

  it('provides default reasoning when missing from JSON', () => {
    const result = parseAiResponse('{"decision": "approve"}');
    expect(result.reasoning).toBe('No reasoning provided');
  });

  it('accepts all valid confidence levels', () => {
    for (const level of ['none', 'low', 'medium', 'high', 'absolute']) {
      const result = parseAiResponse(`{"decision": "approve", "confidence": "${level}", "reasoning": "test"}`);
      expect(result.confidence).toBe(level);
    }
  });
});

// --- evaluateWithCli ---

describe('evaluateWithCli', () => {
  it('returns approve for successful AI response', async () => {
    const jsonOut = JSON.stringify({
      result: '{"decision": "approve", "confidence": "high", "reasoning": "Safe"}',
    });
    mockSpawn.mockReturnValue(createMockProcess({ stdout: jsonOut }));

    const result = await evaluateWithCli('system', 'user', baseConfig);
    expect(result.decision).toBe('approve');
    expect(result.confidence).toBe('high');
    expect(result.model).toBe('cli:haiku');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('falls back to raw stdout parsing when JSON outer parse fails', async () => {
    // stdout is not valid JSON wrapper, but contains AI response directly
    const rawResponse = '{"decision": "approve", "confidence": "absolute", "reasoning": "Looks safe"}';
    mockSpawn.mockReturnValue(createMockProcess({ stdout: rawResponse }));

    const result = await evaluateWithCli('system', 'user', baseConfig);
    expect(result.decision).toBe('approve');
    expect(result.confidence).toBe('absolute');
  });

  it('returns escalate when CLI exits with non-zero code', async () => {
    mockSpawn.mockReturnValue(createMockProcess({ exitCode: 1, stderr: 'auth error' }));

    const result = await evaluateWithCli('system', 'user', baseConfig);
    expect(result.decision).toBe('escalate');
    expect(result.confidence).toBe('none');
    expect(result.reasoning).toContain('auth error');
  });

  it('returns escalate on spawn error (command not found)', async () => {
    mockSpawn.mockReturnValue(createMockProcess({ error: new Error('command not found') }));

    const result = await evaluateWithCli('system', 'user', baseConfig);
    expect(result.decision).toBe('escalate');
    expect(result.reasoning).toContain('command not found');
  });

  it('returns escalate on timeout and kills the process', async () => {
    const proc = new EventEmitter() as any;
    proc.stdin = { write: jest.fn(), end: jest.fn() };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = jest.fn();
    // Never emits close — simulates a hang

    mockSpawn.mockReturnValue(proc);

    const result = await evaluateWithCli('system', 'user', { ...baseConfig, timeoutMs: 1000 });
    expect(result.decision).toBe('escalate');
    expect(result.reasoning).toContain('timed out');
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  }, 15000);

  it('writes the prompt to stdin and closes it', async () => {
    const jsonOut = JSON.stringify({ result: '{"decision": "escalate", "confidence": "high", "reasoning": "test"}' });
    const proc = createMockProcess({ stdout: jsonOut });
    mockSpawn.mockReturnValue(proc);

    await evaluateWithCli('my system prompt', 'my user message', baseConfig);

    expect(proc.stdin.write).toHaveBeenCalledWith('my system prompt\n\n---\n\nmy user message');
    expect(proc.stdin.end).toHaveBeenCalled();
  });

  it('spawns claude with correct arguments', async () => {
    const jsonOut = JSON.stringify({ result: '{"decision": "escalate", "confidence": "high"}' });
    mockSpawn.mockReturnValue(createMockProcess({ stdout: jsonOut }));

    await evaluateWithCli('sys', 'usr', { ...baseConfig, model: 'sonnet' });

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      ['-p', '--model', 'sonnet', '--output-format', 'json'],
      expect.objectContaining({
        stdio: ['pipe', 'pipe', 'pipe'],
        env: expect.objectContaining({ CLAUDECODE: '' }),
      }),
    );
  });
});

// --- evaluateWithApi ---

describe('evaluateWithApi', () => {
  it('returns approve for successful API response', async () => {
    const Anthropic = require('@anthropic-ai/sdk').default;
    Anthropic.mockImplementation(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: '{"decision": "approve", "confidence": "high", "reasoning": "Safe npm command"}' }],
        }),
      },
    }));

    const result = await evaluateWithApi('system', 'user', baseConfig);
    expect(result.decision).toBe('approve');
    expect(result.confidence).toBe('high');
    expect(result.model).toBe('api:haiku');
  });

  it('maps "haiku" model name to full model ID', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"decision": "escalate", "confidence": "high", "reasoning": "test"}' }],
    });
    const Anthropic = require('@anthropic-ai/sdk').default;
    Anthropic.mockImplementation(() => ({ messages: { create: mockCreate } }));

    await evaluateWithApi('sys', 'usr', baseConfig);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5-20251001' }),
      expect.anything(),
    );
  });

  it('passes custom model name directly', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"decision": "escalate", "confidence": "high", "reasoning": "test"}' }],
    });
    const Anthropic = require('@anthropic-ai/sdk').default;
    Anthropic.mockImplementation(() => ({ messages: { create: mockCreate } }));

    await evaluateWithApi('sys', 'usr', { ...baseConfig, model: 'claude-sonnet-4-6' });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-6' }),
      expect.anything(),
    );
  });

  it('returns escalate when API throws', async () => {
    const Anthropic = require('@anthropic-ai/sdk').default;
    Anthropic.mockImplementation(() => ({
      messages: {
        create: jest.fn().mockRejectedValue(new Error('rate limited')),
      },
    }));

    const result = await evaluateWithApi('system', 'user', baseConfig);
    expect(result.decision).toBe('escalate');
    expect(result.reasoning).toContain('rate limited');
    expect(result.model).toBe('api:haiku');
  });

  it('returns escalate for non-Error exceptions', async () => {
    const Anthropic = require('@anthropic-ai/sdk').default;
    Anthropic.mockImplementation(() => ({
      messages: {
        create: jest.fn().mockRejectedValue('string error'),
      },
    }));

    const result = await evaluateWithApi('system', 'user', baseConfig);
    expect(result.decision).toBe('escalate');
    expect(result.reasoning).toContain('string error');
  });

  it('filters non-text content blocks', async () => {
    const Anthropic = require('@anthropic-ai/sdk').default;
    Anthropic.mockImplementation(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [
            { type: 'thinking', thinking: 'hmm' },
            { type: 'text', text: '{"decision": "approve", "confidence": "high", "reasoning": "safe"}' },
          ],
        }),
      },
    }));

    const result = await evaluateWithApi('sys', 'usr', baseConfig);
    expect(result.decision).toBe('approve');
  });
});

// --- evaluate() routing ---

describe('evaluate()', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('uses CLI backend by default', async () => {
    const jsonOut = JSON.stringify({ result: '{"decision": "escalate", "confidence": "high", "reasoning": "test"}' });
    mockSpawn.mockReturnValue(createMockProcess({ stdout: jsonOut }));

    const result = await evaluate('sys', 'usr', { ...baseConfig, backend: 'cli' });
    expect(result.model).toContain('cli:');
    expect(mockSpawn).toHaveBeenCalled();
  });

  it('falls back to CLI when api backend lacks API key', async () => {
    process.env = { ...originalEnv, ANTHROPIC_API_KEY: '' };
    const jsonOut = JSON.stringify({ result: '{"decision": "escalate", "confidence": "high", "reasoning": "test"}' });
    mockSpawn.mockReturnValue(createMockProcess({ stdout: jsonOut }));

    const result = await evaluate('sys', 'usr', { ...baseConfig, backend: 'api' });
    expect(result.model).toContain('cli:');
  });

  it('uses API backend when api backend has API key', async () => {
    process.env = { ...originalEnv, ANTHROPIC_API_KEY: 'sk-test-key' };
    const Anthropic = require('@anthropic-ai/sdk').default;
    Anthropic.mockImplementation(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: '{"decision": "approve", "confidence": "high", "reasoning": "safe"}' }],
        }),
      },
    }));

    const result = await evaluate('sys', 'usr', { ...baseConfig, backend: 'api' });
    expect(result.model).toContain('api:');
  });
});
