/**
 * Mode command — view or switch the gatekeeper's operating mode.
 *
 * Usage:
 *   claude-gatekeeper mode              — show current mode and options
 *   claude-gatekeeper mode hands-free   — switch to hands-free mode
 *   claude-gatekeeper mode allow-or-ask — switch to allow-or-ask mode
 */

import { existsSync } from 'fs';
import { loadConfig, getConfigPath } from './config';
import { readJson, writeJson } from './fs-utils';
import { GATEKEEPER_MODES, GatekeeperMode } from './types';

const MODE_DESCRIPTIONS: Record<string, string> = {
  'allow-or-ask': 'Approve safe commands, ask user about uncertain ones',
  'hands-free': 'Approve safe commands, deny dangerous ones (no user interaction)',
};

export function setMode(requestedMode?: string): void {
  const config = loadConfig();
  const currentMode = config.mode;

  // No argument: show current mode and options
  if (!requestedMode) {
    console.log(`\nCurrent mode: ${currentMode}\n`);
    console.log('Available modes:');
    for (const m of GATEKEEPER_MODES) {
      const marker = m === currentMode ? ' (active)' : '';
      console.log(`  ${m}${marker} — ${MODE_DESCRIPTIONS[m]}`);
    }
    console.log(`  full — Full autonomous mode (coming soon)`);
    console.log(`\nUsage: claude-gatekeeper mode <mode-name>\n`);
    return;
  }

  // "full" is planned but not available yet
  if (requestedMode === 'full') {
    console.error('\n"full" mode is not yet available. Coming soon.\n');
    process.exit(1);
  }

  if (!GATEKEEPER_MODES.includes(requestedMode as GatekeeperMode)) {
    console.error(`\nUnknown mode: "${requestedMode}"`);
    console.error(`Available modes: ${GATEKEEPER_MODES.join(', ')}\n`);
    process.exit(1);
  }

  if (requestedMode === currentMode) {
    console.log(`\nAlready in "${currentMode}" mode.\n`);
    return;
  }

  // Apply the mode change
  const configPath = getConfigPath();
  const existing = existsSync(configPath) ? readJson(configPath) ?? {} : {};
  existing.mode = requestedMode;
  writeJson(configPath, existing);

  console.log(`\nMode changed: ${currentMode} -> ${requestedMode}`);

  if (requestedMode === 'hands-free') {
    console.log('\n  In hands-free mode:');
    console.log('  - Safe commands are auto-approved');
    console.log('  - Dangerous commands are denied with a reason');
    console.log('  - Claude receives the denial reason and can adjust');
    console.log('  - No user interaction required');
  } else {
    console.log('\n  In allow-or-ask mode:');
    console.log('  - Safe commands are auto-approved');
    console.log('  - Uncertain commands are escalated to the user');
  }
  console.log('');
}
