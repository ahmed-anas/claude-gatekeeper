import { formatNotification, parseSSEResponse } from '../../src/notify';
import { HookInput } from '../../src/types';

const baseInput: HookInput = {
  session_id: 'abcdef12-3456-7890-abcd-ef1234567890',
  cwd: '/Users/dev/project',
  hook_event_name: 'PermissionRequest',
  tool_name: 'Bash',
  tool_input: { command: 'npm publish --access public' },
};

describe('formatNotification', () => {
  it('formats Bash command notification', () => {
    const { title, message } = formatNotification(baseInput, 'AI confidence below threshold');
    expect(title).toBe('Claude Gatekeeper — Approval Needed');
    expect(message).toContain('Tool: Bash');
    expect(message).toContain('npm publish --access public');
    expect(message).toContain('/Users/dev/project');
    expect(message).toContain('abcdef12');
    expect(message).toContain('AI confidence below threshold');
  });

  it('formats Write tool notification', () => {
    const input = { ...baseInput, tool_name: 'Write', tool_input: { file_path: '/etc/passwd' } };
    const { message } = formatNotification(input, 'Outside project directory');
    expect(message).toContain('Tool: Write');
    expect(message).toContain('/etc/passwd');
  });

  it('formats WebFetch notification', () => {
    const input = { ...baseInput, tool_name: 'WebFetch', tool_input: { url: 'https://example.com/api' } };
    const { message } = formatNotification(input, 'Unknown endpoint');
    expect(message).toContain('Tool: WebFetch');
    expect(message).toContain('https://example.com/api');
  });

  it('truncates long commands', () => {
    const input = { ...baseInput, tool_input: { command: 'x'.repeat(300) } };
    const { message } = formatNotification(input, 'test');
    expect(message.length).toBeLessThan(500);
  });

  it('uses session_name when available', () => {
    const input = { ...baseInput, session_name: 'my-feature-branch' };
    const { message } = formatNotification(input, 'test');
    expect(message).toContain('my-feature-branch');
    expect(message).not.toContain('abcdef12');
  });

  it('falls back to session_id prefix when no session_name', () => {
    const { message } = formatNotification(baseInput, 'test');
    expect(message).toContain('abcdef12');
  });
});

describe('notifyAndWait', () => {
  it('returns timeout immediately when topic is empty', async () => {
    const { notifyAndWait } = await import('../../src/notify');
    const config = {
      enabled: true, mode: 'allow-or-ask' as const, backend: 'cli' as const,
      model: 'haiku', confidenceThreshold: 'high' as const, timeoutMs: 10000,
      maxContextLength: 2000, logFile: '/tmp/test.log', logLevel: 'info' as const,
      alwaysEscalatePatterns: [], alwaysApprovePatterns: [],
      notify: { topic: '', server: 'https://ntfy.sh', timeoutMs: 5000 },
    };
    const input = {
      session_id: 'test', cwd: '/project',
      hook_event_name: 'PermissionRequest' as const,
      tool_name: 'Bash', tool_input: { command: 'npm test' },
    };

    const result = await notifyAndWait(input, 'test reason', config);
    expect(result).toBe('timeout');
  });

  it('returns timeout when notify config is undefined', async () => {
    const { notifyAndWait } = await import('../../src/notify');
    const config = {
      enabled: true, mode: 'allow-or-ask' as const, backend: 'cli' as const,
      model: 'haiku', confidenceThreshold: 'high' as const, timeoutMs: 10000,
      maxContextLength: 2000, logFile: '/tmp/test.log', logLevel: 'info' as const,
      alwaysEscalatePatterns: [], alwaysApprovePatterns: [],
    };
    const input = {
      session_id: 'test', cwd: '/project',
      hook_event_name: 'PermissionRequest' as const,
      tool_name: 'Bash', tool_input: { command: 'npm test' },
    };

    const result = await notifyAndWait(input, 'test reason', config);
    expect(result).toBe('timeout');
  });
});

describe('formatNotification edge cases', () => {
  it('uses "File" label for Edit tool', () => {
    const input = {
      session_id: 'abc12345', cwd: '/project',
      hook_event_name: 'PermissionRequest' as const,
      tool_name: 'Edit', tool_input: { file_path: '/project/src/app.ts' },
    };
    const { message } = formatNotification(input, 'test');
    expect(message).toContain('Tool: Edit');
    expect(message).toContain('File:');
  });

  it('uses "File" label for unknown tools', () => {
    const input = {
      session_id: 'abc12345', cwd: '/project',
      hook_event_name: 'PermissionRequest' as const,
      tool_name: 'Glob', tool_input: { pattern: '**/*.ts' },
    };
    const { message } = formatNotification(input, 'test');
    expect(message).toContain('Tool: Glob');
    expect(message).toContain('File:');
  });
});

describe('parseSSEResponse', () => {
  it('parses approve response', () => {
    expect(parseSSEResponse('approve')).toBe('approve');
  });

  it('parses deny response', () => {
    expect(parseSSEResponse('deny')).toBe('deny');
  });

  it('returns null for garbage', () => {
    expect(parseSSEResponse('random text here')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseSSEResponse('')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(parseSSEResponse('APPROVE')).toBe('approve');
    expect(parseSSEResponse('Deny')).toBe('deny');
  });
});
