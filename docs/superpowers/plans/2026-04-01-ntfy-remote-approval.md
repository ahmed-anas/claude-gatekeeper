# ntfy.sh Remote Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional push notifications via ntfy.sh so users can approve/deny escalated permission requests from their phone.

**Architecture:** New `src/notify.ts` module handles HTTP communication with ntfy.sh (send notifications, listen for SSE responses). New `src/notify-setup.ts` provides an interactive wizard. The escalation path in `src/index.ts` is refactored from a synchronous `writeDenyOrEscalate` to an async `handleEscalation` that optionally waits for a remote response before falling through.

**Tech Stack:** Node.js built-in `https`/`http` modules for HTTP, manual SSE parsing for responses, `crypto.randomBytes` for topic generation, existing `cli-prompt.ts` for interactive prompts.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/types.ts` | Modify | Add `NotifyConfig` interface, add `session_name?` to `HookInput`, add `notify?` to `ApproverConfig` |
| `src/config.ts` | Modify | Validate and default `notify` config during merge |
| `src/notify.ts` | Create | Core ntfy integration: format message, send notification, listen for SSE response |
| `src/notify-setup.ts` | Create | Interactive `notify setup` wizard |
| `src/index.ts` | Modify | Refactor `writeDenyOrEscalate` → `handleEscalation` (async, with notify support) |
| `src/cli.ts` | Modify | Add `notify` command group (setup, test, disable) |
| `src/status.ts` | Modify | Add notify status line |
| `src/logger.ts` | Modify | Export `summarizeInput` (currently private, needed by notify.ts) |
| `CLAUDE.md` | Modify | Add `src/notify.ts` and `src/notify-setup.ts` |
| `README.md` | Modify | Document notification feature |
| `tests/unit/notify.test.ts` | Create | Unit tests for notify module |
| `tests/unit/config.test.ts` | Modify | Add tests for notify config validation |
| `tests/unit/index.test.ts` | Modify | Add mock for notify, test handleEscalation with notify |

---

### Task 1: Add types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/types.test.ts — add to existing file
// No new test needed here — types are structural. The compilation check IS the test.
// We verify via build in step 3.
```

- [ ] **Step 2: Add NotifyConfig and update HookInput and ApproverConfig**

In `src/types.ts`, add after the `ApproverConfig` interface (after line 66):

```typescript
/** Configuration for ntfy.sh push notifications (optional). */
export interface NotifyConfig {
  /** ntfy topic name — presence activates notifications. */
  topic: string;
  /** ntfy server URL. Default: "https://ntfy.sh" */
  server?: string;
  /** How long to wait for phone response in ms. Default: 60000 */
  timeoutMs?: number;
}
```

Add `session_name?` to `HookInput` (after `session_id`):

```typescript
  session_name?: string;  // Available once Anthropic ships #17188
```

Add `notify?` to `ApproverConfig` (after `alwaysApprovePatterns`):

```typescript
  notify?: NotifyConfig;
```

- [ ] **Step 3: Verify build**

Run: `nvm exec npm run build`
Expected: Success

- [ ] **Step 4: Run existing tests**

Run: `nvm exec npm test`
Expected: All 225 tests pass (no behavioral changes)

- [ ] **Step 5: Commit**

```bash
git add src/types.ts
git commit -m "feat(notify): add NotifyConfig type and session_name to HookInput"
```

---

### Task 2: Add config validation for notify

**Files:**
- Modify: `src/config.ts`
- Modify: `tests/unit/config.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/config.test.ts`:

```typescript
describe('notify config', () => {
  it('passes through valid notify config', () => {
    const config = mergeConfig({ notify: { topic: 'test-topic' } });
    expect(config.notify).toEqual({ topic: 'test-topic', server: 'https://ntfy.sh', timeoutMs: 60000 });
  });

  it('defaults server and timeoutMs', () => {
    const config = mergeConfig({ notify: { topic: 'abc' } });
    expect(config.notify!.server).toBe('https://ntfy.sh');
    expect(config.notify!.timeoutMs).toBe(60000);
  });

  it('clamps notify timeoutMs to [5000, 120000]', () => {
    expect(mergeConfig({ notify: { topic: 'a', timeoutMs: 1000 } }).notify!.timeoutMs).toBe(5000);
    expect(mergeConfig({ notify: { topic: 'a', timeoutMs: 999999 } }).notify!.timeoutMs).toBe(120000);
  });

  it('strips notify if topic is empty', () => {
    const config = mergeConfig({ notify: { topic: '' } });
    expect(config.notify).toBeUndefined();
  });

  it('leaves notify undefined when not provided', () => {
    const config = mergeConfig({});
    expect(config.notify).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `nvm exec npm test -- tests/unit/config.test.ts`
Expected: 3+ failures (notify config not yet validated)

- [ ] **Step 3: Implement notify config validation**

In `src/config.ts`, add after the `alwaysEscalatePatterns` merge block (after line 103), before `return merged;`:

```typescript
  // Validate and default notify config
  if (merged.notify) {
    if (!merged.notify.topic || typeof merged.notify.topic !== 'string') {
      merged.notify = undefined;
    } else {
      merged.notify = {
        topic: merged.notify.topic,
        server: merged.notify.server || 'https://ntfy.sh',
        timeoutMs: Math.max(5000, Math.min(120000, merged.notify.timeoutMs || 60000)),
      };
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `nvm exec npm test -- tests/unit/config.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/unit/config.test.ts
git commit -m "feat(notify): validate and default notify config"
```

---

### Task 3: Create notify module

**Files:**
- Create: `src/notify.ts`
- Modify: `src/logger.ts` (export `summarizeInput`)
- Create: `tests/unit/notify.test.ts`

- [ ] **Step 1: Export summarizeInput from logger**

In `src/logger.ts`, change `function summarizeInput` (line 24) to:

```typescript
export function summarizeInput(input: HookInput): string {
```

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/notify.test.ts`:

```typescript
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
    // summarizeInput truncates to 120 chars
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `nvm exec npm test -- tests/unit/notify.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 4: Create src/notify.ts**

```typescript
/**
 * ntfy.sh push notification integration.
 *
 * Sends notifications with approve/deny action buttons when the gatekeeper
 * escalates a request in allow-or-ask mode. Listens for the user's response
 * via Server-Sent Events (SSE) on a response topic.
 *
 * Only active when config.notify.topic is set. No-op otherwise.
 */

import * as https from 'https';
import * as http from 'http';
import { ApproverConfig, HookInput } from './types';
import { summarizeInput } from './logger';
import { logDebug } from './logger';

/** Parse an SSE message body for approve/deny. */
export function parseSSEResponse(body: string): 'approve' | 'deny' | null {
  const lower = body.trim().toLowerCase();
  if (lower === 'approve') return 'approve';
  if (lower === 'deny') return 'deny';
  return null;
}

/** Format notification title and message from hook input. */
export function formatNotification(
  input: HookInput,
  reason: string
): { title: string; message: string } {
  const session = input.session_name ?? input.session_id.slice(0, 8);
  const summary = summarizeInput(input);
  const lines = [
    `Tool: ${input.tool_name}`,
    `${input.tool_name === 'Bash' ? 'Command' : input.tool_name === 'WebFetch' ? 'URL' : 'File'}: ${summary}`,
    `Directory: ${input.cwd}`,
    `Session: ${session}`,
    `Reason: ${reason}`,
  ];
  return {
    title: 'Claude Gatekeeper — Approval Needed',
    message: lines.join('\n'),
  };
}

/** Build the ntfy.sh JSON payload with action buttons. */
function buildPayload(
  topic: string,
  server: string,
  title: string,
  message: string
): string {
  return JSON.stringify({
    topic,
    title,
    message,
    tags: ['lock'],
    actions: [
      {
        action: 'http',
        label: 'Approve',
        url: `${server}/${topic}-response`,
        method: 'POST',
        headers: { 'X-Title': 'approved' },
        body: 'approve',
        clear: true,
      },
      {
        action: 'http',
        label: 'Deny',
        url: `${server}/${topic}-response`,
        method: 'POST',
        headers: { 'X-Title': 'denied' },
        body: 'deny',
        clear: true,
      },
    ],
  });
}

/** POST a JSON payload to a URL. Returns true on 2xx. */
function postJson(url: string, body: string): Promise<boolean> {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(
      parsed,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300)
    );
    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
}

/** Listen on the SSE response topic for approve/deny. Returns on first valid response or timeout. */
function listenForResponse(
  server: string,
  topic: string,
  timeoutMs: number
): Promise<'approve' | 'deny' | 'timeout'> {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (result: 'approve' | 'deny' | 'timeout') => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { req.destroy(); } catch { /* ignore */ }
      resolve(result);
    };

    const timer = setTimeout(() => finish('timeout'), timeoutMs);

    const sseUrl = `${server}/${topic}-response/sse`;
    const parsed = new URL(sseUrl);
    const mod = parsed.protocol === 'https:' ? https : http;

    const req = mod.get(parsed, (res) => {
      let buffer = '';
      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        // SSE format: lines starting with "data: " contain JSON
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // keep incomplete line in buffer
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const json = JSON.parse(line.slice(6));
            const msg = String(json.message || '');
            const decision = parseSSEResponse(msg);
            if (decision) {
              finish(decision);
              return;
            }
          } catch { /* not valid JSON, skip */ }
        }
      });
      res.on('end', () => finish('timeout'));
      res.on('error', () => finish('timeout'));
    });

    req.on('error', () => finish('timeout'));
  });
}

/**
 * Send a notification and wait for the user's response.
 * Returns 'approve', 'deny', or 'timeout'.
 */
export async function notifyAndWait(
  input: HookInput,
  reason: string,
  config: ApproverConfig
): Promise<'approve' | 'deny' | 'timeout'> {
  const notify = config.notify;
  if (!notify?.topic) return 'timeout';

  const server = notify.server || 'https://ntfy.sh';
  const timeoutMs = notify.timeoutMs || 60000;

  const { title, message } = formatNotification(input, reason);
  const payload = buildPayload(notify.topic, server, title, message);

  logDebug(`notify: sending to ${server}/${notify.topic}`, config);

  // Start listening BEFORE sending so we don't miss a fast response
  const responsePromise = listenForResponse(server, notify.topic, timeoutMs);

  const sent = await postJson(`${server}/${notify.topic}`, payload);
  if (!sent) {
    logDebug('notify: failed to send notification', config);
    return 'timeout';
  }

  logDebug('notify: notification sent, waiting for response...', config);
  const result = await responsePromise;
  logDebug(`notify: response=${result}`, config);
  return result;
}

/**
 * Send a test notification to verify setup.
 * Returns true if the notification was sent successfully.
 */
export async function sendTestNotification(topic: string, server: string): Promise<boolean> {
  const payload = JSON.stringify({
    topic,
    title: 'Claude Gatekeeper — Test Notification',
    message: 'This is a test from claude-gatekeeper.\nIf you see this, notifications are working!',
    tags: ['white_check_mark'],
  });
  return postJson(`${server}/${topic}`, payload);
}

/**
 * Send a test approval request and wait for user to tap Approve.
 * Returns the response ('approve', 'deny', or 'timeout').
 */
export async function sendTestApproval(
  topic: string,
  server: string,
  timeoutMs: number
): Promise<'approve' | 'deny' | 'timeout'> {
  const payload = buildPayload(
    topic,
    server,
    'Claude Gatekeeper — Setup Test',
    'Please tap "Approve" to confirm your setup is working.'
  );

  const responsePromise = listenForResponse(server, topic, timeoutMs);
  const sent = await postJson(`${server}/${topic}`, payload);
  if (!sent) return 'timeout';
  return responsePromise;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `nvm exec npm test -- tests/unit/notify.test.ts`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/notify.ts src/logger.ts tests/unit/notify.test.ts
git commit -m "feat(notify): core ntfy.sh integration module"
```

---

### Task 4: Create notify setup wizard

**Files:**
- Create: `src/notify-setup.ts`

- [ ] **Step 1: Create src/notify-setup.ts**

```typescript
/**
 * Interactive notification setup wizard.
 *
 * Guides the user through:
 * 1. Installing the ntfy app
 * 2. Subscribing to a generated topic
 * 3. Verifying one-way notification
 * 4. Verifying bidirectional approval
 * 5. Saving config
 */

import { randomBytes } from 'crypto';
import { existsSync } from 'fs';
import { ask, closePrompt } from './cli-prompt';
import { getConfigPath } from './config';
import { readJson, writeJson } from './fs-utils';
import { sendTestNotification, sendTestApproval } from './notify';

function generateTopic(): string {
  return 'gk-' + randomBytes(8).toString('hex');
}

export async function notifySetup(): Promise<void> {
  console.log('\nNotification Setup');
  console.log('==================\n');

  // Step 1: App installation
  console.log('Step 1: Install the ntfy app on your phone');
  console.log('  iOS:     https://apps.apple.com/us/app/ntfy/id1625396347');
  console.log('  Android: https://play.google.com/store/apps/details?id=io.heckel.ntfy');
  console.log('  Web:     https://ntfy.sh (use browser notifications)\n');

  const hasApp = await ask('Have you installed the app?');
  if (!hasApp) {
    console.log('\n  Install the app and re-run `claude-gatekeeper notify setup`.\n');
    closePrompt();
    return;
  }

  // Step 2: Topic generation
  const topic = generateTopic();
  console.log(`\nStep 2: Subscribe to this topic in the ntfy app`);
  console.log(`  Topic: ${topic}`);
  console.log(`\n  Open the ntfy app → tap "+" → enter the topic name exactly as shown above.\n`);

  const subscribed = await ask('Have you subscribed to the topic?');
  if (!subscribed) {
    console.log('\n  Subscribe to the topic and re-run `claude-gatekeeper notify setup`.\n');
    closePrompt();
    return;
  }

  // Step 3: Test one-way notification
  console.log('\nStep 3: Sending test notification...');
  const sent = await sendTestNotification(topic, 'https://ntfy.sh');
  if (!sent) {
    console.error('  [error] Failed to send notification. Check your internet connection.\n');
    closePrompt();
    return;
  }
  console.log('  [ok] Notification sent! Check your phone.\n');

  const received = await ask('Did you receive the notification?');
  if (!received) {
    console.log('\n  Troubleshooting:');
    console.log('  - Make sure you subscribed to the exact topic: ' + topic);
    console.log('  - Check that notifications are enabled for the ntfy app');
    console.log('  - Try again with `claude-gatekeeper notify setup`\n');
    closePrompt();
    return;
  }

  // Step 4: Test bidirectional approval
  console.log('\nStep 4: Testing approve/deny buttons...');
  console.log('  A test approval request was sent to your phone.');
  console.log('  Please tap "Approve" on the notification.\n');

  process.stdout.write('  Waiting for response...');
  const response = await sendTestApproval(topic, 'https://ntfy.sh', 60000);

  if (response === 'approve') {
    console.log(' [ok] Received: approve\n');
  } else if (response === 'deny') {
    console.log(' [ok] Received: deny (buttons work!)\n');
  } else {
    console.log(' [timeout]\n');
    console.log('  Could not receive a response. Possible causes:');
    console.log('  - The ntfy app may not support action buttons on your device');
    console.log('  - Try tapping the button again');
    console.log('  - Notifications will still work (one-way), but remote approval won\'t.\n');
    const continueAnyway = await ask('Save the config anyway?');
    if (!continueAnyway) {
      closePrompt();
      return;
    }
  }

  // Step 5: Save config
  const configPath = getConfigPath();
  const existing = existsSync(configPath) ? readJson(configPath) ?? {} : {};
  (existing as Record<string, unknown>).notify = {
    topic,
    server: 'https://ntfy.sh',
    timeoutMs: 60000,
  };
  writeJson(configPath, existing);

  console.log('  [ok] Config saved to ' + configPath);
  closePrompt();
  console.log('\n---');
  console.log('Setup complete! Notifications are configured.');
  console.log('Test anytime with: claude-gatekeeper notify test');
  console.log('Disable with: claude-gatekeeper notify disable\n');
}
```

- [ ] **Step 2: Verify build**

Run: `nvm exec npm run build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add src/notify-setup.ts
git commit -m "feat(notify): interactive setup wizard"
```

---

### Task 5: Wire up CLI commands

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add notify command group to cli.ts**

Replace the section after the `disable` command (before the `hook` command) in `src/cli.ts`:

```typescript
import { notifySetup } from './notify-setup';
import { sendTestNotification } from './notify';
import { loadConfig, getConfigPath } from './config';
import { readJson, writeJson } from './fs-utils';
import { existsSync } from 'fs';
```

Add the imports at the top (merge with existing imports). Then add after the `disable` command block:

```typescript
const notify = program
  .command('notify')
  .description('Manage push notifications for remote approval');

notify
  .command('setup')
  .description('Interactive setup wizard for push notifications')
  .action(async () => {
    try {
      await notifySetup();
    } catch (err) {
      console.error(`Notify setup failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

notify
  .command('test')
  .description('Send a test notification to verify your setup')
  .action(async () => {
    try {
      const config = loadConfig();
      if (!config.notify?.topic) {
        console.error('\nNotifications are not configured. Run `claude-gatekeeper notify setup` first.\n');
        process.exit(1);
      }
      const server = config.notify.server || 'https://ntfy.sh';
      console.log(`\nSending test notification to ${server}/${config.notify.topic}...`);
      const sent = await sendTestNotification(config.notify.topic, server);
      if (sent) {
        console.log('  [ok] Notification sent! Check your phone.\n');
      } else {
        console.error('  [error] Failed to send notification.\n');
        process.exit(1);
      }
    } catch (err) {
      console.error(`Notify test failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

notify
  .command('disable')
  .description('Remove notification configuration')
  .action(() => {
    try {
      const configPath = getConfigPath();
      if (!existsSync(configPath)) {
        console.log('\nNotifications are not configured.\n');
        return;
      }
      const existing = readJson(configPath) ?? {};
      delete (existing as Record<string, unknown>).notify;
      writeJson(configPath, existing);
      console.log('\nNotifications disabled. Config updated.\n');
    } catch (err) {
      console.error(`Notify disable failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });
```

Note: The existing `import { loadConfig, getConfigPath } from './config'` is only in some commands — add the missing imports at the top. Also add `import { existsSync } from 'fs'` and `import { readJson, writeJson } from './fs-utils'`.

- [ ] **Step 2: Verify build**

Run: `nvm exec npm run build`
Expected: Success

- [ ] **Step 3: Run existing tests**

Run: `nvm exec npm test`
Expected: All pass (CLI changes don't affect existing tests)

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat(notify): add notify setup/test/disable CLI commands"
```

---

### Task 6: Refactor index.ts escalation path

**Files:**
- Modify: `src/index.ts`
- Modify: `tests/unit/index.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/index.test.ts`:

In the mock setup at the top, add:
```typescript
jest.mock('../../src/notify', () => ({
  notifyAndWait: jest.fn(),
}));
```

And import:
```typescript
import { notifyAndWait } from '../../src/notify';
const mockNotifyAndWait = notifyAndWait as jest.MockedFunction<typeof notifyAndWait>;
```

Add test cases:

```typescript
  it('calls notifyAndWait when notify topic is configured and AI escalates', async () => {
    mockNotifyAndWait.mockResolvedValue('timeout');
    const configWithNotify = { ...defaultConfig, notify: { topic: 'test-topic', server: 'https://ntfy.sh', timeoutMs: 5000 } };
    mockLoadConfig.mockReturnValue(configWithNotify);
    mockCheckRules.mockReturnValue('evaluate');
    mockEvaluate.mockResolvedValue({
      decision: 'escalate',
      confidence: 'high',
      reasoning: 'Uncertain',
      model: 'cli:haiku',
      latencyMs: 500,
    });

    await main();

    expect(mockNotifyAndWait).toHaveBeenCalledWith(
      expect.objectContaining({ tool_name: 'Bash' }),
      'Uncertain',
      configWithNotify
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('approves when notifyAndWait returns approve', async () => {
    mockNotifyAndWait.mockResolvedValue('approve');
    const configWithNotify = { ...defaultConfig, notify: { topic: 'test-topic', server: 'https://ntfy.sh', timeoutMs: 5000 } };
    mockLoadConfig.mockReturnValue(configWithNotify);
    mockCheckRules.mockReturnValue('evaluate');
    mockEvaluate.mockResolvedValue({
      decision: 'escalate',
      confidence: 'high',
      reasoning: 'Uncertain',
      model: 'cli:haiku',
      latencyMs: 500,
    });

    await main();

    expect(stdoutSpy).toHaveBeenCalled();
    const output = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(output.hookSpecificOutput.decision.behavior).toBe('allow');
  });

  it('does not call notifyAndWait when no topic configured', async () => {
    mockCheckRules.mockReturnValue('evaluate');
    mockEvaluate.mockResolvedValue({
      decision: 'escalate',
      confidence: 'high',
      reasoning: 'Uncertain',
      model: 'cli:haiku',
      latencyMs: 500,
    });

    await main();

    expect(mockNotifyAndWait).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `nvm exec npm test -- tests/unit/index.test.ts`
Expected: FAIL — notifyAndWait not called (old code uses `writeDenyOrEscalate`)

- [ ] **Step 3: Refactor index.ts**

Replace `writeDenyOrEscalate` (lines 72-79) with:

```typescript
async function handleEscalation(
  input: HookInput,
  hookType: 'PermissionRequest' | 'PreToolUse',
  reason: string,
  mode: GatekeeperMode,
  config: ApproverConfig
): Promise<void> {
  if (mode === 'hands-free') {
    writePreToolUseDeny(reason);
    return;
  }

  // allow-or-ask: try remote approval if notifications configured
  if (config.notify?.topic) {
    const { notifyAndWait } = await import('./notify');
    const response = await notifyAndWait(input, reason, config);
    if (response === 'approve') {
      writeApproval(hookType);
      return;
    }
  }

  // No notification, denied, or timeout → escalate normally
  process.exit(0);
}
```

Note: Using dynamic `import()` to lazy-load notify module (same pattern as the API SDK lazy import).

Then update all call sites that previously called `writeDenyOrEscalate(reasoning, mode)` to call `await handleEscalation(input, hookType, reasoning, mode, config)`:

- Line 131: `await handleEscalation(input, hookType, permCheck.reason, mode, config);`
- Line 166: `await handleEscalation(input, hookType, reasoning, mode, config);`
- Line 182: `await handleEscalation(input, hookType, result.reasoning, mode, config);`

- [ ] **Step 4: Run tests to verify they pass**

Run: `nvm exec npm test`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/unit/index.test.ts
git commit -m "feat(notify): refactor escalation path to support remote approval"
```

---

### Task 7: Update status command

**Files:**
- Modify: `src/status.ts`

- [ ] **Step 1: Add notify status line**

In `src/status.ts`, add after the Policy line (after line 73):

```typescript
  console.log(`  Notify:   ${config.notify?.topic ? `enabled (topic: ${config.notify.topic})` : 'not configured'}`);
```

- [ ] **Step 2: Verify build and tests**

Run: `nvm exec npm run build && nvm exec npm test`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add src/status.ts
git commit -m "feat(notify): show notification status in status command"
```

---

### Task 8: Update documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Update CLAUDE.md**

Add after the `src/enable.ts` line in the Architecture section:

```markdown
- `src/notify.ts` — ntfy.sh push notification integration (send notifications, listen for SSE responses)
- `src/notify-setup.ts` — Interactive notification setup wizard
```

- [ ] **Step 2: Update README.md**

Add a new section after "Enable / Disable" and before "AI Backend":

```markdown
## Push Notifications (Remote Approval)

Approve or deny escalated requests from your phone via [ntfy.sh](https://ntfy.sh) push notifications. Only active in allow-or-ask mode.

### Setup

```bash
claude-gatekeeper notify setup
```

The interactive wizard guides you through:
1. Installing the ntfy app on your phone
2. Subscribing to a secure generated topic
3. Verifying notifications work end-to-end

### How it works

When the gatekeeper escalates a request, your phone receives a push notification with **Approve** and **Deny** buttons. The terminal prompt also appears simultaneously — whichever you respond to first wins.

### Commands

```bash
claude-gatekeeper notify setup    # interactive setup wizard
claude-gatekeeper notify test     # send a test notification
claude-gatekeeper notify disable  # remove notification config
```
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document push notification feature"
```

---

### Task 9: Final build, full test, verify

- [ ] **Step 1: Full build**

Run: `nvm exec npm run build`
Expected: Success, no errors

- [ ] **Step 2: Full test suite**

Run: `nvm exec npm test`
Expected: All tests pass (225 existing + new notify tests)

- [ ] **Step 3: Verify CLI commands work**

Run: `nvm exec npx claude-gatekeeper notify --help`
Expected: Shows setup, test, disable subcommands

Run: `nvm exec npx claude-gatekeeper status`
Expected: Shows `Notify:   not configured` line

- [ ] **Step 4: Final commit (if any unstaged changes)**

```bash
git status
# If anything unstaged, add and commit
```
