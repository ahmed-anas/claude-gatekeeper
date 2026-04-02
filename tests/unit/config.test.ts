import { readFileSync } from 'fs';

jest.mock('fs');
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/home/testuser'),
}));

const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;

// Import after mocks are set up
import { loadConfig, mergeConfig, resolvePath, DEFAULT_CONFIG } from '../../src/config';
import { homedir } from 'os';
const mockHomedir = homedir as jest.MockedFunction<typeof homedir>;

beforeEach(() => {
  jest.clearAllMocks();
  mockHomedir.mockReturnValue('/home/testuser');
});

describe('resolvePath', () => {
  it('resolves ~ to home directory', () => {
    expect(resolvePath('~/foo/bar')).toBe('/home/testuser/foo/bar');
  });

  it('leaves absolute paths unchanged', () => {
    expect(resolvePath('/absolute/path')).toBe('/absolute/path');
  });

  it('leaves relative paths unchanged', () => {
    expect(resolvePath('relative/path')).toBe('relative/path');
  });
});

describe('loadConfig', () => {
  it('returns defaults when config file does not exist', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const config = loadConfig();
    expect(config.enabled).toBe(true);
    expect(config.backend).toBe('cli');
    expect(config.model).toBe('haiku');
    expect(config.confidenceThreshold).toBe('high');
  });

  it('merges user config with defaults', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      confidenceThreshold: 'absolute',
      model: 'sonnet',
    }));

    const config = loadConfig();
    expect(config.confidenceThreshold).toBe('absolute');
    expect(config.model).toBe('sonnet');
    expect(config.enabled).toBe(true); // default preserved
  });

  it('handles malformed JSON gracefully', () => {
    mockReadFileSync.mockReturnValue('not valid json{{{');

    const config = loadConfig();
    expect(config).toEqual(expect.objectContaining({ enabled: true }));
  });
});

describe('mergeConfig', () => {
  it('validates confidenceThreshold against allowed levels', () => {
    expect(mergeConfig({ confidenceThreshold: 'medium' }).confidenceThreshold).toBe('medium');
    expect(mergeConfig({ confidenceThreshold: 'absolute' }).confidenceThreshold).toBe('absolute');
    expect(mergeConfig({ confidenceThreshold: 'invalid' as any }).confidenceThreshold).toBe('high'); // falls back to default
    expect(mergeConfig({ confidenceThreshold: 0.85 as any }).confidenceThreshold).toBe('high'); // numeric rejected
  });

  it('clamps timeoutMs to [1000, 120000]', () => {
    expect(mergeConfig({ timeoutMs: 100 }).timeoutMs).toBe(1000);
    expect(mergeConfig({ timeoutMs: 200000 }).timeoutMs).toBe(120000);
    expect(mergeConfig({ timeoutMs: 5000 }).timeoutMs).toBe(5000);
  });

  it('rejects invalid backend values', () => {
    expect(mergeConfig({ backend: 'invalid' as any }).backend).toBe('cli');
  });

  it('rejects invalid logLevel values', () => {
    expect(mergeConfig({ logLevel: 'verbose' as any }).logLevel).toBe('info');
  });

  it('merges user escalate patterns with defaults', () => {
    const config = mergeConfig({
      alwaysEscalatePatterns: ['my-custom-pattern'],
    });
    expect(config.alwaysEscalatePatterns).toContain('my-custom-pattern');
    expect(config.alwaysEscalatePatterns).toContain('sudo *'); // default preserved
  });

  it('does not duplicate default escalate patterns', () => {
    const config = mergeConfig({
      alwaysEscalatePatterns: ['sudo *'],
    });
    const sudoCount = config.alwaysEscalatePatterns.filter((p) => p === 'sudo *').length;
    expect(sudoCount).toBe(1);
  });

  it('resolves ~ in logFile path', () => {
    const config = mergeConfig({ logFile: '~/my-log.log' });
    expect(config.logFile).toBe('/home/testuser/my-log.log');
  });
});

describe('notify config', () => {
  it('passes through valid notify config', () => {
    const config = mergeConfig({ notify: { topic: 'test-topic' } });
    expect(config.notify).toEqual({ topic: 'test-topic', server: 'https://ntfy.sh', timeoutMs: 60000 });
  });

  it('defaults server and timeoutMs', () => {
    const config = mergeConfig({ notify: { topic: 'abc' } });
    expect(config.notify!.server).toBe('https://ntfy.sh');
    expect(config.notify!.timeoutMs).toBe(60000);
  });

  it('clamps notify timeoutMs to [5000, 120000]', () => {
    expect(mergeConfig({ notify: { topic: 'a', timeoutMs: 1000 } }).notify!.timeoutMs).toBe(5000);
    expect(mergeConfig({ notify: { topic: 'a', timeoutMs: 999999 } }).notify!.timeoutMs).toBe(120000);
  });

  it('strips notify if topic is empty', () => {
    const config = mergeConfig({ notify: { topic: '' } });
    expect(config.notify).toBeUndefined();
  });

  it('leaves notify undefined when not provided', () => {
    const config = mergeConfig({});
    expect(config.notify).toBeUndefined();
  });

  it('strips notify if topic is a number', () => {
    const config = mergeConfig({ notify: { topic: 123 as any } });
    expect(config.notify).toBeUndefined();
  });

  it('strips notify if topic is null', () => {
    const config = mergeConfig({ notify: { topic: null as any } });
    expect(config.notify).toBeUndefined();
  });
});
