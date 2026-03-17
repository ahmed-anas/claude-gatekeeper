import { statSync } from 'fs';

jest.mock('fs');
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/Users/testuser'),
}));

const mockStatSync = statSync as jest.MockedFunction<typeof statSync>;

import {
  encodeProjectPath,
  decodeProjectSlug,
  extractSlugFromTranscriptPath,
  resolveProjectDir,
} from '../../src/project-dir';
import { HookInput } from '../../src/types';

// Helper: make statSync return isDirectory=true for given paths
function setDirectories(paths: string[]): void {
  mockStatSync.mockImplementation((p: any) => {
    if (paths.includes(String(p))) {
      return { isDirectory: () => true } as any;
    }
    throw new Error('ENOENT');
  });
}

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// encodeProjectPath — replicate Claude Code's encoding
// ---------------------------------------------------------------------------

describe('encodeProjectPath', () => {
  it('replaces forward slashes with dashes', () => {
    expect(encodeProjectPath('/Users/ahmed/code')).toBe('-Users-ahmed-code');
  });

  it('replaces dots with dashes', () => {
    expect(encodeProjectPath('/home/user/.config')).toBe('-home-user--config');
  });

  it('replaces spaces with dashes', () => {
    expect(encodeProjectPath('/home/user/my project')).toBe('-home-user-my-project');
  });

  it('keeps alphanumeric chars unchanged', () => {
    expect(encodeProjectPath('/Users/abc123/XYZ')).toBe('-Users-abc123-XYZ');
  });

  it('replaces underscores with dashes', () => {
    expect(encodeProjectPath('/home/user/my_project')).toBe('-home-user-my-project');
  });

  it('handles paths with hyphens (hyphens stay as hyphens)', () => {
    expect(encodeProjectPath('/Users/ahmed/claude-ai-approver')).toBe('-Users-ahmed-claude-ai-approver');
  });
});

// ---------------------------------------------------------------------------
// decodeProjectSlug — greedy filesystem walk
// ---------------------------------------------------------------------------

describe('decodeProjectSlug', () => {
  it('decodes a simple path without hyphens', () => {
    setDirectories(['/Users', '/Users/ahmed', '/Users/ahmed/code']);
    expect(decodeProjectSlug('-Users-ahmed-code')).toBe('/Users/ahmed/code');
  });

  it('decodes a path with hyphens in directory names', () => {
    // "claude-ai-approver" is a single directory name with hyphens
    setDirectories([
      '/Users',
      '/Users/ahmed',
      '/Users/ahmed/mixmax',
      '/Users/ahmed/mixmax/code',
      '/Users/ahmed/mixmax/code/claude-ai-approver',
    ]);
    // "/Users/ahmed/mixmax/code/claude" does NOT exist as a directory
    expect(decodeProjectSlug('-Users-ahmed-mixmax-code-claude-ai-approver'))
      .toBe('/Users/ahmed/mixmax/code/claude-ai-approver');
  });

  it('decodes a path with multiple hyphenated directory names', () => {
    setDirectories([
      '/home',
      '/home/john-doe',
      '/home/john-doe/my-project',
    ]);
    // "/home/john" does NOT exist
    expect(decodeProjectSlug('-home-john-doe-my-project'))
      .toBe('/home/john-doe/my-project');
  });

  it('decodes a real-world macOS path', () => {
    setDirectories([
      '/Users',
      '/Users/ahmedanas',
      '/Users/ahmedanas/mixmax',
      '/Users/ahmedanas/mixmax/code',
    ]);
    expect(decodeProjectSlug('-Users-ahmedanas-mixmax-code'))
      .toBe('/Users/ahmedanas/mixmax/code');
  });

  it('handles a Linux home path', () => {
    setDirectories(['/home', '/home/alice', '/home/alice/projects', '/home/alice/projects/webapp']);
    expect(decodeProjectSlug('-home-alice-projects-webapp'))
      .toBe('/home/alice/projects/webapp');
  });

  it('returns null for empty slug', () => {
    expect(decodeProjectSlug('')).toBeNull();
  });

  it('returns null for slug without leading dash', () => {
    expect(decodeProjectSlug('Users-ahmed-code')).toBeNull();
  });

  it('handles a path where every segment is a single char', () => {
    setDirectories(['/a', '/a/b', '/a/b/c']);
    expect(decodeProjectSlug('-a-b-c')).toBe('/a/b/c');
  });

  it('handles deeply nested paths', () => {
    setDirectories([
      '/Users',
      '/Users/ahmed',
      '/Users/ahmed/mixmax',
      '/Users/ahmed/mixmax/code',
      '/Users/ahmed/mixmax/code/services',
      '/Users/ahmed/mixmax/code/services/api-gateway',
    ]);
    expect(decodeProjectSlug('-Users-ahmed-mixmax-code-services-api-gateway'))
      .toBe('/Users/ahmed/mixmax/code/services/api-gateway');
  });

  it('prefers "/" over "-" when both result in valid directories', () => {
    // If both /a/b and /a-b exist as directories, prefers /a/b (tries "/" first)
    setDirectories(['/a', '/a/b', '/a/b/c']);
    expect(decodeProjectSlug('-a-b-c')).toBe('/a/b/c');
  });
});

// ---------------------------------------------------------------------------
// extractSlugFromTranscriptPath
// ---------------------------------------------------------------------------

describe('extractSlugFromTranscriptPath', () => {
  it('extracts slug from a standard transcript path', () => {
    const path = '/Users/testuser/.claude/projects/-Users-ahmed-code/abc123.jsonl';
    expect(extractSlugFromTranscriptPath(path)).toBe('-Users-ahmed-code');
  });

  it('extracts slug with hyphens in directory names', () => {
    const path = '/Users/testuser/.claude/projects/-Users-ahmed-claude-ai-approver/session.jsonl';
    expect(extractSlugFromTranscriptPath(path)).toBe('-Users-ahmed-claude-ai-approver');
  });

  it('returns null for non-projects path', () => {
    expect(extractSlugFromTranscriptPath('/some/other/path')).toBeNull();
  });

  it('returns null for path without session file', () => {
    expect(extractSlugFromTranscriptPath('/Users/testuser/.claude/projects/-slug')).toBeNull();
  });

  it('handles nested subagent transcript paths', () => {
    const path = '/Users/testuser/.claude/projects/-Users-ahmed-code/session/subagents/agent.jsonl';
    expect(extractSlugFromTranscriptPath(path)).toBe('-Users-ahmed-code');
  });
});

// ---------------------------------------------------------------------------
// resolveProjectDir — full integration
// ---------------------------------------------------------------------------

describe('resolveProjectDir', () => {
  function makeInput(overrides: Partial<HookInput> = {}): HookInput {
    return {
      session_id: 'test',
      cwd: '/private/tmp',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'echo hello' },
      ...overrides,
    };
  }

  it('uses transcript_path when cwd is /private/tmp', () => {
    setDirectories([
      '/Users',
      '/Users/ahmed',
      '/Users/ahmed/mixmax',
      '/Users/ahmed/mixmax/code',
    ]);

    const input = makeInput({
      cwd: '/private/tmp',
      transcript_path: '/Users/testuser/.claude/projects/-Users-ahmed-mixmax-code/session.jsonl',
    });

    expect(resolveProjectDir(input)).toBe('/Users/ahmed/mixmax/code');
  });

  it('falls back to cwd when transcript_path is missing', () => {
    const input = makeInput({ cwd: '/home/user/project' });
    expect(resolveProjectDir(input)).toBe('/home/user/project');
  });

  it('falls back to cwd when transcript_path decoding fails', () => {
    // No directories exist on the mocked filesystem
    mockStatSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const input = makeInput({
      cwd: '/fallback/path',
      transcript_path: '/Users/testuser/.claude/projects/-nonexistent-path/session.jsonl',
    });

    expect(resolveProjectDir(input)).toBe('/fallback/path');
  });

  it('uses transcript_path even when cwd looks valid', () => {
    setDirectories([
      '/Users',
      '/Users/ahmed',
      '/Users/ahmed/real-project',
    ]);

    const input = makeInput({
      cwd: '/some/other/dir',
      transcript_path: '/Users/testuser/.claude/projects/-Users-ahmed-real-project/session.jsonl',
    });

    // transcript_path takes priority
    expect(resolveProjectDir(input)).toBe('/Users/ahmed/real-project');
  });
});
