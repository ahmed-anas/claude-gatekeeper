/**
 * Status command — shows current installation and configuration state.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { loadConfig, getConfigPath } from './config';

function checkHookType(settings: Record<string, unknown>, hookType: string): boolean {
  const hooks = (settings as any)?.hooks?.[hookType];
  if (!Array.isArray(hooks)) return false;
  return hooks.some((entry: any) =>
    Array.isArray(entry.hooks) && entry.hooks.some((h: any) =>
      typeof h.command === 'string' && h.command.includes('gatekeeper')
    )
  );
}

export function getHookStatus(): { permissionRequest: boolean; preToolUse: boolean } {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    return {
      permissionRequest: checkHookType(settings, 'PermissionRequest'),
      preToolUse: checkHookType(settings, 'PreToolUse'),
    };
  } catch {
    return { permissionRequest: false, preToolUse: false };
  }
}

/** Build status text as a string. Used by both the status command and ai-help context. */
export function getStatusText(): string {
  const lines: string[] = [];

  const hooks = getHookStatus();
  if (hooks.permissionRequest && hooks.preToolUse) {
    lines.push('  Hooks:    both registered');
  } else if (hooks.permissionRequest) {
    lines.push('  Hooks:    PermissionRequest only (run setup to add PreToolUse)');
  } else if (hooks.preToolUse) {
    lines.push('  Hooks:    PreToolUse only (run setup to add PermissionRequest)');
  } else {
    lines.push('  Hooks:    NOT registered');
  }

  const config = loadConfig();
  const hasHooks = hooks.permissionRequest || hooks.preToolUse;
  if (hasHooks && config.enabled) {
    lines.push('  State:    active');
  } else if (hasHooks && !config.enabled) {
    lines.push('  State:    paused (disabled)');
  } else {
    lines.push('  State:    not installed');
  }

  const configPath = getConfigPath();
  const configExists = existsSync(configPath);
  lines.push(`  Config:   ${configExists ? configPath : 'using defaults'}`);
  lines.push(`  Enabled:  ${config.enabled}`);
  lines.push(`  Mode:     ${config.mode}`);
  lines.push(`  Backend:  ${config.backend}`);
  lines.push(`  Model:    ${config.model}`);
  lines.push(`  Threshold: ${config.confidenceThreshold}`);

  const home = homedir();
  const cwd = process.cwd();
  const globalPolicy = existsSync(join(home, '.claude', 'claude-gatekeeper', 'GATEKEEPER_POLICY.md'));
  const projectPolicy = existsSync(join(cwd, 'GATEKEEPER_POLICY.md'))
    || existsSync(join(cwd, '.claude', 'GATEKEEPER_POLICY.md'));
  lines.push(`  Policy:   global=${globalPolicy ? 'yes' : 'no'}, project=${projectPolicy ? 'yes' : 'no'}`);
  lines.push(`  Notify:   ${config.notify?.topic ? `enabled (topic: ${config.notify.topic})` : 'not configured'}`);
  lines.push(`  AI help:  ${config.aiHelpAcknowledged ? 'acknowledged' : 'not yet used'}`);
  lines.push(`  Log file: ${config.logFile}`);

  return lines.join('\n');
}

export function status(): void {
  console.log('\nClaude Gatekeeper Status');
  console.log('=======================\n');
  console.log(getStatusText());
  console.log('');
}
