/**
 * Main entry point for the Claude Gatekeeper hook.
 *
 * This module reads a PermissionRequest JSON from stdin, evaluates it
 * through a layered pipeline (static rules → AI), and writes an approval
 * JSON to stdout or exits silently to escalate to the user.
 *
 * Safety invariant: every code path either writes approval JSON + exits 0,
 * or exits 0 with no output (escalation). The hook NEVER auto-denies.
 */

import { readFileSync } from 'fs';
import { ApproverConfig, EvaluationResult, HookInput, HookOutput, meetsThreshold } from './types';
import { loadConfig } from './config';
import { loadContext } from './context';
import { buildPrompt } from './prompt';
import { evaluate } from './evaluator';
import { checkRules } from './rules';
import { logDecision, logError, logWarning } from './logger';

/** Read all of stdin synchronously. Uses /dev/stdin for speed (no async overhead). */
export function readStdin(): string {
  return readFileSync('/dev/stdin', 'utf-8').trim();
}

/** Write the approval JSON to stdout. This is the only way we auto-approve. */
export function writeApproval(): void {
  const output: HookOutput = {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'allow' },
    },
  };
  process.stdout.write(JSON.stringify(output));
}

/** Every error path results in escalation (exit 0, no output). */
export async function main(): Promise<void> {
  let input: HookInput;
  let config: ApproverConfig;

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

  try {
    const staticDecision = checkRules(input, config);

    if (staticDecision === 'approve') {
      writeApproval();
      logDecision(input, {
        decision: 'approve',
        confidence: 'absolute',
        reasoning: 'Matched always-approve pattern',
        model: 'static',
        latencyMs: 0,
      }, config);
      return;
    }

    if (staticDecision === 'escalate') {
      logDecision(input, {
        decision: 'escalate',
        confidence: 'absolute',
        reasoning: 'Matched always-escalate pattern',
        model: 'static',
        latencyMs: 0,
      }, config);
      process.exit(0);
      return;
    }

    const context = loadContext(input.cwd, config);
    const { systemPrompt, userMessage } = buildPrompt(input, context);
    const result = await evaluate(systemPrompt, userMessage, config);

    logDecision(input, result, config);

    if (result.decision === 'approve' && meetsThreshold(result.confidence, config.confidenceThreshold)) {
      writeApproval();
    } else {
      process.exit(0);
    }
  } catch (error) {
    // Unhandled error = escalate (fail-safe)
    try {
      logError(input, error, config);
    } catch {
      // Can't even log — just escalate silently
    }
    process.exit(0);
  }
}

// Auto-run when executed directly (not when imported for testing)
if (require.main === module) {
  main().catch(() => process.exit(0));
}
