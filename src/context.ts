/**
 * Context gathering for AI prompt construction.
 *
 * Loads files that provide context for the AI's decision:
 * - User settings (~/.claude/settings.json) — existing permission rules
 * - Project settings (<cwd>/.claude/settings.json)
 * - Global CLAUDE.md (~/.claude/CLAUDE.md) — user instructions
 * - Project CLAUDE.md (<cwd>/CLAUDE.md) — project instructions
 * - Gatekeeper policy (global ~/.claude/claude-gatekeeper/ + project-level, merged)
 *
 * All reads are best-effort: missing files return null, never throw.
 * CLAUDE.md content is truncated to maxContextLength to control prompt size.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { ApproverConfig, PromptContext, UserSettings } from './types';

function safeReadFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function safeParseJson<T>(content: string | null): T | null {
  if (!content) return null;
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

function truncate(text: string | null, maxLength: number): string | null {
  if (!text) return null;
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export function loadContext(cwd: string, config: ApproverConfig): PromptContext {
  const home = homedir();

  const userSettingsRaw = safeReadFile(join(home, '.claude', 'settings.json'));
  const userSettings = safeParseJson<UserSettings>(userSettingsRaw);

  const projectSettingsRaw = safeReadFile(join(cwd, '.claude', 'settings.json'));
  const projectSettings = safeParseJson<UserSettings>(projectSettingsRaw);

  const globalClaudeMd = safeReadFile(join(home, '.claude', 'CLAUDE.md'));
  const projectClaudeMd = safeReadFile(join(cwd, 'CLAUDE.md'));

  const globalApprovalPolicy = safeReadFile(join(home, '.claude', 'claude-gatekeeper', 'GATEKEEPER_POLICY.md'));
  const projectApprovalPolicy =
    safeReadFile(join(cwd, 'GATEKEEPER_POLICY.md')) ??
    safeReadFile(join(cwd, '.claude', 'GATEKEEPER_POLICY.md'));

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
