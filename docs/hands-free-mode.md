# Hands-Free Mode — Design Document

## Overview

Hands-free mode allows Claude Gatekeeper to operate without a human in the loop. Instead of escalating uncertain/dangerous commands to the user, it **denies** them with a reason that Claude can see and act on.

## Approach: Dual-Hook (Option C)

- **PermissionRequest hook** — for approve (works reliably)
- **PreToolUse hook** — for deny in hands-free mode (deny actually works here, unlike PermissionRequest)

Both hooks point to the same `bin/gatekeeper` binary. The hook type is detected from `hook_event_name` in the stdin JSON.

## Why PreToolUse for Deny

PermissionRequest hook `deny` is broken (GitHub issue #19298) — Claude Code ignores the deny decision and shows the interactive prompt anyway. PreToolUse hook deny works correctly and feeds `permissionDecisionReason` back to Claude, enabling the AI to adjust its approach.

## Protocol

### PreToolUse Output (hands-free mode)

Allow:
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow"
  }
}
```

Deny:
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "This is an automated deny by Claude Gatekeeper. The user is currently away and has delegated the AI gatekeeper to allow/deny commands. Reason: [reasoning]. You may attempt alternative commands."
  }
}
```

### PermissionRequest Output (unchanged)

Allow: `{ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } }`
Escalate: exit 0, no output

## Config

```json
{
  "handsFree": false
}
```

Single boolean. Default `false` (supervised mode). Toggling this in config.json switches behavior without re-running setup.

## Decision Flow

### PreToolUse fires (every tool use)

```
Parse stdin -> Is handsFree enabled?
  NO  -> exit 0, no output (pass through to PermissionRequest)
  YES -> config -> static rules -> [AI] -> decision:
           approve -> write PreToolUse allow JSON
           deny    -> write PreToolUse deny JSON with reason
```

### PermissionRequest fires (only when permission prompt would show)

```
Parse stdin -> config -> static rules -> [AI] -> decision:
  approve  -> write allow JSON (current behavior)
  escalate -> exit 0 (current behavior)
```

## Fail-Safe Behavior

| Scenario | Supervised Mode | Hands-Free Mode |
|----------|----------------|-----------------|
| Stdin parse error | Escalate | Escalate (don't deny on hook bugs) |
| Config load failure | Escalate | Escalate |
| AI timeout | Escalate | **Deny** (no human watching) |
| AI returns garbage | Escalate | **Deny** (no human watching) |
| Static rule match | Escalate | **Deny** with reason |
| Low confidence approve | Escalate | **Deny** (can't confidently approve) |
| Unhandled exception | Escalate | **Deny** (fail-closed) |

## Setup

Both hooks are always registered. Mode is controlled by config:
- `setup` registers both `PreToolUse` and `PermissionRequest` hooks
- `setup` asks "Enable hands-free mode?" and sets `handsFree` in config
- `uninstall` removes both hook types

## Files Changed

| File | Change |
|------|--------|
| `types.ts` | Widen `hook_event_name`, add `PreToolUseOutput`, widen `EvaluationResult.decision` to include `'deny'`, add `HookMode`, add `handsFree` to config |
| `config.ts` | Add `handsFree: false` default, validate as boolean |
| `rules.ts` | `checkRules` gains `mode` param — returns `'deny'` instead of `'escalate'` in hands-free |
| `prompt.ts` | Add `SYSTEM_PROMPT_HANDS_FREE` variant, `buildPrompt` accepts `mode` |
| `evaluator.ts` | `parseAiResponse` accepts `"deny"` as valid decision |
| `index.ts` | Mode detection, PreToolUse output functions, branching by hook type |
| `setup.ts` | Register both hooks, ask about hands-free |
| `uninstall.ts` | Remove both hook types |
| `status.ts` | Show both hooks and hands-free status |
| `logger.ts` | No change (already logs decision as string) |
| `context.ts` | No change |

## Implementation Order

1. `types.ts` — widen types first
2. `config.ts` — add `handsFree` field
3. `rules.ts` — add mode parameter
4. `prompt.ts` — add hands-free prompt variant
5. `evaluator.ts` — accept `"deny"` in parser
6. `index.ts` — wire it all together
7. `setup.ts` / `uninstall.ts` / `status.ts` — CLI changes
8. Tests
