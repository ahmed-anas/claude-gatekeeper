import { readFileSync } from 'fs';

jest.mock('fs');
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/home/testuser'),
}));

const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;

import { checkPermissions } from '../../src/permissions';
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

function setPermissions(perms: { allow?: string[]; deny?: string[]; ask?: string[] }): void {
  mockReadFileSync.mockReturnValue(JSON.stringify({
    permissions: {
      allow: perms.allow ?? [],
      deny: perms.deny ?? [],
      ask: perms.ask ?? [],
    },
  }));
}

beforeEach(() => jest.clearAllMocks());

describe('allow-list matching', () => {
  it('"Bash(echo:*)" matches "echo hello world"', () => {
    setPermissions({ allow: ['Bash(echo:*)'] });
    expect(checkPermissions(makeInput('Bash', { command: 'echo hello world' })).action).toBe('allow');
  });

  it('"Bash(echo:*)" matches "echo" alone', () => {
    setPermissions({ allow: ['Bash(echo:*)'] });
    expect(checkPermissions(makeInput('Bash', { command: 'echo' })).action).toBe('allow');
  });

  it('"Bash(echo:*)" does NOT match "echoing"', () => {
    setPermissions({ allow: ['Bash(echo:*)'] });
    expect(checkPermissions(makeInput('Bash', { command: 'echoing' })).action).toBe('none');
  });

  it('"Bash(npm run:*)" matches "npm run build"', () => {
    setPermissions({ allow: ['Bash(npm run:*)'] });
    expect(checkPermissions(makeInput('Bash', { command: 'npm run build' })).action).toBe('allow');
  });

  it('"Bash(npm run:*)" does NOT match "npm install"', () => {
    setPermissions({ allow: ['Bash(npm run:*)'] });
    expect(checkPermissions(makeInput('Bash', { command: 'npm install' })).action).toBe('none');
  });

  it('"WebSearch" matches any WebSearch use', () => {
    setPermissions({ allow: ['WebSearch'] });
    expect(checkPermissions(makeInput('WebSearch', { query: 'test' })).action).toBe('allow');
  });

  it('"Read(///**)" matches any file path', () => {
    setPermissions({ allow: ['Read(///**)'] });
    expect(checkPermissions(makeInput('Read', { file_path: '/Users/ahmed/file.ts' })).action).toBe('allow');
  });

  it('"WebFetch(domain:github.com)" matches github.com URL', () => {
    setPermissions({ allow: ['WebFetch(domain:github.com)'] });
    expect(checkPermissions(makeInput('WebFetch', { url: 'https://github.com/repo' })).action).toBe('allow');
  });

  it('"WebFetch(domain:github.com)" matches subdomain', () => {
    setPermissions({ allow: ['WebFetch(domain:github.com)'] });
    expect(checkPermissions(makeInput('WebFetch', { url: 'https://api.github.com/repos' })).action).toBe('allow');
  });

  it('"WebFetch(domain:github.com)" does NOT match other domains', () => {
    setPermissions({ allow: ['WebFetch(domain:github.com)'] });
    expect(checkPermissions(makeInput('WebFetch', { url: 'https://evil.com/fake' })).action).toBe('none');
  });
});

describe('deny-list matching', () => {
  it('denies commands in the deny list', () => {
    setPermissions({ deny: ['Bash(rm -rf:*)'] });
    const result = checkPermissions(makeInput('Bash', { command: 'rm -rf /' }));
    expect(result.action).toBe('deny');
    if (result.action === 'deny') {
      expect(result.reason).toContain('deny list');
    }
  });

  it('deny takes priority over allow', () => {
    setPermissions({ allow: ['Bash(rm:*)'], deny: ['Bash(rm:*)'] });
    expect(checkPermissions(makeInput('Bash', { command: 'rm file.txt' })).action).toBe('deny');
  });
});

describe('ask-list matching', () => {
  it('denies commands in the ask list (no user available)', () => {
    setPermissions({ ask: ['Bash(git *push *--force*)'] });
    const result = checkPermissions(makeInput('Bash', { command: 'git push --force origin main' }));
    expect(result.action).toBe('deny');
    if (result.action === 'deny') {
      expect(result.reason).toContain('user review');
      expect(result.reason).toContain('currently away');
    }
  });

  it('ask-list wildcard patterns work', () => {
    setPermissions({ ask: ['Bash(git *reset --hard*)'] });
    const result = checkPermissions(makeInput('Bash', { command: 'git reset --hard HEAD~1' }));
    expect(result.action).toBe('deny');
  });

  it('ask-list does NOT match non-matching commands', () => {
    setPermissions({ ask: ['Bash(git *push *--force*)'] });
    expect(checkPermissions(makeInput('Bash', { command: 'git push origin main' })).action).toBe('none');
  });
});

describe('priority order', () => {
  it('deny > ask > allow', () => {
    setPermissions({
      allow: ['Bash(git:*)'],
      ask: ['Bash(git *push*)'],
      deny: ['Bash(git *push *--force*)'],
    });
    // Force push → deny (deny list)
    expect(checkPermissions(makeInput('Bash', { command: 'git push --force' })).action).toBe('deny');
    // Regular push → deny (ask list, wildcard matches)
    expect(checkPermissions(makeInput('Bash', { command: 'git push origin main' })).action).toBe('deny');
    // Git status → allow (allow list)
    expect(checkPermissions(makeInput('Bash', { command: 'git status' })).action).toBe('allow');
  });
});

describe('edge cases', () => {
  it('returns none when settings.json is missing', () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(checkPermissions(makeInput('Bash', { command: 'echo hi' })).action).toBe('none');
  });

  it('returns none for empty permission lists', () => {
    setPermissions({});
    expect(checkPermissions(makeInput('Bash', { command: 'echo hi' })).action).toBe('none');
  });

  it('skips malformed rules', () => {
    setPermissions({ allow: ['!!!invalid!!!', 'Bash(echo:*)'] });
    expect(checkPermissions(makeInput('Bash', { command: 'echo hi' })).action).toBe('allow');
  });
});
