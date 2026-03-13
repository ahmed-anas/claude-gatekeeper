/**
 * Configuration loading and merging.
 *
 * Loads user config from ~/.config/claude-ai-approver/config.json
 * and merges it with sensible defaults. Falls back to defaults on
 * any error (missing file, invalid JSON, etc).
 *
 * User-provided alwaysEscalatePatterns are MERGED with defaults
 * (not replacing), so built-in safety patterns can't be accidentally removed.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { ApproverConfig } from './types';

const DEFAULT_CONFIG: ApproverConfig = {
  enabled: true,
  backend: 'cli',
  model: 'haiku',
  confidenceThreshold: 0.85,
  timeoutMs: 10000,
  maxContextLength: 2000,
  logFile: join(homedir(), '.config', 'claude-ai-approver', 'decisions.log'),
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

/** Resolve ~ in paths to the actual home directory. */
export function resolvePath(filePath: string): string {
  if (filePath.startsWith('~/') || filePath === '~') {
    return join(homedir(), filePath.slice(1));
  }
  return filePath;
}

/** Get the config file path. */
export function getConfigPath(): string {
  return join(homedir(), '.config', 'claude-ai-approver', 'config.json');
}

/** Load configuration, merging user overrides with defaults. */
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

/** Merge user config with defaults, validating values. */
export function mergeConfig(userConfig: Partial<ApproverConfig>): ApproverConfig {
  const merged: ApproverConfig = { ...DEFAULT_CONFIG, ...userConfig };

  // Validate and clamp values
  if (merged.confidenceThreshold < 0) merged.confidenceThreshold = 0;
  if (merged.confidenceThreshold > 1) merged.confidenceThreshold = 1;
  if (merged.timeoutMs < 1000) merged.timeoutMs = 1000;
  if (merged.timeoutMs > 60000) merged.timeoutMs = 60000;
  if (merged.maxContextLength < 0) merged.maxContextLength = 0;

  // Validate enums
  if (!['cli', 'api'].includes(merged.backend)) merged.backend = DEFAULT_CONFIG.backend;
  if (!['debug', 'info', 'warn'].includes(merged.logLevel)) merged.logLevel = DEFAULT_CONFIG.logLevel;

  // Resolve ~ in logFile path
  merged.logFile = resolvePath(merged.logFile);

  // Merge pattern arrays (user additions + defaults)
  if (userConfig.alwaysEscalatePatterns) {
    merged.alwaysEscalatePatterns = [
      ...DEFAULT_CONFIG.alwaysEscalatePatterns,
      ...userConfig.alwaysEscalatePatterns.filter(
        (p) => !DEFAULT_CONFIG.alwaysEscalatePatterns.includes(p)
      ),
    ];
  }

  return merged;
}

export { DEFAULT_CONFIG };
