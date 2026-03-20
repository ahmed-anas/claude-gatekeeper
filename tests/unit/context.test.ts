import { loadContext, safeReadFile, safeParseJson, truncate } from '../../src/context';
import { readFileSync } from 'fs';
import { homedir } from 'os';

jest.mock('fs');
jest.mock('os');

const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;
const mockHomedir = homedir as jest.MockedFunction<typeof homedir>;

beforeEach(() => {
  mockHomedir.mockReturnValue('/home/testuser');
  jest.clearAllMocks();
});

describe('safeReadFile', () => {
  it('returns file content when file exists', () => {
    mockReadFileSync.mockReturnValue('file content');
    expect(safeReadFile('/some/file')).toBe('file content');
  });

  it('returns null when file does not exist', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(safeReadFile('/missing/file')).toBeNull();
  });
});

describe('safeParseJson', () => {
  it('parses valid JSON', () => {
    expect(safeParseJson('{"key": "value"}')).toEqual({ key: 'value' });
  });

  it('returns null for invalid JSON', () => {
    expect(safeParseJson('not json')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(safeParseJson(null)).toBeNull();
  });
});

describe('truncate', () => {
  it('returns text unchanged if within limit', () => {
    expect(truncate('short text', 100)).toBe('short text');
  });

  it('truncates long text with ellipsis', () => {
    const result = truncate('a'.repeat(100), 50);
    expect(result).toHaveLength(50);
    expect(result!.endsWith('...')).toBe(true);
  });

  it('returns null for null input', () => {
    expect(truncate(null, 100)).toBeNull();
  });
});

describe('loadContext', () => {
  it('loads all available context files', () => {
    const fileMap: Record<string, string> = {
      '/home/testuser/.claude/settings.json': '{"permissions": {"allow": ["Bash(npm *)"]}}',
      '/project/.claude/settings.json': '{"permissions": {"deny": []}}',
      '/home/testuser/.claude/CLAUDE.md': '# Global instructions',
      '/project/CLAUDE.md': '# Project instructions',
      '/project/GATEKEEPER_POLICY.md': '# Policy',
    };

    mockReadFileSync.mockImplementation((path: any) => {
      const content = fileMap[String(path)];
      if (content) return content;
      throw new Error('ENOENT');
    });

    const config = {
      enabled: true,
      mode: 'allow-or-ask' as const,
      backend: 'cli' as const,
      model: 'haiku',
      confidenceThreshold: 'high' as const,
      timeoutMs: 10000,
      maxContextLength: 2000,
      logFile: '/tmp/test.log',
      logLevel: 'info' as const,
      alwaysEscalatePatterns: [],
      alwaysApprovePatterns: [],
    };

    const context = loadContext('/project', config);

    expect(context.userSettings).toEqual({ permissions: { allow: ['Bash(npm *)'] } });
    expect(context.projectSettings).toEqual({ permissions: { deny: [] } });
    expect(context.claudeMd).toBe('# Global instructions');
    expect(context.projectClaudeMd).toBe('# Project instructions');
    expect(context.projectApprovalPolicy).toBe('# Policy');
  });

  it('returns nulls when no files exist', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const config = {
      enabled: true,
      mode: 'allow-or-ask' as const,
      backend: 'cli' as const,
      model: 'haiku',
      confidenceThreshold: 'high' as const,
      timeoutMs: 10000,
      maxContextLength: 2000,
      logFile: '/tmp/test.log',
      logLevel: 'info' as const,
      alwaysEscalatePatterns: [],
      alwaysApprovePatterns: [],
    };

    const context = loadContext('/project', config);

    expect(context.userSettings).toBeNull();
    expect(context.projectSettings).toBeNull();
    expect(context.claudeMd).toBeNull();
    expect(context.projectClaudeMd).toBeNull();
    expect(context.globalApprovalPolicy).toBeNull();
    expect(context.projectApprovalPolicy).toBeNull();
  });

  it('truncates long CLAUDE.md content', () => {
    mockReadFileSync.mockImplementation((path: any) => {
      if (String(path).endsWith('CLAUDE.md')) return 'x'.repeat(5000);
      throw new Error('ENOENT');
    });

    const config = {
      enabled: true,
      mode: 'allow-or-ask' as const,
      backend: 'cli' as const,
      model: 'haiku',
      confidenceThreshold: 'high' as const,
      timeoutMs: 10000,
      maxContextLength: 100,
      logFile: '/tmp/test.log',
      logLevel: 'info' as const,
      alwaysEscalatePatterns: [],
      alwaysApprovePatterns: [],
    };

    const context = loadContext('/project', config);

    expect(context.claudeMd!.length).toBe(100);
    expect(context.claudeMd!.endsWith('...')).toBe(true);
  });

  it('loads both global and project approval policies', () => {
    const fileMap: Record<string, string> = {
      '/home/testuser/.claude/claude-gatekeeper/GATEKEEPER_POLICY.md': '# Global policy',
      '/project/GATEKEEPER_POLICY.md': '# Project policy',
    };

    mockReadFileSync.mockImplementation((path: any) => {
      const content = fileMap[String(path)];
      if (content) return content;
      throw new Error('ENOENT');
    });

    const config = {
      enabled: true,
      mode: 'allow-or-ask' as const,
      backend: 'cli' as const,
      model: 'haiku',
      confidenceThreshold: 'high' as const,
      timeoutMs: 10000,
      maxContextLength: 2000,
      logFile: '/tmp/test.log',
      logLevel: 'info' as const,
      alwaysEscalatePatterns: [],
      alwaysApprovePatterns: [],
    };

    const context = loadContext('/project', config);
    expect(context.globalApprovalPolicy).toBe('# Global policy');
    expect(context.projectApprovalPolicy).toBe('# Project policy');
  });

  it('loads global policy when no project policy exists', () => {
    mockReadFileSync.mockImplementation((path: any) => {
      if (String(path) === '/home/testuser/.claude/claude-gatekeeper/GATEKEEPER_POLICY.md') return '# Global only';
      throw new Error('ENOENT');
    });

    const config = {
      enabled: true,
      mode: 'allow-or-ask' as const,
      backend: 'cli' as const,
      model: 'haiku',
      confidenceThreshold: 'high' as const,
      timeoutMs: 10000,
      maxContextLength: 2000,
      logFile: '/tmp/test.log',
      logLevel: 'info' as const,
      alwaysEscalatePatterns: [],
      alwaysApprovePatterns: [],
    };

    const context = loadContext('/project', config);
    expect(context.globalApprovalPolicy).toBe('# Global only');
    expect(context.projectApprovalPolicy).toBeNull();
  });

  it('falls back to .claude/GATEKEEPER_POLICY.md', () => {
    mockReadFileSync.mockImplementation((path: any) => {
      if (String(path) === '/project/.claude/GATEKEEPER_POLICY.md') return '# Fallback policy';
      throw new Error('ENOENT');
    });

    const config = {
      enabled: true,
      mode: 'allow-or-ask' as const,
      backend: 'cli' as const,
      model: 'haiku',
      confidenceThreshold: 'high' as const,
      timeoutMs: 10000,
      maxContextLength: 2000,
      logFile: '/tmp/test.log',
      logLevel: 'info' as const,
      alwaysEscalatePatterns: [],
      alwaysApprovePatterns: [],
    };

    const context = loadContext('/project', config);
    expect(context.projectApprovalPolicy).toBe('# Fallback policy');
  });
});
