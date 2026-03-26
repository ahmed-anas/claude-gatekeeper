# Configuration

## Config File Location

```
~/.claude/claude-gatekeeper/config.json
```

The config file is optional. All fields have sensible defaults.

## Full Configuration Reference

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

## Field Reference

### `enabled` (boolean, default: `true`)
Master switch. Set to `false` to disable the hook entirely — all permission requests will pass through to the user as normal.

### `backend` (string, default: `"cli"`)
Which AI backend to use:
- `"cli"` — Uses `claude -p --model haiku` subprocess. Zero config, piggybacks on existing Claude Code auth. No API key needed.
- `"api"` — Uses `@anthropic-ai/sdk` directly. Requires `ANTHROPIC_API_KEY` env var. ~2x faster than CLI.

If `"api"` is set but `ANTHROPIC_API_KEY` is missing, automatically falls back to `"cli"`.

### `model` (string, default: `"haiku"`)
Model to use for evaluation:
- CLI backend: passed as `--model` flag to `claude -p`
- API backend: `"haiku"` maps to `claude-haiku-4-5-20251001`. Any other value is passed directly.

### `confidenceThreshold` (string, default: `"high"`)
Minimum confidence level required from the AI to auto-approve. The AI picks from five ordered levels; only responses at or above the threshold are auto-approved.

| Level | Meaning | Use as threshold |
|-------|---------|-----------------|
| `"none"` | No basis for a judgment | Approve almost everything (not recommended) |
| `"low"` | Slight lean but very uncertain | Very aggressive — most AI responses pass |
| `"medium"` | Somewhat confident, notable uncertainty | Moderate — approve when AI has a reasonable read |
| `"high"` | Confident with minor reservations | **Default** — good balance of safety and convenience |
| `"absolute"` | No reasonable doubt | Very conservative — only approve when AI is certain |

### `timeoutMs` (number, default: `30000`)
Maximum time in milliseconds to wait for AI evaluation. Clamped to [1000, 60000]. If the AI doesn't respond in time, the request is escalated to the user (allow-or-ask) or denied (hands-free).

### `maxContextLength` (number, default: `2000`)
Maximum characters of CLAUDE.md content to include in the AI prompt. Longer values give the AI more context but increase latency and token usage.

### `logFile` (string, default: `~/.claude/claude-gatekeeper/decisions.log`)
Path to the audit log file. Supports `~` for home directory. The directory is created automatically if it doesn't exist.

### `logLevel` (string, default: `"info"`)
- `"debug"` — Log everything including full prompts sent to the AI
- `"info"` — Log decisions with reasoning
- `"warn"` — Only log warnings and errors (minimal logging)

### `alwaysEscalatePatterns` (string[], default: see below)
Wildcard patterns that bypass AI and always escalate to the user (allow-or-ask) or deny with a reason (hands-free). These are checked **before** any AI call, so they're essentially free.

Patterns use `*` as a wildcard that matches any characters (including `/` and spaces). For Bash commands, each segment of compound commands (split on `|`, `&&`, `||`, `;`) is checked individually.

Default patterns:
```
rm -rf /*, rm -rf /, rm -rf ~, rm -rf $HOME
> /dev/sd*, mkfs.*, dd if=*
chmod -R 777 /*, :(){:|:&};:
curl *| *sh, curl *| *bash, wget *| *sh, wget *| *bash
sudo *, su *
npm publish*, npm unpublish*
aws * delete-*, aws * terminate-*, aws * destroy-*
terraform apply*, terraform destroy*
docker rm *, docker rmi *, docker system prune*
```

User-provided patterns are **merged** with (added to) the defaults, not replacing them.

### `alwaysApprovePatterns` (string[], default: `[]`)
Wildcard patterns that bypass AI and always auto-approve. Use carefully — these skip all safety checks.

Example:
```json
{
  "alwaysApprovePatterns": [
    "prettier *",
    "eslint *",
    "tsc --noEmit"
  ]
}
```

## Gatekeeper Policy Files

In addition to the config file, you can create per-project gatekeeper policies:

- `<project>/GATEKEEPER_POLICY.md` — Project-level policy
- `<project>/.claude/GATEKEEPER_POLICY.md` — Alternative location

These are human-readable markdown files that the AI uses as additional context when making decisions. See `templates/GATEKEEPER_POLICY.md` for the default template.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Required for `"api"` backend. Not needed for `"cli"` backend. |

## Example Configurations

### Conservative (fewer auto-approvals)
```json
{
  "confidenceThreshold": "absolute",
  "timeoutMs": 5000
}
```

### Aggressive (more auto-approvals)
```json
{
  "confidenceThreshold": "medium",
  "alwaysApprovePatterns": ["prettier *", "eslint *", "tsc *"]
}
```

### Fast (direct API)
```json
{
  "backend": "api",
  "timeoutMs": 5000
}
```

### Disabled
```json
{
  "enabled": false
}
```
