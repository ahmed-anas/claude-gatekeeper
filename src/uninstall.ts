/**
 * Uninstall command.
 *
 * Removes the PermissionRequest hook from ~/.claude/settings.json
 * and optionally deletes ~/.claude/claude-gatekeeper/ (config, log,
 * approval policy).
 */

import { createInterface } from 'readline';
import { existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { readJson, writeJson } from './setup';

/** Ask a yes/no question. Returns true for yes. */
function ask(question: string, defaultYes = false): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  return new Promise((res) => {
    rl.question(`${question} ${hint}: `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (a === '') return res(defaultYes);
      res(a === 'y' || a === 'yes');
    });
  });
}

/** Remove the gatekeeper hook from ~/.claude/settings.json. */
function removeHook(): boolean {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  const settings = readJson(settingsPath);
  if (!settings) return false;

  const hooks = settings.hooks as Record<string, unknown> | undefined;
  if (!hooks) return false;

  const permReqs = hooks.PermissionRequest;
  if (!Array.isArray(permReqs)) return false;

  const filtered = permReqs.filter((entry: Record<string, unknown>) => {
    const innerHooks = entry.hooks;
    if (!Array.isArray(innerHooks)) return true;
    return !innerHooks.some(
      (h: Record<string, unknown>) => typeof h.command === 'string' && h.command.includes('gatekeeper')
    );
  });

  if (filtered.length === permReqs.length) return false;

  if (filtered.length === 0) {
    delete hooks.PermissionRequest;
  } else {
    hooks.PermissionRequest = filtered;
  }

  writeJson(settingsPath, settings);
  return true;
}

export async function uninstall(): Promise<void> {
  console.log('\nClaude Gatekeeper Uninstall');
  console.log('==========================\n');

  // 1. Remove hook
  const removed = removeHook();
  if (removed) {
    console.log('  [ok] Hook removed from ~/.claude/settings.json');
  } else {
    console.log('  [--] Hook not found in ~/.claude/settings.json (already removed)');
  }

  // 2. Optionally delete config directory
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

  // 3. Warning about per-project files
  console.log('\n  NOTE: Any per-project APPROVAL_POLICY.md files were NOT removed.');
  console.log('        Remove them manually if no longer needed.\n');

  // 4. Done
  console.log('To fully remove, also run: npm uninstall -g claude-gatekeeper\n');
}
