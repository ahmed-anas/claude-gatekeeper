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
