/**
 * Uninstall command.
 *
 * Removes the PermissionRequest hook from ~/.claude/settings.json
 * and optionally deletes ~/.claude/claude-gatekeeper/ (config, log,
 * approval policy).
 */

import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { readJson, writeJson } from './fs-utils';
import { ask, closePrompt } from './cli-prompt';

function removeHookType(hooks: Record<string, unknown>, hookType: string): boolean {
  const entries = hooks[hookType];
  if (!Array.isArray(entries)) return false;

  const filtered = entries.filter((entry: Record<string, unknown>) => {
    const innerHooks = entry.hooks;
    if (!Array.isArray(innerHooks)) return true;
    return !innerHooks.some(
      (h: Record<string, unknown>) => typeof h.command === 'string' && h.command.includes('gatekeeper')
    );
  });

  if (filtered.length === entries.length) return false;

  if (filtered.length === 0) {
    delete hooks[hookType];
  } else {
    hooks[hookType] = filtered;
  }
  return true;
}

function removeHooks(): boolean {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  const settings = readJson(settingsPath);
  if (!settings) return false;

  const hooks = settings.hooks as Record<string, unknown> | undefined;
  if (!hooks) return false;

  const removedPerm = removeHookType(hooks, 'PermissionRequest');
  const removedPreTool = removeHookType(hooks, 'PreToolUse');

  if (removedPerm || removedPreTool) {
    writeJson(settingsPath, settings);
  }
  return removedPerm || removedPreTool;
}

export async function uninstall(): Promise<void> {
  console.log('\nClaude Gatekeeper Uninstall');
  console.log('==========================\n');

  const removed = removeHooks();
  if (removed) {
    console.log('  [ok] Hooks removed from ~/.claude/settings.json');
  } else {
    console.log('  [--] Hooks not found in ~/.claude/settings.json (already removed)');
  }

  const configDir = join(homedir(), '.claude', 'claude-gatekeeper');
  if (existsSync(configDir)) {
    const wantDelete = await ask('\nDelete ~/.claude/claude-gatekeeper/ (config, logs, approval policy)?');
    if (wantDelete) {
      rmSync(configDir, { recursive: true, force: true });
      console.log('  [ok] Deleted ~/.claude/claude-gatekeeper/');
    } else {
      console.log('  [skip] Kept ~/.claude/claude-gatekeeper/');
    }
  }

  console.log('\n  NOTE: Any per-project APPROVAL_POLICY.md files were NOT removed.');
  console.log('        Remove them manually if no longer needed.\n');

  closePrompt();
  console.log('To fully remove, also run: npm uninstall -g claude-gatekeeper\n');
}
