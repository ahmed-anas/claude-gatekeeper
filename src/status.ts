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

function getHookStatus(): { permissionRequest: boolean; preToolUse: boolean } {
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

export function status(): void {
  console.log('\nClaude Gatekeeper Status');
  console.log('=======================\n');

  const hooks = getHookStatus();
  if (hooks.permissionRequest && hooks.preToolUse) {
    console.log('  Hooks:    both registered');
  } else if (hooks.permissionRequest) {
    console.log('  Hooks:    PermissionRequest only (run setup to add PreToolUse)');
  } else if (hooks.preToolUse) {
    console.log('  Hooks:    PreToolUse only (run setup to add PermissionRequest)');
  } else {
    console.log('  Hooks:    NOT registered');
    console.log('            Run `claude-gatekeeper setup` to register.');
  }

  const configPath = getConfigPath();
  const configExists = existsSync(configPath);
  console.log(`  Config:   ${configExists ? configPath : 'using defaults'}`);

  const config = loadConfig();
  console.log(`  Enabled:  ${config.enabled}`);
  console.log(`  Mode:     ${config.mode}`);
  console.log(`  Backend:  ${config.backend}`);
  console.log(`  Model:    ${config.model}`);
  console.log(`  Threshold: ${config.confidenceThreshold}`);

  const home = homedir();
  const cwd = process.cwd();
  const globalPolicy = existsSync(join(home, '.claude', 'claude-gatekeeper', 'APPROVAL_POLICY.md'));
  const projectPolicy = existsSync(join(cwd, 'APPROVAL_POLICY.md'))
    || existsSync(join(cwd, '.claude', 'APPROVAL_POLICY.md'));
  console.log(`  Policy:   global=${globalPolicy ? 'yes' : 'no'}, project=${projectPolicy ? 'yes' : 'no'}`);

  console.log(`  Log file: ${config.logFile}`);
  console.log('');
}
