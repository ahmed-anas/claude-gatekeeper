# Claude Gatekeeper

A Claude Code PermissionRequest hook that uses AI to auto-approve safe operations and escalate uncertain ones to the user.

## Build
```
nvm exec npm run build
```

## Test
```
nvm exec npm test
```

## Architecture
- `src/index.ts` — Entry point: reads stdin, orchestrates the pipeline, writes approval JSON or exits silently to escalate
- `src/types.ts` — All TypeScript interfaces
- `src/config.ts` — Loads config from `~/.claude/claude-gatekeeper/config.json`, merges with defaults
- `src/context.ts` — Loads Claude settings, CLAUDE.md, and GATEKEEPER_POLICY.md for AI context
- `src/evaluator.ts` — Dual-backend AI evaluation: `claude -p` (default) or direct Anthropic API
- `src/prompt.ts` — Constructs system prompt and user message for AI evaluation
- `src/logger.ts` — File-based decision audit logging
- `src/rules.ts` — Static wildcard pattern matching (always-escalate/approve rules, no AI needed)
- `src/permissions.ts` — Checks tool uses against user's Claude Code permission lists
- `src/project-dir.ts` — Resolves real project directory from transcript_path
- `src/cli.ts` — Commander.js CLI with subcommands: setup, status, uninstall, mode, enable, disable
- `src/setup.ts` — Interactive setup wizard
- `src/uninstall.ts` — Uninstall command
- `src/status.ts` — Status display command
- `src/mode.ts` — Mode switching (allow-or-ask / hands-free)
- `src/enable.ts` — Enable/disable toggle
- `src/fs-utils.ts` — Shared file I/O utilities
- `src/cli-prompt.ts` — Buffered readline for interactive prompts

## Key Rules
- In allow-or-ask mode: NEVER auto-deny. Only approve or escalate to user. Any error = escalate (fail-safe).
- In hands-free mode: approve safe commands, deny uncertain/dangerous ones. Any error = deny (fail-closed, no human to ask).
- Use synchronous file I/O for speed (short-lived process).
- Lazy-import `@anthropic-ai/sdk` only when API backend is used.
- Static rules are checked before AI to avoid unnecessary API calls.
