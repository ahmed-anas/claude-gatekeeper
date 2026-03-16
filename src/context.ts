/**
 * Context gathering for AI prompt construction.
 *
 * Loads files that provide context for the AI's decision:
 * - User settings (~/.claude/settings.json) — existing permission rules
 * - Project settings (<cwd>/.claude/settings.json)
 * - Global CLAUDE.md (~/.claude/CLAUDE.md) — user instructions
 * - Project CLAUDE.md (<cwd>/CLAUDE.md) — project instructions
 * - Approval policy (global ~/.claude/claude-gatekeeper/ + project-level, merged)
 *
 * All reads are best-effort: missing files return null, never throw.
 * CLAUDE.md content is truncated to maxContextLength to control prompt size.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { ApproverConfig, PromptContext, UserSettings } from './types';

/** Safely read a file, returning null if it doesn't exist or can't be read. */
function safeReadFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/** Safely parse JSON, returning null if invalid. */
function safeParseJson<T>(content: string | null): T | null {
  if (!content) return null;
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/** Truncate a string to maxLength, appending "..." if truncated. */
function truncate(text: string | null, maxLength: number): string | null {
  if (!text) return null;
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/** Load all context needed for the AI prompt. */
export function loadContext(cwd: string, config: ApproverConfig): PromptContext {
  const home = homedir();

  // User settings: ~/.claude/settings.json
  const userSettingsRaw = safeReadFile(join(home, '.claude', 'settings.json'));
  const userSettings = safeParseJson<UserSettings>(userSettingsRaw);

  // Project settings: <cwd>/.claude/settings.json
  const projectSettingsRaw = safeReadFile(join(cwd, '.claude', 'settings.json'));
  const projectSettings = safeParseJson<UserSettings>(projectSettingsRaw);

  // Global CLAUDE.md: ~/.claude/CLAUDE.md
  const globalClaudeMd = safeReadFile(join(home, '.claude', 'CLAUDE.md'));

  // Project CLAUDE.md: <cwd>/CLAUDE.md
  const projectClaudeMd = safeReadFile(join(cwd, 'CLAUDE.md'));

  // Approval policy: global + project-level (both loaded, merged)
  const globalApprovalPolicy = safeReadFile(join(home, '.claude', 'claude-gatekeeper', 'APPROVAL_POLICY.md'));
  const projectApprovalPolicy =
    safeReadFile(join(cwd, 'APPROVAL_POLICY.md')) ??
    safeReadFile(join(cwd, '.claude', 'APPROVAL_POLICY.md'));

  return {
    userSettings,
    projectSettings,
    claudeMd: truncate(globalClaudeMd, config.maxContextLength),
    projectClaudeMd: truncate(projectClaudeMd, config.maxContextLength),
    globalApprovalPolicy: truncate(globalApprovalPolicy, config.maxContextLength),
    projectApprovalPolicy: truncate(projectApprovalPolicy, config.maxContextLength),
  };
}

export { safeReadFile, safeParseJson, truncate };
