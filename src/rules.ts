/**
 * Static pattern matching rules (fast path, no AI needed).
 *
 * Checks tool inputs against configurable wildcard patterns to immediately
 * escalate or approve without calling the AI. This handles two cases:
 *
 * 1. Obviously dangerous commands (rm -rf, sudo, curl|sh) → escalate (allow-or-ask) or deny (hands-free)
 * 2. User-defined safe patterns → approve immediately
 *
 * Uses a custom wildcard matcher instead of minimatch because minimatch
 * is designed for file paths (its * doesn't match / or spaces), but we
 * need to match full shell commands like "sudo tee /etc/passwd".
 *
 * For Bash commands, compound expressions (pipes, &&, ;) are split and
 * each segment is checked individually, preventing dangerous commands
 * from being hidden in chains like "echo hello && sudo rm -rf /".
 */

import { ApproverConfig, GatekeeperMode, HookInput, RuleDecision } from './types';

/**
 * Extract the relevant string to match against from a hook input.
 * For Bash: the command string
 * For Write/Edit: the file_path
 * For WebFetch: the url
 * For everything else: JSON of tool_input
 */
function extractMatchTarget(input: HookInput): string {
  switch (input.tool_name) {
    case 'Bash':
      return String(input.tool_input.command || '');
    case 'Write':
    case 'Edit':
      return String(input.tool_input.file_path || '');
    case 'WebFetch':
      return String(input.tool_input.url || '');
    default:
      return JSON.stringify(input.tool_input);
  }
}

/**
 * For Bash commands, split on pipes and chains to check each segment.
 * This catches dangerous commands hidden in compound expressions like:
 * "echo hello | sudo rm -rf /"
 */
function splitCompoundCommand(command: string): string[] {
  return command
    .split(/\s*(?:\|{1,2}|&&|;)\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Simple wildcard matching for command patterns.
 * Supports * as "match anything" (including / and spaces).
 * This is intentionally simpler than minimatch because we're matching
 * commands, not file paths.
 */
function wildcardMatch(value: string, pattern: string): boolean {
  // Escape regex special chars except *
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(value);
}

function matchesAnyPattern(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => wildcardMatch(value, pattern));
}

/**
 * Check static rules against the hook input.
 * Returns 'approve' if it matches an always-approve pattern,
 * 'escalate' (allow-or-ask) or 'deny' (hands-free) if it matches a dangerous pattern,
 * 'evaluate' if no static rule matches (needs AI evaluation).
 */
export function checkRules(input: HookInput, config: ApproverConfig, mode: GatekeeperMode = 'allow-or-ask'): RuleDecision {
  const target = extractMatchTarget(input);
  const dangerousResult: RuleDecision = mode === 'hands-free' ? 'deny' : 'escalate';

  if (input.tool_name === 'Bash') {
    const segments = splitCompoundCommand(target);
    // If ANY segment matches an escalate pattern, block the whole thing
    for (const segment of segments) {
      if (matchesAnyPattern(segment, config.alwaysEscalatePatterns)) {
        return dangerousResult;
      }
    }
    // Also check the full command (pattern may span segments)
    if (matchesAnyPattern(target, config.alwaysEscalatePatterns)) {
      return dangerousResult;
    }
    if (matchesAnyPattern(target, config.alwaysApprovePatterns)) {
      return 'approve';
    }
  } else {
    if (matchesAnyPattern(target, config.alwaysEscalatePatterns)) {
      return dangerousResult;
    }
    if (matchesAnyPattern(target, config.alwaysApprovePatterns)) {
      return 'approve';
    }
  }

  return 'evaluate';
}

export { extractMatchTarget, splitCompoundCommand, matchesAnyPattern };
