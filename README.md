# Claude Gatekeeper

A Claude Code hook that uses AI to automatically evaluate permission prompts. Instead of being bombarded with "Do you want to proceed?" dialogs, this tool uses Claude Haiku to intelligently auto-approve safe operations while escalating uncertain or dangerous ones to you.

## How It Works

```
Permission Request → Static Rules → AI Evaluation → Decision
                      (ms fast)      (1-5s)
                         ↓               ↓
                    Escalate/Approve    Approve (high confidence)
                                       Escalate (low confidence or error)
```
> Note: This flow shows **allow-or-ask** mode. In **hands-free** mode, "escalate" becomes "deny with reason" and errors result in denial instead of escalation.

1. **Claude Code triggers a permission prompt** for a tool it wants to use (Bash, Write, Edit, etc.)
2. **Static rules check first** — obviously dangerous commands (rm -rf, sudo, curl|sh) are immediately escalated; known-safe patterns are immediately approved
3. **AI evaluation** — for everything else, Claude Haiku analyzes the request with full context (your settings, CLAUDE.md, project gatekeeper policy)
4. **Decision** — if AI confidence meets or exceeds the threshold (default: `high`), it auto-approves. Otherwise, the normal permission prompt appears

**Key safety guarantee:** In **allow-or-ask** mode, the tool never auto-denies — it can only approve or pass through to you. Any error results in the normal prompt appearing. In **hands-free** mode, uncertain or dangerous commands are denied with a reason (Claude adjusts its approach), and errors result in denial (fail-closed).

## Installation

```bash
# From source (npm package coming soon)
git clone https://github.com/ahmed-anas/claude-gatekeeper.git
cd claude-gatekeeper
nvm exec npm install
nvm exec npm run build
nvm exec npm link
```

Then run the setup wizard:

```bash
claude-gatekeeper setup
```

This will:
1. Register the PermissionRequest hook in `~/.claude/settings.json`
2. Optionally create a config file at `~/.claude/claude-gatekeeper/config.json`
3. Optionally install a global `GATEKEEPER_POLICY.md` template

To check your installation:

```bash
claude-gatekeeper status
```

## Uninstalling

```bash
claude-gatekeeper uninstall
```

This removes the hook from `~/.claude/settings.json` and optionally deletes `~/.claude/claude-gatekeeper/` (config, logs, gatekeeper policy). Per-project `GATEKEEPER_POLICY.md` files are **not** removed — delete those manually if needed.

To also remove the CLI:

```bash
npm uninstall -g claude-gatekeeper
```

## Modes

Claude Gatekeeper supports multiple operating modes. Switch with:

```bash
claude-gatekeeper mode              # show current mode
claude-gatekeeper mode hands-free   # switch to hands-free
claude-gatekeeper mode allow-or-ask # switch to allow-or-ask
```

### How each mode handles commands

| User's permission list | allow-or-ask (default) | hands-free | full (coming soon) |
|------------------------|----------------------|------------|-------------------|
| **allow list** | pass through | pass through | approve |
| **deny list** | ask user | deny with reason | deny |
| **ask list** | ask user | deny with reason | ask user |
| **not in any list** | AI → approve or ask | AI → approve or deny | AI → approve, deny, or ask |
| **error/timeout** | ask user | deny (fail-closed) | ask user |

### allow-or-ask (default)

Safe commands are auto-approved by AI. For uncertain commands, the permission prompt appears to the user while the hook evaluates in the background. If the user acts first (approve/reject), their choice takes effect immediately. If the hook finishes first and approves, the prompt disappears and Claude continues. The hook never denies in this mode — it only approves or lets the prompt stay.

### hands-free

The permission prompt **never appears** — the user is completely away. Safe commands are auto-approved, dangerous or uncertain ones are **denied with a reason** that Claude can read and adjust to. Errors result in denial (fail-closed). Ideal for unattended/automated workflows.

When a command is denied, Claude receives a message like:
> *"This is an automated deny by Claude Gatekeeper. The user is currently away and has delegated the AI gatekeeper to allow/deny commands. Reason: [explanation]. You may attempt alternative commands."*

### full (coming soon)

Full autonomous mode with extended capabilities. Not yet implemented.

## Enable / Disable

Quickly toggle the gatekeeper without uninstalling:

```bash
claude-gatekeeper disable   # pause — hooks escalate all requests to user
claude-gatekeeper enable    # resume AI evaluation
claude-gatekeeper status    # shows current state (active / paused / not installed)
```

When disabled, hooks remain registered but immediately escalate every request to the normal permission prompt. No AI calls are made. Re-enable anytime with `claude-gatekeeper enable`.

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

## AI Backend

### Default: `claude -p` (zero config)

By default, the hook uses `claude -p --model haiku` to evaluate requests. This piggybacks on your existing Claude Code authentication — **no API key needed**.

### Optional: Direct Anthropic API (faster)

For ~2x faster evaluations, set `ANTHROPIC_API_KEY` in your environment and configure:

```json
// ~/.claude/claude-gatekeeper/config.json
{
  "backend": "api"
}
```

## Configuration

Create `~/.claude/claude-gatekeeper/config.json` (all fields optional):

```json
{
  "enabled": true,
  "backend": "cli",
  "model": "haiku",
  "confidenceThreshold": "high",
  "timeoutMs": 30000,
  "maxContextLength": 2000,
  "logFile": "~/.claude/claude-gatekeeper/decisions.log",
  "logLevel": "info",
  "alwaysEscalatePatterns": [],
  "alwaysApprovePatterns": []
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `true` | Master switch — use `claude-gatekeeper enable/disable` to toggle |
| `backend` | `"cli"` | `"cli"` for `claude -p`, `"api"` for direct Anthropic API |
| `model` | `"haiku"` | Model name (used as-is for CLI, mapped for API) |
| `confidenceThreshold` | `"high"` | Minimum confidence to auto-approve: `"none"`, `"low"`, `"medium"`, `"high"`, `"absolute"` |
| `timeoutMs` | `30000` | Max time to wait for AI response |
| `maxContextLength` | `2000` | Max chars of CLAUDE.md to include in prompt |
| `logFile` | `~/.config/.../decisions.log` | Audit log file path |
| `logLevel` | `"info"` | `"debug"`, `"info"`, or `"warn"` |
| `alwaysEscalatePatterns` | (see below) | Wildcard patterns that always escalate |
| `alwaysApprovePatterns` | `[]` | Wildcard patterns that always approve (no AI) |

### Default Always-Escalate Patterns

These dangerous patterns bypass AI and always show the prompt to you:

- `rm -rf /*`, `rm -rf /`, `rm -rf ~`
- `sudo *`, `su *`
- `curl *| *sh`, `wget *| *bash`
- `npm publish*`, `npm unpublish*`
- `terraform apply*`, `terraform destroy*`
- `aws * delete-*`, `aws * terminate-*`
- `docker rm *`, `docker rmi *`, `docker system prune*`
- And more (fork bombs, disk wiping, etc.)

## Audit Log

Every decision is logged to the audit file:

```
[2026-03-13T18:30:00.000Z] decision=approve confidence=high model=cli:haiku latency=1200ms tool=Bash input="npm run build" reasoning="Standard build command"
[2026-03-13T18:30:05.000Z] decision=escalate confidence=absolute model=static latency=0ms tool=Bash input="sudo rm -rf /" reasoning="Matched always-escalate pattern"
```

## Project Gatekeeper Policy

Create a `GATEKEEPER_POLICY.md` in your project root (or `.claude/GATEKEEPER_POLICY.md`) to customize the AI's decisions for your specific project. See `templates/GATEKEEPER_POLICY.md` for the default template.

## Testing

```bash
nvm exec npm test              # Unit + integration tests
nvm exec npm run test:integration  # Integration tests only (fake Claude CLI)
nvm exec npm run test:e2e      # E2E tests with real Claude CLI (costs ~$0.001/test)
nvm exec npm run test:coverage # With coverage report
```

## Architecture

```
src/
├── index.ts      # Entry point: stdin → orchestrate → stdout
├── types.ts      # TypeScript interfaces
├── config.ts     # Configuration loading + defaults
├── context.ts    # Load settings, CLAUDE.md, GATEKEEPER_POLICY.md
├── evaluator.ts  # AI evaluation (dual backend)
├── prompt.ts     # System prompt + user message construction
├── logger.ts     # Audit logging
└── rules.ts      # Static wildcard pattern matching
```

## How AI Evaluation Works

When a request passes static rules without a match, it goes to Claude Haiku for evaluation. The AI receives:

1. **A system prompt** defining its role as a security evaluator, with explicit criteria for when to approve vs escalate
2. **A user message** containing:
   - The tool name and full input (e.g. `Bash` + `{"command": "npm test"}`)
   - The working directory
   - Your existing permission rules (allow/ask/deny lists from Claude settings — gives the AI context about your trust boundaries)
   - Your project's `GATEKEEPER_POLICY.md` (if present)
   - Excerpts from your `CLAUDE.md` files (project context)

The AI responds with a JSON object: `{"decision": "approve"|"escalate", "confidence": "<level>", "reasoning": "..."}`. If confidence meets the configured threshold (default: `high`), the decision is applied. Otherwise it escalates. In hands-free mode, "escalate" is converted to "deny" with the reasoning passed to Claude so it can adjust its approach.

The prompt is deliberately conservative — "when in doubt, ALWAYS escalate" — since a false escalation just means you see a normal prompt, while a false approval could be dangerous.

**Response parsing** is resilient: it extracts JSON from the response, falls back to keyword matching if JSON is malformed, and defaults to escalation if nothing can be parsed.

## Decision Flow

> Note: This diagram shows **allow-or-ask** mode. In **hands-free** mode, "escalate" becomes "deny with reason" and errors result in denial instead of escalation.

```
                    ┌─────────────────┐
                    │  Permission     │
                    │  Request (stdin)│
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Static Rules   │ ◄── alwaysEscalate / alwaysApprove patterns
                    └────────┬────────┘
                             │
                  ┌──────────┼──────────┐
                  │          │          │
              escalate    evaluate    approve
                  │          │          │
                  ▼          ▼          ▼
              (exit 0)   ┌──────┐   (JSON stdout)
              no output  │  AI  │
                         └──┬───┘
                            │
                   ┌────────┼────────┐
                   │                 │
          confidence ≥ threshold  confidence < threshold
                   │                 │
                   ▼                 ▼
              (JSON stdout)      (exit 0)
              auto-approve       no output
                                 show prompt
```
