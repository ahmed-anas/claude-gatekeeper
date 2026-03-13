# Testing

## Running Tests

```bash
# All tests
nvm exec npm test

# With verbose output
nvm exec npm test -- --verbose

# With coverage report
nvm exec npm run test:coverage

# E2E tests only
nvm exec npm run test:e2e

# Watch mode (re-run on changes)
nvm exec npm run test:watch
```

## Test Structure

```
tests/
├── unit/                    # Unit tests (mocked dependencies)
│   ├── config.test.ts       # Config loading, merging, validation
│   ├── context.test.ts      # Context file loading, truncation
│   ├── evaluator.test.ts    # AI response parsing, CLI/API backends
│   ├── index.test.ts        # Main pipeline orchestration
│   ├── logger.test.ts       # Audit logging
│   ├── prompt.test.ts       # Prompt construction
│   └── rules.test.ts        # Static pattern matching
├── e2e/                     # End-to-end tests (real compiled binary)
│   └── hook.test.ts         # Spawns dist/index.js with fixture stdin
└── fixtures/                # Sample permission request payloads
    ├── bash-npm-build.json
    ├── bash-rm-rf.json
    ├── bash-curl-pipe-sh.json
    ├── bash-sudo.json
    ├── write-src-file.json
    ├── write-etc-passwd.json
    └── webfetch-github.json
```

## What Each Test Suite Covers

### `config.test.ts`
- Default config when no file exists
- Merging user config with defaults
- Malformed JSON handling
- Value validation (threshold clamping, enum validation)
- Pattern array merging (user + defaults, no duplicates)
- Path resolution (~/ to home directory)

### `context.test.ts`
- Loading all context files (settings, CLAUDE.md, APPROVAL_POLICY.md)
- Graceful handling of missing files (returns null)
- Content truncation to maxContextLength
- Fallback from `APPROVAL_POLICY.md` to `.claude/APPROVAL_POLICY.md`

### `evaluator.test.ts`
- JSON response parsing (valid, embedded in text, malformed)
- Confidence clamping and defaults
- Keyword fallback matching (approve/escalate)
- CLI backend: success, non-zero exit, spawn error, timeout
- API backend: error handling

### `index.test.ts`
- Full pipeline: approve flow, escalate flow, error flow
- Static rule bypass (approve and escalate)
- Disabled config handling
- Invalid stdin handling
- HookOutput JSON format validation

### `logger.test.ts`
- Log line format and content
- Log level filtering
- Long command truncation
- Tool-specific input summarization
- Silent error swallowing
- Debug vs info vs warn levels

### `prompt.test.ts`
- System prompt content validation
- Permission rule summarization (with truncation for long lists)
- User message construction with all context variants
- Graceful handling of null context

### `rules.test.ts`
- Match target extraction per tool type
- Compound command splitting (pipes, &&, ||, ;)
- Wildcard pattern matching
- Dangerous command escalation
- Always-approve pattern matching
- Per-segment checking for compound commands
- Non-Bash tool matching (Write, WebFetch)

### `hook.test.ts` (E2E)
- Invalid/empty stdin → escalate
- Static rule matches → escalate (rm -rf, sudo, curl|sh)
- Missing API key → escalate
- Never crashes (exit 0 on all code paths)
- Approval JSON format validation

## Test Fixtures

Each fixture is a valid `HookInput` JSON that simulates a real Claude Code permission request:

| Fixture | Tool | Expected |
|---------|------|----------|
| `bash-npm-build.json` | Bash | Evaluate (AI decides) |
| `bash-rm-rf.json` | Bash | Escalate (static rule) |
| `bash-curl-pipe-sh.json` | Bash | Escalate (static rule) |
| `bash-sudo.json` | Bash | Escalate (static rule) |
| `write-src-file.json` | Write | Evaluate (AI decides) |
| `write-etc-passwd.json` | Write | Evaluate (AI decides) |
| `webfetch-github.json` | WebFetch | Evaluate (AI decides) |

## Coverage Thresholds

The project enforces 80% coverage for branches, functions, lines, and statements. Run `npm run test:coverage` to check.
