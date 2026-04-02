/**
 * Tests for notify.ts against a local mock ntfy server.
 *
 * Exercises the full HTTP paths (POST publish, SSE subscribe, action button
 * callbacks) without mocking the HTTP layer. Excluded from CI.
 *
 * Run: nvm exec npm run test:ntfy
 */

import { MockNtfyServer } from './mock-ntfy-server';
import { notifyAndWait, sendTestNotification, sendTestApproval } from '../../src/notify';
import { ApproverConfig, HookInput } from '../../src/types';

const BASE_INPUT: HookInput = {
  session_id: 'ntfy-test-session',
  cwd: '/Users/dev/project',
  hook_event_name: 'PermissionRequest',
  tool_name: 'Bash',
  tool_input: { command: 'npm publish --access public' },
};

function makeConfig(server: MockNtfyServer, topic: string, timeoutMs = 5000): ApproverConfig {
  return {
    enabled: true,
    mode: 'allow-or-ask',
    backend: 'cli',
    model: 'haiku',
    confidenceThreshold: 'high',
    timeoutMs: 10000,
    maxContextLength: 2000,
    logFile: '/tmp/ntfy-test.log',
    logLevel: 'warn',
    alwaysEscalatePatterns: [],
    alwaysApprovePatterns: [],
    notify: { topic, server: server.baseUrl, timeoutMs },
  };
}

describe('ntfy integration: mock server', () => {
  const server = new MockNtfyServer();

  beforeAll(() => server.start());
  afterAll(() => server.stop());
  beforeEach(() => server.reset());

  // --- Payload verification ---

  it('notifyAndWait: payload reaches server with correct structure', async () => {
    const topic = 'gk-payload-test';
    const config = makeConfig(server, topic, 500);

    await notifyAndWait(BASE_INPUT, 'confidence below threshold', config);

    const msgs = server.getPublished(topic);
    expect(msgs).toHaveLength(1);

    const payload = msgs[0].parsed as Record<string, unknown>;
    expect(payload.topic).toBe(topic);
    expect(typeof payload.title).toBe('string');
    expect(typeof payload.message).toBe('string');
    expect(payload.tags).toEqual(['lock']);
    expect(Array.isArray(payload.actions)).toBe(true);
  });

  it('notifyAndWait: action button URLs point to response topic', async () => {
    const topic = 'gk-url-test';
    const config = makeConfig(server, topic, 500);

    await notifyAndWait(BASE_INPUT, 'test', config);

    const payload = server.getPublished(topic)[0].parsed as Record<string, unknown>;
    const actions = payload.actions as Array<Record<string, unknown>>;
    expect(actions).toHaveLength(2);

    expect(actions[0].label).toBe('Approve');
    expect(actions[0].url).toBe(`${server.baseUrl}/${topic}-response`);
    expect(actions[0].body).toBe('approve');

    expect(actions[1].label).toBe('Deny');
    expect(actions[1].url).toBe(`${server.baseUrl}/${topic}-response`);
    expect(actions[1].body).toBe('deny');
  });

  it('notifyAndWait: payload includes priority 4', async () => {
    const topic = 'gk-priority-test';
    const config = makeConfig(server, topic, 500);

    await notifyAndWait(BASE_INPUT, 'test', config);

    const payload = server.getPublished(topic)[0].parsed as Record<string, unknown>;
    expect(payload.priority).toBe(4);
  });

  // --- Approve flow ---

  it('notifyAndWait: phone approve → returns "approve"', async () => {
    const topic = 'gk-approve-test';
    server.autoRespond({
      listenTopic: topic,
      respondToTopic: `${topic}-response`,
      responseBody: 'approve',
      delayMs: 100,
    });

    const result = await notifyAndWait(BASE_INPUT, 'test', makeConfig(server, topic));
    expect(result).toBe('approve');
  });

  // --- Deny flow ---

  it('notifyAndWait: phone deny → returns "deny"', async () => {
    const topic = 'gk-deny-test';
    server.autoRespond({
      listenTopic: topic,
      respondToTopic: `${topic}-response`,
      responseBody: 'deny',
      delayMs: 100,
    });

    const result = await notifyAndWait(BASE_INPUT, 'test', makeConfig(server, topic));
    expect(result).toBe('deny');
  });

  // --- Timeout flow ---

  it('notifyAndWait: no response → returns "timeout"', async () => {
    const topic = 'gk-timeout-test';
    const result = await notifyAndWait(BASE_INPUT, 'test', makeConfig(server, topic, 300));
    expect(result).toBe('timeout');
  }, 3000);

  // --- Server error ---

  it('notifyAndWait: unreachable server → returns "timeout"', async () => {
    const badConfig: ApproverConfig = {
      ...makeConfig(server, 'irrelevant', 1000),
      notify: { topic: 'gk-fail', server: 'http://127.0.0.1:1', timeoutMs: 1000 },
    };
    const result = await notifyAndWait(BASE_INPUT, 'test', badConfig);
    expect(result).toBe('timeout');
  }, 5000);

  // --- SSE noise ---

  it('SSE: open event ignored, only message events with approve/deny count', async () => {
    const topic = 'gk-sse-noise-test';
    server.autoRespond({
      listenTopic: topic,
      respondToTopic: `${topic}-response`,
      responseBody: 'approve',
      delayMs: 200,
    });

    const result = await notifyAndWait(BASE_INPUT, 'test', makeConfig(server, topic));
    expect(result).toBe('approve');
  });

  // --- sendTestNotification ---

  it('sendTestNotification: reaches server and returns true', async () => {
    const topic = 'gk-test-notif';
    const ok = await sendTestNotification(topic, server.baseUrl);
    expect(ok).toBe(true);

    const msgs = server.getPublished(topic);
    expect(msgs).toHaveLength(1);
    const payload = msgs[0].parsed as Record<string, unknown>;
    expect(payload.title).toContain('Test Notification');
  });

  it('sendTestNotification: returns false on unreachable server', async () => {
    const ok = await sendTestNotification('any', 'http://127.0.0.1:1');
    expect(ok).toBe(false);
  });

  // --- sendTestApproval ---

  it('sendTestApproval: phone approve → returns "approve"', async () => {
    const topic = 'gk-test-approval';
    server.autoRespond({
      listenTopic: topic,
      respondToTopic: `${topic}-response`,
      responseBody: 'approve',
      delayMs: 100,
    });

    const result = await sendTestApproval(topic, server.baseUrl, 5000);
    expect(result).toBe('approve');
  });

  it('sendTestApproval: unreachable server → returns "timeout"', async () => {
    const result = await sendTestApproval('any', 'http://127.0.0.1:1', 1000);
    expect(result).toBe('timeout');
  }, 5000);

  // --- Notification content ---

  it('notification message includes tool name, command, cwd, session, and reason', async () => {
    const topic = 'gk-content-test';
    const config = makeConfig(server, topic, 500);

    await notifyAndWait(BASE_INPUT, 'AI confidence below threshold', config);

    const payload = server.getPublished(topic)[0].parsed as Record<string, unknown>;
    const msg = payload.message as string;
    expect(msg).toContain('Tool: Bash');
    expect(msg).toContain('npm publish');
    expect(msg).toContain('/Users/dev/project');
    expect(msg).toContain('ntfy-tes');
    expect(msg).toContain('AI confidence below threshold');
  });
});
