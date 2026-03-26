/**
 * Enable/disable command — toggle the gatekeeper on or off.
 *
 * Usage:
 *   claude-gatekeeper enable   — enable the gatekeeper
 *   claude-gatekeeper disable  — disable the gatekeeper
 */

import { existsSync } from 'fs';
import { loadConfig, getConfigPath } from './config';
import { readJson, writeJson } from './fs-utils';
import { getHookStatus } from './status';

export function setEnabled(enabled: boolean): void {
  const config = loadConfig();
  const currentEnabled = config.enabled;

  if (enabled === currentEnabled) {
    console.log(`\nAlready ${enabled ? 'enabled' : 'disabled'}.\n`);
    return;
  }

  // Apply the change
  const configPath = getConfigPath();
  const existing = existsSync(configPath) ? readJson(configPath) ?? {} : {};
  existing.enabled = enabled;
  writeJson(configPath, existing);

  if (enabled) {
    console.log('\nGatekeeper enabled.\n');
    const hooks = getHookStatus();
    if (!hooks.permissionRequest && !hooks.preToolUse) {
      console.log('  Warning: No hooks are registered. Run `claude-gatekeeper setup` to register hooks.\n');
    }
  } else {
    console.log('\nGatekeeper disabled.\n');
    console.log('  Hooks remain registered but will escalate all requests to the user.');
    console.log('  Run `claude-gatekeeper enable` to re-enable.\n');
  }
}
