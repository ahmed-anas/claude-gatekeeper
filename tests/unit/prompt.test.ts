import { buildPrompt, SYSTEM_PROMPT_SUPERVISED, summarizePermissions, buildUserMessage } from '../../src/prompt';
import { HookInput, PromptContext } from '../../src/types';

const baseInput: HookInput = {
  session_id: 'test-session',
  cwd: '/home/user/project',
  hook_event_name: 'PermissionRequest',
  tool_name: 'Bash',
  tool_input: { command: 'npm test' },
};

const emptyContext: PromptContext = {
  userSettings: null,
  projectSettings: null,
  claudeMd: null,
  projectClaudeMd: null,
  globalApprovalPolicy: null,
  projectApprovalPolicy: null,
};

describe('SYSTEM_PROMPT_SUPERVISED', () => {
  it('contains key instructions', () => {
    expect(SYSTEM_PROMPT_SUPERVISED).toContain('security evaluator');
    expect(SYSTEM_PROMPT_SUPERVISED).toContain('APPROVE');
    expect(SYSTEM_PROMPT_SUPERVISED).toContain('ESCALATE');
    expect(SYSTEM_PROMPT_SUPERVISED).toContain('NEVER deny');
    expect(SYSTEM_PROMPT_SUPERVISED).toContain('JSON');
  });

  it('documents all confidence levels in the response format', () => {
    for (const level of ['none', 'low', 'medium', 'high', 'absolute']) {
      expect(SYSTEM_PROMPT_SUPERVISED).toContain(`"${level}"`);
    }
  });
});

describe('summarizePermissions', () => {
  it('summarizes allow rules', () => {
    const result = summarizePermissions({ allow: ['Bash(npm *)', 'Read(*)'] });
    expect(result).toContain('Allow:');
    expect(result).toContain('Bash(npm *)');
  });

  it('summarizes ask rules', () => {
    const result = summarizePermissions({ ask: ['Bash(git push --force*)'] });
    expect(result).toContain('Ask:');
  });

  it('returns empty string for undefined permissions', () => {
    expect(summarizePermissions(undefined)).toBe('');
  });

  it('truncates long allow lists', () => {
    const allow = Array.from({ length: 50 }, (_, i) => `Rule${i}`);
    const result = summarizePermissions({ allow });
    expect(result).toContain('+20 more');
  });
});

describe('buildUserMessage', () => {
  it('includes tool name and input', () => {
    const msg = buildUserMessage(baseInput, emptyContext);
    expect(msg).toContain('Tool: Bash');
    expect(msg).toContain('npm test');
  });

  it('includes working directory', () => {
    const msg = buildUserMessage(baseInput, emptyContext);
    expect(msg).toContain('Working Directory: /home/user/project');
  });

  it('includes permission rules when available', () => {
    const context: PromptContext = {
      ...emptyContext,
      userSettings: { permissions: { allow: ['Bash(npm *)'], ask: ['Bash(git push --force*)'] } },
    };
    const msg = buildUserMessage(baseInput, context);
    expect(msg).toContain('existing permission rules');
    expect(msg).toContain('Bash(npm *)');
  });

  it('includes gatekeeper policy when available', () => {
    const context: PromptContext = {
      ...emptyContext,
      globalApprovalPolicy: '## APPROVE\n- npm commands',
    };
    const msg = buildUserMessage(baseInput, context);
    expect(msg).toContain('Global Gatekeeper Policy');
    expect(msg).toContain('npm commands');
  });

  it('includes CLAUDE.md when available', () => {
    const context: PromptContext = {
      ...emptyContext,
      projectClaudeMd: '# My Project\nBuild with npm run build',
    };
    const msg = buildUserMessage(baseInput, context);
    expect(msg).toContain('Project instructions');
    expect(msg).toContain('My Project');
  });

  it('includes global CLAUDE.md when available', () => {
    const context: PromptContext = {
      ...emptyContext,
      claudeMd: '# Global\nUse nvm',
    };
    const msg = buildUserMessage(baseInput, context);
    expect(msg).toContain('Global instructions');
    expect(msg).toContain('Use nvm');
  });

  it('handles all-null context gracefully', () => {
    const msg = buildUserMessage(baseInput, emptyContext);
    expect(msg).toContain('Tool: Bash');
    expect(msg).not.toContain('permission rules');
    expect(msg).not.toContain('Gatekeeper Policy');
  });

  it('shows single working directory when cwd matches projectDir', () => {
    const msg = buildUserMessage(baseInput, emptyContext, '/home/user/project');
    expect(msg).toContain('Working Directory: /home/user/project');
    expect(msg).not.toContain('Subagent');
  });

  it('shows both directories when subagent cwd differs from projectDir', () => {
    const subagentInput = { ...baseInput, cwd: '/private/tmp/nx-tools-sam' };
    const msg = buildUserMessage(subagentInput, emptyContext, '/Users/dev/project');
    expect(msg).toContain('Project Directory: /Users/dev/project');
    expect(msg).toContain('Subagent Working Directory: /private/tmp/nx-tools-sam');
    expect(msg).toContain('Both the project directory and the subagent working directory are valid');
  });

  it('normalizes /private/tmp to /tmp when comparing directories', () => {
    const subagentInput = { ...baseInput, cwd: '/private/tmp/myproject' };
    const msg = buildUserMessage(subagentInput, emptyContext, '/tmp/myproject');
    expect(msg).toContain('Working Directory: /private/tmp/myproject');
    expect(msg).not.toContain('Subagent');
  });
});

describe('buildPrompt', () => {
  it('returns both system prompt and user message', () => {
    const { systemPrompt, userMessage } = buildPrompt(baseInput, emptyContext);
    expect(systemPrompt).toBe(SYSTEM_PROMPT_SUPERVISED);
    expect(userMessage).toContain('Tool: Bash');
  });

  it('passes projectDir to user message', () => {
    const subagentInput = { ...baseInput, cwd: '/tmp/subagent-dir' };
    const { userMessage } = buildPrompt(subagentInput, emptyContext, 'allow-or-ask', '/Users/dev/project');
    expect(userMessage).toContain('Project Directory: /Users/dev/project');
    expect(userMessage).toContain('Subagent Working Directory: /tmp/subagent-dir');
  });
});
