/**
 * Configuration loading and merging.
 *
 * Loads user config from ~/.claude/claude-gatekeeper/config.json
 * and merges it with sensible defaults. Falls back to defaults on
 * any error (missing file, invalid JSON, etc).
 *
 * User-provided alwaysEscalatePatterns are MERGED with defaults
 * (not replacing), so built-in safety patterns can't be accidentally removed.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { ApproverConfig, CONFIDENCE_LEVELS, ConfidenceLevel, GATEKEEPER_MODES, GatekeeperMode, NotifyConfig } from './types';

const DEFAULT_CONFIG: ApproverConfig = {
  enabled: true,
  mode: 'allow-or-ask',
  backend: 'cli',
  model: 'haiku',
  confidenceThreshold: 'high',
  timeoutMs: 90000,
  maxContextLength: 2000,
  logFile: join(homedir(), '.claude', 'claude-gatekeeper', 'decisions.log'),
  logLevel: 'info',
  alwaysEscalatePatterns: [
    'rm -rf /*',
    'rm -rf /',
    'rm -rf ~',
    'rm -rf $HOME',
    '> /dev/sd*',
    'mkfs.*',
    'dd if=*',
    'chmod -R 777 /*',
    ':(){:|:&};:',
    'curl *| *sh',
    'curl *| *bash',
    'wget *| *sh',
    'wget *| *bash',
    'sudo *',
    'su *',
    'npm publish*',
    'npm unpublish*',
    'aws * delete-*',
    'aws * terminate-*',
    'aws * destroy-*',
    'terraform apply*',
    'terraform destroy*',
    'docker rm *',
    'docker rmi *',
    'docker system prune*',
  ],
  alwaysApprovePatterns: [],
};

export function resolvePath(filePath: string): string {
  if (filePath.startsWith('~/') || filePath === '~') {
    return join(homedir(), filePath.slice(1));
  }
  return filePath;
}

export function getConfigPath(): string {
  return process.env.CLAUDE_GATEKEEPER_CONFIG || join(homedir(), '.claude', 'claude-gatekeeper', 'config.json');
}

export function loadConfig(): ApproverConfig {
  const configPath = getConfigPath();
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const userConfig = JSON.parse(raw) as Partial<ApproverConfig>;
    return mergeConfig(userConfig);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function mergeConfig(userConfig: Partial<ApproverConfig>): ApproverConfig {
  const merged: ApproverConfig = { ...DEFAULT_CONFIG, ...userConfig };

  if (!CONFIDENCE_LEVELS.includes(merged.confidenceThreshold as ConfidenceLevel)) {
    merged.confidenceThreshold = DEFAULT_CONFIG.confidenceThreshold;
  }
  if (merged.timeoutMs < 1000) merged.timeoutMs = 1000;
  if (merged.timeoutMs > 120000) merged.timeoutMs = 120000;
  if (merged.maxContextLength < 0) merged.maxContextLength = 0;

  if (!GATEKEEPER_MODES.includes(merged.mode as GatekeeperMode)) merged.mode = DEFAULT_CONFIG.mode;
  if (!['cli', 'api'].includes(merged.backend)) merged.backend = DEFAULT_CONFIG.backend;
  if (!['debug', 'info', 'warn'].includes(merged.logLevel)) merged.logLevel = DEFAULT_CONFIG.logLevel;

  merged.logFile = resolvePath(merged.logFile);

  // User escalate patterns are merged with (not replacing) defaults
  if (userConfig.alwaysEscalatePatterns) {
    merged.alwaysEscalatePatterns = [
      ...DEFAULT_CONFIG.alwaysEscalatePatterns,
      ...userConfig.alwaysEscalatePatterns.filter(
        (p) => !DEFAULT_CONFIG.alwaysEscalatePatterns.includes(p)
      ),
    ];
  }

  // Validate and default notify config
  if (merged.notify) {
    if (!merged.notify.topic || typeof merged.notify.topic !== 'string') {
      merged.notify = undefined;
    } else {
      merged.notify = {
        topic: merged.notify.topic,
        server: merged.notify.server || 'https://ntfy.sh',
        timeoutMs: Math.max(5000, Math.min(120000, merged.notify.timeoutMs || 60000)),
      };
    }
  }

  return merged;
}

export { DEFAULT_CONFIG };
