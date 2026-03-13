# Architecture

## Overview

Claude AI Approver is a Claude Code **PermissionRequest hook**. When Claude Code is about to show a "Do you want to proceed?" permission prompt, this hook intercepts the request and decides whether to auto-approve it or let the prompt through to the user.

## Design Principles

1. **Never auto-deny** — The hook can only approve or escalate (pass to user). It never blocks operations.
2. **Fail-safe** — Any error at any point in the pipeline results in escalation. The user always has the final say.
3. **Layered evaluation** — Static rules run first (milliseconds), AI runs second (1-5 seconds). This keeps common cases fast.
4. **Context-aware** — The AI receives the user's existing permission rules, CLAUDE.md, and project approval policy to make informed decisions.
5. **Transparent** — Every decision is logged to an audit file with timestamps, reasoning, and confidence scores.

## Data Flow

```
                    ┌─────────────────────────┐
                    │  Claude Code triggers    │
                    │  PermissionRequest hook  │
                    │  (JSON on stdin)         │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │  Parse stdin JSON         │
                    │  (HookInput type)         │
                    │  On failure: escalate     │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │  Load config              │
                    │  (~/.config/claude-ai-    │
                    │   approver/config.json)   │
                    │  On failure: use defaults │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │  Check static rules       │
                    │  (rules.ts)               │
                    │  alwaysEscalate patterns  │
                    │  alwaysApprove patterns   │
                    └─────┬──────┬──────┬──────┘
                          │      │      │
                     escalate evaluate approve
                          │      │      │
                     (exit 0)    │   (JSON stdout)
                     no output   │
                                 │
                    ┌────────────▼─────────────┐
                    │  Load context             │
                    │  (context.ts)             │
                    │  - User settings          │
                    │  - Project settings       │
                    │  - CLAUDE.md files         │
                    │  - APPROVAL_POLICY.md     │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │  Build AI prompt          │
                    │  (prompt.ts)              │
                    │  System prompt + user msg │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │  AI Evaluation            │
                    │  (evaluator.ts)           │
                    │  Backend: CLI or API      │
                    │  Returns: decision,       │
                    │  confidence, reasoning    │
                    └─────┬────────────┬───────┘
                          │            │
                   confidence ≥    confidence <
                   threshold       threshold
                          │            │
                     (JSON stdout)  (exit 0)
                     auto-approve   no output
                                    show prompt
```

## Module Responsibilities

### `index.ts` — Orchestrator
The main entry point. Reads stdin, calls each module in sequence, handles errors, and writes the decision to stdout. The top-level catch-all ensures that any unhandled exception results in escalation (exit 0, no output).

### `types.ts` — Type Definitions
All TypeScript interfaces shared across modules: `HookInput`, `HookOutput`, `EvaluationResult`, `ApproverConfig`, `PromptContext`, `UserSettings`, `RuleDecision`.

### `config.ts` — Configuration
Loads user config from `~/.config/claude-ai-approver/config.json` and merges with defaults. Validates values (clamps thresholds, validates enums). Falls back to defaults on any error.

### `context.ts` — Context Gathering
Reads files that provide context for the AI prompt:
- `~/.claude/settings.json` — user's permission rules
- `<cwd>/.claude/settings.json` — project permission rules
- `~/.claude/CLAUDE.md` — global instructions
- `<cwd>/CLAUDE.md` — project instructions
- `<cwd>/APPROVAL_POLICY.md` or `<cwd>/.claude/APPROVAL_POLICY.md` — project-specific approval rules

All reads are best-effort (missing files return null). CLAUDE.md content is truncated to `maxContextLength`.

### `rules.ts` — Static Pattern Matching
Checks the command/file/URL against `alwaysEscalatePatterns` and `alwaysApprovePatterns` using simple wildcard matching. For Bash commands, it splits compound commands (pipes, &&, ;) and checks each segment individually.

Uses a custom wildcard matcher (not minimatch) because commands contain `/` characters and spaces that minimatch's file-path-oriented `*` doesn't handle correctly.

### `prompt.ts` — AI Prompt Construction
Builds the system prompt (security evaluator instructions) and user message (tool details + context). The system prompt defines APPROVE and ESCALATE criteria. The user message includes the tool name, input, working directory, existing permission rules, approval policy, and CLAUDE.md excerpts.

### `evaluator.ts` — AI Evaluation
Two backends:

1. **CLI backend** (`claude -p --model haiku`): Spawns the Claude CLI as a subprocess. Zero config — piggybacks on existing Claude Code authentication. Default backend.

2. **API backend** (direct Anthropic SDK): Uses `@anthropic-ai/sdk` with `ANTHROPIC_API_KEY`. ~2x faster than CLI (no CLI startup overhead). Lazy-imported to avoid loading the SDK when not needed.

Both backends parse the AI response (JSON with decision/confidence/reasoning), handle timeouts, and fall back to escalation on any error.

### `logger.ts` — Audit Logging
Appends decision records to the log file. Each record includes timestamp, decision, confidence, model, latency, tool name, input summary, and reasoning. Errors in logging are silently swallowed (never break the hook).

## Hook Protocol

The Claude Code hook protocol for PermissionRequest:

| Hook behavior | Exit code | Stdout | Result |
|--------------|-----------|--------|--------|
| Auto-approve | 0 | `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}` | Command executes immediately |
| Escalate | 0 | (empty) | Normal permission prompt appears |
| Block | 2 | (any) | Command is blocked (we never use this) |
| Error | non-0/2 | (any) | Normal permission prompt appears |

## Performance

| Path | Latency | When |
|------|---------|------|
| Static rule hit | ~60ms | Command matches always-escalate or always-approve pattern |
| CLI backend | 2-5s | AI evaluation via `claude -p` |
| API backend | 0.6-2s | AI evaluation via direct API |
| Error fallback | <100ms | Parse error, config error, etc. |

All latencies are acceptable vs the 2-10 seconds a user typically takes to read and approve a prompt manually.
