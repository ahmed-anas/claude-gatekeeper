# ntfy.sh Remote Approval — Design Spec

## Overview

Add optional push notification support to Claude Gatekeeper so users can approve/deny escalated permission requests from their phone via ntfy.sh. Only active in allow-or-ask mode. Hands-free mode is unaffected.

## User Experience

### Setup: `claude-gatekeeper notify setup`

Interactive wizard that guides through installation, generates a topic, and verifies end-to-end:

1. Prompt user to install ntfy app (iOS/Android links provided)
2. Generate a cryptographically random topic name via `crypto.randomBytes()`
3. Prompt user to subscribe to the topic in the ntfy app
4. Send a test notification — user confirms they received it
5. Send a test approval request with action buttons — user taps Approve
6. Wait for response via SSE — confirm bidirectional communication works
7. Save `notify` config to `~/.claude/claude-gatekeeper/config.json`

### Runtime: Escalation with notification

When gatekeeper decides to escalate (allow-or-ask mode only):

1. If `notify.topic` is not configured → `process.exit(0)` as before (no change)
2. If `notify.topic` is configured:
   - POST notification to `{server}/{topic}` with tool details and Approve/Deny action buttons
   - Listen on `{server}/{topic}-response/sse` for user's response
   - Wait up to `notify.timeoutMs` (default 60s)
   - If "approve" received → `writeApproval(hookType)` — command runs
   - If "deny" received or timeout → `process.exit(0)` — prompt stays on terminal

The terminal permission prompt is shown simultaneously. First response (phone or terminal) wins.

### Other commands

- `claude-gatekeeper notify test` — send a test notification to verify setup
- `claude-gatekeeper notify disable` — remove notify config from config.json

## Notification Content

```
Claude Gatekeeper — Approval Needed

Tool: Bash
Command: npm publish --access public
Directory: /Users/ahmed/projects/myapp
Session: 8ed8ad01
Reason: AI confidence below threshold

[Approve]  [Deny]
```

Fields:
- **Tool**: tool_name from hook input
- **Command/File/URL**: summarized tool_input (reuse logger's `summarizeInput`, truncated to 200 chars)
- **Directory**: input.cwd
- **Session**: `session_name` if present, otherwise first 8 chars of session_id. The `session_name` field will be added as optional to `HookInput` so it works automatically once Anthropic ships [#17188](https://github.com/anthropics/claude-code/issues/17188)
- **Reason**: why the gatekeeper escalated (AI reasoning, static rule match, etc.)

Action buttons use ntfy's `http` action type to POST to `{server}/{topic}-response` with `action=approve` or `action=deny` in the body.

## Config

### TypeScript interface

```typescript
interface NotifyConfig {
  topic: string;        // ntfy topic name (required to enable)
  server?: string;      // default: "https://ntfy.sh"
  timeoutMs?: number;   // default: 60000, clamped to [5000, 120000]
}
```

Added to `ApproverConfig`:

```typescript
interface ApproverConfig {
  // ... existing fields ...
  notify?: NotifyConfig;
}
```

### config.json example

```json
{
  "notify": {
    "topic": "gk-a7f3x9b2k4m1",
    "server": "https://ntfy.sh",
    "timeoutMs": 60000
  }
}
```

No `enabled` flag — presence of `topic` activates notifications. Remove the `notify` key or the `topic` to disable.

## Architecture

### New files

| File | Purpose |
|---|---|
| `src/notify.ts` | Core ntfy integration: send notification, listen for response via SSE, format message content |
| `src/notify-setup.ts` | Interactive setup wizard for notifications |
| `tests/unit/notify.test.ts` | Unit tests for notification formatting, sending, SSE parsing |

### Modified files

| File | Change |
|---|---|
| `src/types.ts` | Add `NotifyConfig` interface, add `notify?: NotifyConfig` to `ApproverConfig` |
| `src/config.ts` | Parse and validate `notify` config (default server, clamp timeout) |
| `src/index.ts` | Refactor escalation path: rename `writeDenyOrEscalate` to `handleEscalation`, make async, call notify when topic configured |
| `src/cli.ts` | Add `notify` command group with `setup`, `test`, `disable` subcommands |
| `src/status.ts` | Show notify status line (topic configured / not configured) |
| `README.md` | Document the notification feature |
| `CLAUDE.md` | Add `src/notify.ts` and `src/notify-setup.ts` to architecture list |

### No new npm dependencies

- HTTP requests: Node's built-in `https`/`http` modules
- SSE listening: Parse chunked HTTP response manually (ntfy's SSE is simple line-delimited JSON)
- Topic generation: `crypto.randomBytes()`
- Interactive prompts: Existing `src/cli-prompt.ts`
- Spinner for "waiting": Simple console output with `\r` overwrites (no `ora` needed — keeps deps minimal)

## ntfy.sh Protocol

### Sending a notification

```
POST https://ntfy.sh/{topic}
Content-Type: application/json

{
  "topic": "{topic}",
  "title": "Claude Gatekeeper — Approval Needed",
  "message": "Tool: Bash\nCommand: npm publish\nDirectory: /Users/ahmed/myapp\nSession: 8ed8ad01\nReason: AI confidence below threshold",
  "tags": ["lock"],
  "actions": [
    {
      "action": "http",
      "label": "Approve",
      "url": "https://ntfy.sh/{topic}-response",
      "method": "POST",
      "headers": { "X-Title": "approved" },
      "body": "approve",
      "clear": true
    },
    {
      "action": "http",
      "label": "Deny",
      "url": "https://ntfy.sh/{topic}-response",
      "method": "POST",
      "headers": { "X-Title": "denied" },
      "body": "deny",
      "clear": true
    }
  ]
}
```

### Listening for response

```
GET https://ntfy.sh/{topic}-response/sse
```

Returns server-sent events. Parse each `data:` line as JSON, check the `message` field for "approve" or "deny".

## Refactoring Details

### `writeDenyOrEscalate` → `handleEscalation`

Current (synchronous):
```typescript
function writeDenyOrEscalate(reason: string, mode: GatekeeperMode): void {
  if (mode === 'hands-free') {
    writePreToolUseDeny(reason);
  } else {
    process.exit(0);
  }
}
```

New (async, with notification support):
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

### `src/notify.ts` — Core module

```typescript
// Format the notification message from hook input
export function formatNotification(input: HookInput, reason: string): { title: string; message: string }

// Send notification and wait for response
// Returns 'approve' | 'deny' | 'timeout'
export async function notifyAndWait(
  input: HookInput,
  reason: string,
  config: ApproverConfig
): Promise<'approve' | 'deny' | 'timeout'>

// Send a test notification (for `notify test` command)
export async function sendTestNotification(config: ApproverConfig): Promise<boolean>
```

## Security

- Topic name is the sole authentication — generated with `crypto.randomBytes(8).toString('hex')` (16 hex chars, 64 bits of entropy)
- Response topic is `{topic}-response` — predictable given the main topic, but obscure if topic is random
- No sensitive data beyond command summaries (same info shown in terminal prompt)
- Self-hosted ntfy server eliminates public topic concerns — configurable via `notify.server`
- Notification `clear: true` flag auto-dismisses the notification after an action button is tapped

## Testing

### Unit tests (`tests/unit/notify.test.ts`)

- `formatNotification` produces correct title/message for Bash/Write/WebFetch tools
- `formatNotification` truncates long commands
- `formatNotification` includes session ID, cwd, reason
- SSE response parsing handles "approve", "deny", garbage, and empty responses
- Timeout behavior returns 'timeout' after configured duration
- `notifyAndWait` skips if no topic configured

### Integration tests

- `notify test` command sends notification and prints success
- `notify disable` removes notify config
- `notify setup` (limited — can't test interactive wizard end-to-end in CI)

### Existing tests

- `index.test.ts` — add test that `handleEscalation` calls `notifyAndWait` when topic configured
- `config.test.ts` — add test for `notify` config parsing and validation

## Scope exclusions

- No authentication beyond topic name obscurity
- No encryption of notification content
- No message queuing if phone is offline (ntfy handles this natively)
- No multi-device approval (first response wins)
- Hands-free mode is completely unaffected — no notifications
