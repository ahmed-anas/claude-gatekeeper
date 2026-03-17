import { readFileSync } from 'fs';

jest.mock('fs');
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/home/testuser'),
}));

const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;

import { isInAllowList } from '../../src/allowlist';
import { HookInput } from '../../src/types';

function makeInput(toolName: string, toolInput: Record<string, unknown>): HookInput {
  return {
    session_id: 'test',
    cwd: '/project',
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: toolInput,
  };
}

function setAllowList(rules: string[]): void {
  mockReadFileSync.mockReturnValue(JSON.stringify({
    permissions: { allow: rules },
  }));
}

beforeEach(() => jest.clearAllMocks());

describe('Bash pattern matching', () => {
  it('"Bash(echo:*)" matches "echo hello world"', () => {
    setAllowList(['Bash(echo:*)']);
    expect(isInAllowList(makeInput('Bash', { command: 'echo hello world' }))).toBe(true);
  });

  it('"Bash(echo:*)" matches "echo" alone', () => {
    setAllowList(['Bash(echo:*)']);
    expect(isInAllowList(makeInput('Bash', { command: 'echo' }))).toBe(true);
  });

  it('"Bash(echo:*)" does NOT match "echoing"', () => {
    setAllowList(['Bash(echo:*)']);
    expect(isInAllowList(makeInput('Bash', { command: 'echoing' }))).toBe(false);
  });

  it('"Bash(npm run:*)" matches "npm run build"', () => {
    setAllowList(['Bash(npm run:*)']);
    expect(isInAllowList(makeInput('Bash', { command: 'npm run build' }))).toBe(true);
  });

  it('"Bash(npm run:*)" does NOT match "npm install"', () => {
    setAllowList(['Bash(npm run:*)']);
    expect(isInAllowList(makeInput('Bash', { command: 'npm install' }))).toBe(false);
  });

  it('"Bash(git:*)" matches "git status"', () => {
    setAllowList(['Bash(git:*)']);
    expect(isInAllowList(makeInput('Bash', { command: 'git status' }))).toBe(true);
  });

  it('"Bash(python3:*)" matches "python3 -c \'import json\'"', () => {
    setAllowList(['Bash(python3:*)']);
    expect(isInAllowList(makeInput('Bash', { command: "python3 -c 'import json'" }))).toBe(true);
  });

  it('does NOT match wrong tool name', () => {
    setAllowList(['Bash(echo:*)']);
    expect(isInAllowList(makeInput('Write', { command: 'echo hello' }))).toBe(false);
  });
});

describe('tool-level matching (no pattern)', () => {
  it('"WebSearch" matches any WebSearch use', () => {
    setAllowList(['WebSearch']);
    expect(isInAllowList(makeInput('WebSearch', { query: 'test' }))).toBe(true);
  });

  it('"Read" matches any Read use', () => {
    setAllowList(['Read']);
    expect(isInAllowList(makeInput('Read', { file_path: '/etc/passwd' }))).toBe(true);
  });
});

describe('Read path matching', () => {
  it('"Read(///**)" matches any file path', () => {
    setAllowList(['Read(///**)']);
    expect(isInAllowList(makeInput('Read', { file_path: '/Users/ahmed/file.ts' }))).toBe(true);
  });
});

describe('WebFetch domain matching', () => {
  it('"WebFetch(domain:github.com)" matches github.com URL', () => {
    setAllowList(['WebFetch(domain:github.com)']);
    expect(isInAllowList(makeInput('WebFetch', { url: 'https://github.com/repo' }))).toBe(true);
  });

  it('"WebFetch(domain:github.com)" matches subdomain', () => {
    setAllowList(['WebFetch(domain:github.com)']);
    expect(isInAllowList(makeInput('WebFetch', { url: 'https://api.github.com/repos' }))).toBe(true);
  });

  it('"WebFetch(domain:github.com)" does NOT match other domains', () => {
    setAllowList(['WebFetch(domain:github.com)']);
    expect(isInAllowList(makeInput('WebFetch', { url: 'https://evil.com/fake-github.com' }))).toBe(false);
  });
});

describe('multiple rules', () => {
  it('matches if any rule matches', () => {
    setAllowList(['Bash(echo:*)', 'Bash(git:*)']);
    expect(isInAllowList(makeInput('Bash', { command: 'git log' }))).toBe(true);
  });

  it('returns false if no rule matches', () => {
    setAllowList(['Bash(echo:*)', 'Bash(git:*)']);
    expect(isInAllowList(makeInput('Bash', { command: 'rm -rf /' }))).toBe(false);
  });
});

describe('edge cases', () => {
  it('returns false when settings.json is missing', () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(isInAllowList(makeInput('Bash', { command: 'echo hi' }))).toBe(false);
  });

  it('returns false for empty allow list', () => {
    setAllowList([]);
    expect(isInAllowList(makeInput('Bash', { command: 'echo hi' }))).toBe(false);
  });

  it('skips malformed rules', () => {
    setAllowList(['not a valid rule!!!', 'Bash(echo:*)']);
    expect(isInAllowList(makeInput('Bash', { command: 'echo hi' }))).toBe(true);
  });
});
