/**
 * Status command — shows current installation and configuration state.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { loadConfig, getConfigPath } from './config';

/** Check if the hook is registered in ~/.claude/settings.json. */
function isHookRegistered(): { registered: boolean; command?: string } {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const permReqs = settings?.hooks?.PermissionRequest;
    if (!Array.isArray(permReqs)) return { registered: false };

    for (const entry of permReqs) {
      if (!Array.isArray(entry.hooks)) continue;
      for (const h of entry.hooks) {
        if (typeof h.command === 'string' && h.command.includes('gatekeeper')) {
          return { registered: true, command: h.command };
        }
      }
    }
  } catch {
    // settings.json doesn't exist or is invalid
  }
  return { registered: false };
}

export function status(): void {
  console.log('\nClaude Gatekeeper Status');
  console.log('=======================\n');

  // Hook registration
  const hook = isHookRegistered();
  if (hook.registered) {
    console.log(`  Hook:     registered`);
    console.log(`  Command:  ${hook.command}`);
  } else {
    console.log('  Hook:     NOT registered');
    console.log('            Run `claude-gatekeeper setup` to register.');
  }

  // Config
  const configPath = getConfigPath();
  const configExists = existsSync(configPath);
  console.log(`  Config:   ${configExists ? configPath : 'using defaults'}`);

  // Load and display active config
  const config = loadConfig();
  console.log(`  Enabled:  ${config.enabled}`);
  console.log(`  Backend:  ${config.backend}`);
  console.log(`  Model:    ${config.model}`);
  console.log(`  Threshold: ${config.confidenceThreshold}`);

  // Approval policies
  const home = homedir();
  const cwd = process.cwd();
  const globalPolicy = existsSync(join(home, '.claude', 'claude-gatekeeper', 'APPROVAL_POLICY.md'));
  const projectPolicy = existsSync(join(cwd, 'APPROVAL_POLICY.md'))
    || existsSync(join(cwd, '.claude', 'APPROVAL_POLICY.md'));
  console.log(`  Policy:   global=${globalPolicy ? 'yes' : 'no'}, project=${projectPolicy ? 'yes' : 'no'}`);

  // Log file
  console.log(`  Log file: ${config.logFile}`);
  console.log('');
}
