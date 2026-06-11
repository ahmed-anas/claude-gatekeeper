/**
 * Main entry point for the Claude Gatekeeper hook.
 *
 * Handles both hook types:
 * - PermissionRequest (allow-or-ask mode): approve safe commands, escalate uncertain ones
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
import { logDecision, logDebug, logError } from './logger';
import { checkPermissions } from './permissions';
import { resolveProjectDir } from './project-dir';

const DENY_PREFIX = 'This is an automated deny by Claude Gatekeeper. The user is currently away and has delegated the AI gatekeeper to allow/deny commands.';

/**
 * Tools that ask the user a question or to pick an option, rather than
 * requesting access to a resource. These are NOT access requests, so the
 * gatekeeper must never auto-answer them on the user's behalf in supervised
 * mode — the human should answer them directly.
 */
const INTERACTIVE_TOOLS = new Set(['AskUserQuestion']);

export function isInteractiveTool(toolName: string): boolean {
  return INTERACTIVE_TOOLS.has(toolName);
}

/**
 * Guidance returned to Claude when it asks the user a question while the user
 * is away (hands-free mode). There is no human to answer, so Claude is told to
 * decide for itself unless the choice carries real risk.
 */
const AWAY_QUESTION_GUIDANCE =
  'The user is away and cannot answer questions right now. Do not wait for input. ' +
  "Choose the option that best fits the context and the user's intent, and continue. " +
  'If no option is clearly safe and guessing could cause harm or a hard-to-reverse change, ' +
  'skip the step if it is optional, otherwise stop and end your turn rather than guessing.';

export function writePreToolUseDenyQuestion(reason: string): void {
  const output: PreToolUseOutput = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
  process.stdout.write(JSON.stringify(output));
}

export function readStdin(): string {
  return readFileSync(0, 'utf-8').trim();
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

async function handleEscalation(
  input: HookInput,
  hookType: 'PermissionRequest' | 'PreToolUse',
  reason: string,
  mode: GatekeeperMode,
  config: ApproverConfig
): Promise<void> {
  if (mode === 'hands-free') {
    writePreToolUseDeny(reason);
    return;
  }

  // allow-or-ask: try remote approval if notifications configured
  if (config.notify?.topic) {
    const { notifyAndWait } = await import('./notify');
    const response = await notifyAndWait(input, reason, config);
    if (response === 'approve') {
      writeApproval(hookType);
      return;
    }
  }

  // No notification, denied, or timeout → escalate normally
  process.exit(0);
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

  logDebug(`input: ${JSON.stringify({ hook_event_name: input.hook_event_name, tool_name: input.tool_name, cwd: input.cwd, transcript_path: input.transcript_path, tool_input: input.tool_input })}`, config);

  const hookType = input.hook_event_name;
  const mode = config.mode;

  // Interactive tools (e.g. AskUserQuestion) are NOT access requests — they ask
  // the user to choose an option. The gatekeeper must never answer them for the
  // user. In supervised mode, step aside silently so the human answers. In
  // hands-free mode there is no human, so tell Claude to decide for itself.
  // (Like handleEscalation, hands-free always emits a PreToolUse deny — that is
  // the hook event hands-free mode acts on; PermissionRequest can't carry a deny.)
  if (isInteractiveTool(input.tool_name)) {
    if (mode === 'hands-free') {
      logDecision(input, {
        decision: 'deny',
        confidence: 'absolute',
        reasoning: 'Interactive question while user is away — instructed Claude to decide',
        model: 'static',
        latencyMs: 0,
      }, config);
      writePreToolUseDenyQuestion(AWAY_QUESTION_GUIDANCE);
    } else {
      // Supervised: do nothing — let the user answer the question directly.
      logDecision(input, {
        decision: 'escalate',
        confidence: 'absolute',
        reasoning: 'Interactive question — left for the user to answer',
        model: 'static',
        latencyMs: 0,
      }, config);
      process.exit(0);
    }
    return;
  }

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
    // Permission deny list is an explicit user choice — never override via remote approval.
    // Hands-free: deny with reason. Supervised: escalate to user (no notify).
    if (mode === 'hands-free') {
      writePreToolUseDeny(permCheck.reason);
    } else {
      process.exit(0);
    }
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
      await handleEscalation(input, hookType, reasoning, mode, config);
      return;
    }

    // AI evaluation
    const projectDir = resolveProjectDir(input);
    logDebug(`resolved projectDir=${projectDir} (cwd=${input.cwd})`, config);
    const context = loadContext(projectDir, config);
    const { systemPrompt, userMessage } = buildPrompt(input, context, mode, projectDir);
    const result = await evaluate(systemPrompt, userMessage, config);

    logDecision(input, result, config);

    if (result.decision === 'approve' && meetsThreshold(result.confidence, config.confidenceThreshold)) {
      writeApproval(hookType);
    } else {
      await handleEscalation(input, hookType, result.reasoning, mode, config);
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
