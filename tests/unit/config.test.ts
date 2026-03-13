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

  it('clamps timeoutMs to [1000, 60000]', () => {
    expect(mergeConfig({ timeoutMs: 100 }).timeoutMs).toBe(1000);
    expect(mergeConfig({ timeoutMs: 100000 }).timeoutMs).toBe(60000);
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
