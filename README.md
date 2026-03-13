# Claude AI Approver

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
4. **Decision** — if AI is confident the operation is safe (above the confidence threshold), it auto-approves. Otherwise, the normal permission prompt appears

**Key safety guarantee:** The tool **never auto-denies**. It can only approve or pass through to you. Any error (API failure, timeout, parse error) results in the normal prompt appearing.

## Installation

### 1. Build

```bash
cd claude-ai-approver
nvm exec npm install
nvm exec npm run build
```

### 2. Register the hook

Add this to your `~/.claude/settings.json` in the `hooks` section:

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/claude-ai-approver/bin/ai-approver",
            "timeout": 15000
          }
        ]
      }
    ]
  }
}
```

### 3. (Optional) Create a project approval policy

Copy the template to your project:

```bash
cp /path/to/claude-ai-approver/templates/APPROVAL_POLICY.md ./APPROVAL_POLICY.md
```

Edit it to define what should be auto-approved or escalated for your specific project.

## AI Backend

### Default: `claude -p` (zero config)

By default, the hook uses `claude -p --model haiku` to evaluate requests. This piggybacks on your existing Claude Code authentication — **no API key needed**.

### Optional: Direct Anthropic API (faster)

For ~2x faster evaluations, set `ANTHROPIC_API_KEY` in your environment and configure:

```json
// ~/.config/claude-ai-approver/config.json
{
  "backend": "api"
}
```

## Configuration

Create `~/.config/claude-ai-approver/config.json` (all fields optional):

```json
{
  "enabled": true,
  "backend": "cli",
  "model": "haiku",
  "confidenceThreshold": 0.85,
  "timeoutMs": 10000,
  "maxContextLength": 2000,
  "logFile": "~/.config/claude-ai-approver/decisions.log",
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
| `confidenceThreshold` | `0.85` | AI must be this confident to auto-approve (0.0-1.0) |
| `timeoutMs` | `10000` | Max time to wait for AI response |
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
[2026-03-13T18:30:00.000Z] decision=approve confidence=0.95 model=cli:haiku latency=1200ms tool=Bash input="npm run build" reasoning="Standard build command"
[2026-03-13T18:30:05.000Z] decision=escalate confidence=1.00 model=static latency=0ms tool=Bash input="sudo rm -rf /" reasoning="Matched always-escalate pattern"
```

## Project Approval Policy

Create an `APPROVAL_POLICY.md` in your project root (or `.claude/APPROVAL_POLICY.md`) to customize the AI's decisions for your specific project. See `templates/APPROVAL_POLICY.md` for the default template.

## Testing

```bash
nvm exec npm test              # All tests
nvm exec npm run test:e2e      # E2E tests only
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

## How Decisions Are Made

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
            confidence ≥ 0.85   confidence < 0.85
                   │                 │
                   ▼                 ▼
              (JSON stdout)      (exit 0)
              auto-approve       no output
                                 show prompt
```
