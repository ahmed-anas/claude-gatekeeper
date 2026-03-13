import { checkRules, extractMatchTarget, splitCompoundCommand, matchesAnyPattern } from '../../src/rules';
import { ApproverConfig, HookInput } from '../../src/types';

const baseConfig: ApproverConfig = {
  enabled: true,
  backend: 'cli',
  model: 'haiku',
  confidenceThreshold: 0.85,
  timeoutMs: 10000,
  maxContextLength: 2000,
  logFile: '/tmp/test.log',
  logLevel: 'info',
  alwaysEscalatePatterns: [
    'rm -rf /*',
    'rm -rf /',
    'sudo *',
    'curl *| *sh',
    'npm publish*',
    'terraform apply*',
  ],
  alwaysApprovePatterns: [
    'echo *',
    'ls *',
  ],
};

function bashInput(command: string): HookInput {
  return {
    session_id: 'test',
    cwd: '/project',
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command },
  };
}

function writeInput(filePath: string): HookInput {
  return {
    session_id: 'test',
    cwd: '/project',
    hook_event_name: 'PermissionRequest',
    tool_name: 'Write',
    tool_input: { file_path: filePath, content: 'hello' },
  };
}

function webFetchInput(url: string): HookInput {
  return {
    session_id: 'test',
    cwd: '/project',
    hook_event_name: 'PermissionRequest',
    tool_name: 'WebFetch',
    tool_input: { url },
  };
}

describe('extractMatchTarget', () => {
  it('extracts command from Bash tool', () => {
    expect(extractMatchTarget(bashInput('npm test'))).toBe('npm test');
  });

  it('extracts file_path from Write tool', () => {
    expect(extractMatchTarget(writeInput('/src/index.ts'))).toBe('/src/index.ts');
  });

  it('extracts url from WebFetch tool', () => {
    expect(extractMatchTarget(webFetchInput('https://example.com'))).toBe('https://example.com');
  });

  it('returns JSON for unknown tools', () => {
    const input: HookInput = {
      session_id: 'test',
      cwd: '/project',
      hook_event_name: 'PermissionRequest',
      tool_name: 'CustomTool',
      tool_input: { foo: 'bar' },
    };
    expect(extractMatchTarget(input)).toBe('{"foo":"bar"}');
  });
});

describe('splitCompoundCommand', () => {
  it('splits pipe commands', () => {
    expect(splitCompoundCommand('cat file | grep foo')).toEqual(['cat file', 'grep foo']);
  });

  it('splits && chains', () => {
    expect(splitCompoundCommand('cd /tmp && rm -rf /')).toEqual(['cd /tmp', 'rm -rf /']);
  });

  it('splits || chains', () => {
    expect(splitCompoundCommand('test -f file || echo missing')).toEqual(['test -f file', 'echo missing']);
  });

  it('splits semicolons', () => {
    expect(splitCompoundCommand('echo a; echo b')).toEqual(['echo a', 'echo b']);
  });

  it('handles single command', () => {
    expect(splitCompoundCommand('npm test')).toEqual(['npm test']);
  });

  it('handles empty segments', () => {
    expect(splitCompoundCommand('echo hello |')).toEqual(['echo hello']);
  });
});

describe('matchesAnyPattern', () => {
  it('matches glob patterns', () => {
    expect(matchesAnyPattern('sudo reboot', ['sudo *'])).toBe(true);
  });

  it('does not match non-matching patterns', () => {
    expect(matchesAnyPattern('npm test', ['sudo *'])).toBe(false);
  });

  it('returns false for empty patterns', () => {
    expect(matchesAnyPattern('anything', [])).toBe(false);
  });
});

describe('checkRules', () => {
  it('escalates dangerous commands', () => {
    expect(checkRules(bashInput('sudo rm -rf /'), baseConfig)).toBe('escalate');
    expect(checkRules(bashInput('rm -rf /'), baseConfig)).toBe('escalate');
    expect(checkRules(bashInput('npm publish'), baseConfig)).toBe('escalate');
    expect(checkRules(bashInput('terraform apply -auto-approve'), baseConfig)).toBe('escalate');
  });

  it('approves always-approve patterns', () => {
    expect(checkRules(bashInput('echo hello world'), baseConfig)).toBe('approve');
    expect(checkRules(bashInput('ls -la'), baseConfig)).toBe('approve');
  });

  it('returns evaluate for unknown commands', () => {
    expect(checkRules(bashInput('npm test'), baseConfig)).toBe('evaluate');
    expect(checkRules(bashInput('python3 script.py'), baseConfig)).toBe('evaluate');
  });

  it('escalates compound commands with dangerous segments', () => {
    expect(checkRules(bashInput('echo hello && sudo reboot'), baseConfig)).toBe('escalate');
    expect(checkRules(bashInput('cat file | sudo tee /etc/passwd'), baseConfig)).toBe('escalate');
  });

  it('approves non-Bash tools matching approve patterns', () => {
    const config = { ...baseConfig, alwaysApprovePatterns: ['/project/src/*'] };
    expect(checkRules(writeInput('/project/src/index.ts'), config)).toBe('approve');
  });

  it('escalates non-Bash tools matching escalate patterns', () => {
    const config = { ...baseConfig, alwaysEscalatePatterns: ['/etc/*'] };
    expect(checkRules(writeInput('/etc/passwd'), config)).toBe('escalate');
  });

  it('returns evaluate for unmatched non-Bash tools', () => {
    expect(checkRules(writeInput('/project/src/index.ts'), baseConfig)).toBe('evaluate');
  });
});
