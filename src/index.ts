/**
 * Main entry point for the Claude Gatekeeper hook.
 *
 * Handles both hook types:
 * - PermissionRequest: approve safe commands, escalate uncertain ones
 * - PreToolUse (hands-free mode): approve safe commands, deny dangerous ones
 *
 * Safety invariant:
 * - Supervised mode: errors → escalate (exit 0, no output)
 * - Hands-free mode: errors → deny (fail-closed, no human to ask)
 */

import { readFileSync } from 'fs';
import {
  ApproverConfig, EvaluationResult, GatekeeperMode, HookInput,
  PermissionRequestOutput, PreToolUseOutput, meetsThreshold,
} from './types';
import { loadConfig } from './config';
import { loadContext } from './context';
import { buildPrompt } from './prompt';
import { evaluate } from './evaluator';
import { checkRules } from './rules';
import { logDecision, logError } from './logger';
import { checkPermissions } from './permissions';
import { resolveProjectDir } from './project-dir';

const DENY_PREFIX = 'This is an automated deny by Claude Gatekeeper. The user is currently away and has delegated the AI gatekeeper to allow/deny commands.';

export function readStdin(): string {
  return readFileSync('/dev/stdin', 'utf-8').trim();
}

export function writePermissionApproval(): void {
  const output: PermissionRequestOutput = {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'allow' },
    },
  };
  process.stdout.write(JSON.stringify(output));
}

export function writePreToolUseAllow(): void {
  const output: PreToolUseOutput = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
    },
  };
  process.stdout.write(JSON.stringify(output));
}

export function writePreToolUseDeny(reason: string): void {
  const output: PreToolUseOutput = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `${DENY_PREFIX} Reason: ${reason}. You may attempt alternative commands.`,
    },
  };
  process.stdout.write(JSON.stringify(output));
}

function writeApproval(hookType: 'PermissionRequest' | 'PreToolUse'): void {
  if (hookType === 'PreToolUse') {
    writePreToolUseAllow();
  } else {
    writePermissionApproval();
  }
}

function writeDenyOrEscalate(reason: string, mode: GatekeeperMode): void {
  if (mode === 'hands-free') {
    writePreToolUseDeny(reason);
  } else {
    // Supervised mode: escalate by exiting silently
    process.exit(0);
  }
}

export async function main(): Promise<void> {
  let input: HookInput;
  let config: ApproverConfig;

  // Parse errors → always escalate (don't deny on hook bugs)
  try {
    const raw = readStdin();
    input = JSON.parse(raw) as HookInput;
  } catch {
    process.exit(0);
    return;
  }

  try {
    config = loadConfig();
  } catch {
    process.exit(0);
    return;
  }

  if (!config.enabled) {
    process.exit(0);
    return;
  }

  const hookType = input.hook_event_name;
  const mode = config.mode;

  // Check the user's Claude Code permission lists (allow/deny/ask).
  // PreToolUse fires before Claude's own permission check, so we replicate it.
  // PermissionRequest also checks — to avoid auto-approving deny/ask commands.
  const permCheck = checkPermissions(input);

  if (permCheck.action === 'allow') {
    // Allow-listed → pass through (no evaluation needed)
    process.exit(0);
    return;
  }

  if (permCheck.action === 'deny') {
    logDecision(input, {
      decision: mode === 'hands-free' ? 'deny' : 'escalate',
      confidence: 'absolute',
      reasoning: permCheck.reason,
      model: 'permissions',
      latencyMs: 0,
    }, config);
    // Hands-free: deny with reason. Supervised: escalate to user.
    writeDenyOrEscalate(permCheck.reason, mode);
    return;
  }

  // PreToolUse in supervised mode with no permission match →
  // pass through (let PermissionRequest handle it)
  if (hookType === 'PreToolUse' && mode !== 'hands-free') {
    process.exit(0);
    return;
  }

  try {
    const staticDecision = checkRules(input, config, mode);

    if (staticDecision === 'approve') {
      writeApproval(hookType);
      logDecision(input, {
        decision: 'approve',
        confidence: 'absolute',
        reasoning: 'Matched always-approve pattern',
        model: 'static',
        latencyMs: 0,
      }, config);
      return;
    }

    if (staticDecision === 'escalate' || staticDecision === 'deny') {
      const reasoning = 'Matched always-escalate pattern';
      logDecision(input, {
        decision: staticDecision,
        confidence: 'absolute',
        reasoning,
        model: 'static',
        latencyMs: 0,
      }, config);
      writeDenyOrEscalate(reasoning, mode);
      return;
    }

    // AI evaluation
    const projectDir = resolveProjectDir(input);
    const context = loadContext(projectDir, config);
    const { systemPrompt, userMessage } = buildPrompt(input, context, mode);
    const result = await evaluate(systemPrompt, userMessage, config);

    logDecision(input, result, config);

    if (result.decision === 'approve' && meetsThreshold(result.confidence, config.confidenceThreshold)) {
      writeApproval(hookType);
    } else {
      writeDenyOrEscalate(result.reasoning, mode);
    }
  } catch (error) {
    try {
      logError(input, error, config);
    } catch {
      // Can't even log
    }
    // Hands-free: deny on error (fail-closed). Supervised: escalate.
    if (mode === 'hands-free') {
      writePreToolUseDeny('Internal error — blocked for safety');
    } else {
      process.exit(0);
    }
  }
}

if (require.main === module) {
  main().catch(() => process.exit(0));
}
