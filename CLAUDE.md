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
- `src/context.ts` — Loads Claude settings, CLAUDE.md, and APPROVAL_POLICY.md for AI context
- `src/evaluator.ts` — Dual-backend AI evaluation: `claude -p` (default) or direct Anthropic API
- `src/prompt.ts` — Constructs system prompt and user message for AI evaluation
- `src/logger.ts` — File-based decision audit logging
- `src/rules.ts` — Static wildcard pattern matching (always-escalate/approve rules, no AI needed)

## Key Rules
- NEVER auto-deny. Only approve or escalate to user.
- Any error = escalate (fail-safe).
- Use synchronous file I/O for speed (short-lived process).
- Lazy-import `@anthropic-ai/sdk` only when API backend is used.
- Static rules are checked before AI to avoid unnecessary API calls.
