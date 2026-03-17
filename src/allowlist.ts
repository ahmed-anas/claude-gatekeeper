/**
 * Checks if a tool use matches the user's Claude Code allow-list.
 *
 * PreToolUse hooks fire before Claude Code checks its own permissions,
 * so we replicate the check to avoid evaluating (and potentially
 * denying) commands the user has explicitly allowed.
 *
 * This is a best-effort match. If we can't determine whether a command
 * is allowed, we fall through to evaluation (safe — just slower).
 *
 * Claude Code permission format examples:
 *   "Bash(echo:*)"           → Bash commands starting with "echo"
 *   "Read(///**)"            → Read any file
 *   "WebSearch"              → Any WebSearch use
 *   "WebFetch(domain:x.com)" → WebFetch for specific domain
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { HookInput } from './types';

interface ParsedRule {
  toolName: string;
  pattern: string | null;
}

function parseRule(rule: string): ParsedRule | null {
  const match = rule.match(/^(\w+)(?:\((.+)\))?$/);
  if (!match) return null;
  return { toolName: match[1], pattern: match[2] || null };
}

/**
 * Extract the relevant input string for matching.
 * For Bash: the command. For file tools: the path. For WebFetch: the URL.
 */
function getInputString(input: HookInput): string {
  switch (input.tool_name) {
    case 'Bash':
      return String(input.tool_input.command || '');
    case 'Write':
    case 'Edit':
    case 'Read':
    case 'Glob':
      return String(input.tool_input.file_path || input.tool_input.pattern || '');
    case 'Grep':
      return String(input.tool_input.pattern || '');
    case 'WebFetch':
      return String(input.tool_input.url || '');
    default:
      return '';
  }
}

/**
 * Check if a tool input matches a Claude Code permission pattern.
 *
 * Pattern formats:
 *   "prefix:*"        → input starts with "prefix" (then space or end)
 *   "///**"           → matches any path (special catch-all)
 *   "domain:host.com" → for WebFetch, matches the URL's hostname
 *   "*"               → matches everything
 */
function matchesRule(input: HookInput, pattern: string): boolean {
  const inputStr = getInputString(input);

  // Special: catch-all patterns
  if (pattern === '*' || pattern === '///**') return true;

  // Special: WebFetch domain matching — "domain:host.com"
  if (input.tool_name === 'WebFetch' && pattern.startsWith('domain:')) {
    const expectedDomain = pattern.slice('domain:'.length);
    try {
      const hostname = new URL(inputStr).hostname;
      return hostname === expectedDomain || hostname.endsWith('.' + expectedDomain);
    } catch {
      return false;
    }
  }

  // Standard: "prefix:*" → command/path starts with "prefix" followed by space or end
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -2);
    return inputStr === prefix || inputStr.startsWith(prefix + ' ');
  }

  // Fallback: exact match
  return inputStr === pattern;
}

/** Load the user's allow-list from ~/.claude/settings.json. */
function loadAllowList(): string[] {
  try {
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    return settings?.permissions?.allow ?? [];
  } catch {
    return [];
  }
}

/**
 * Returns true if the tool use matches the user's Claude Code allow-list.
 * If matched, the gatekeeper should pass through without evaluation.
 */
export function isInAllowList(input: HookInput): boolean {
  const allowList = loadAllowList();
  if (allowList.length === 0) return false;

  for (const rule of allowList) {
    const parsed = parseRule(rule);
    if (!parsed) continue;
    if (parsed.toolName !== input.tool_name) continue;

    // No pattern → any use of this tool is allowed
    if (parsed.pattern === null) return true;

    if (matchesRule(input, parsed.pattern)) return true;
  }

  return false;
}
