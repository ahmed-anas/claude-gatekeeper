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

1. **Claude Code triggers a permission prompt** for a tool it wants to use (Bash, Write, Edit, etc.)
2. **Static rules check first** — obviously dangerous commands (rm -rf, sudo, curl|sh) are immediately escalated; known-safe patterns are immediately approved
3. **AI evaluation** — for everything else, Claude Haiku analyzes the request with full context (your settings, CLAUDE.md, project approval policy)
4. **Decision** — if AI confidence meets or exceeds the threshold (default: `high`), it auto-approves. Otherwise, the normal permission prompt appears

**Key safety guarantee:** The tool **never auto-denies**. It can only approve or pass through to you. Any error (API failure, timeout, parse error) results in the normal prompt appearing.

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
3. Optionally install a global `APPROVAL_POLICY.md` template

To check your installation:

```bash
claude-gatekeeper status
```

## Uninstalling

```bash
claude-gatekeeper uninstall
```

This removes the hook from `~/.claude/settings.json` and optionally deletes `~/.claude/claude-gatekeeper/` (config, logs, approval policy). Per-project `APPROVAL_POLICY.md` files are **not** removed — delete those manually if needed.

To also remove the CLI:

```bash
npm uninstall -g claude-gatekeeper
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
| `enabled` | `true` | Master switch — set to `false` to disable |
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

## Project Approval Policy

Create an `APPROVAL_POLICY.md` in your project root (or `.claude/APPROVAL_POLICY.md`) to customize the AI's decisions for your specific project. See `templates/APPROVAL_POLICY.md` for the default template.

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
├── context.ts    # Load settings, CLAUDE.md, APPROVAL_POLICY.md
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
   - Your project's `APPROVAL_POLICY.md` (if present)
   - Excerpts from your `CLAUDE.md` files (project context)

The AI responds with a JSON object: `{"decision": "approve"|"escalate", "confidence": "<level>", "reasoning": "..."}`. If confidence meets the configured threshold (default: `high`), the decision is applied. Otherwise it escalates.

The prompt is deliberately conservative — "when in doubt, ALWAYS escalate" — since a false escalation just means you see a normal prompt, while a false approval could be dangerous.

**Response parsing** is resilient: it extracts JSON from the response, falls back to keyword matching if JSON is malformed, and defaults to escalation if nothing can be parsed.

## Decision Flow

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
