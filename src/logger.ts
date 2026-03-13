/**
 * Audit logging for hook decisions.
 *
 * Every decision (approve, escalate, error) is logged to a file with
 * timestamp, tool info, confidence, reasoning, and latency. This provides
 * a complete audit trail for reviewing what was auto-approved.
 *
 * Key safety invariant: logging failures are silently swallowed.
 * A broken log file must never prevent the hook from functioning.
 */

import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { ApproverConfig, EvaluationResult, HookInput } from './types';

/** Ensure the parent directory of a file exists. */
function ensureDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

/** Get ISO timestamp. */
function timestamp(): string {
  return new Date().toISOString();
}

/** Summarize tool input for log line. */
function summarizeInput(input: HookInput): string {
  if (input.tool_name === 'Bash') {
    const cmd = String(input.tool_input.command || '');
    return cmd.length > 120 ? cmd.slice(0, 117) + '...' : cmd;
  }
  if (input.tool_name === 'Edit' || input.tool_name === 'Write') {
    return String(input.tool_input.file_path || '');
  }
  if (input.tool_name === 'WebFetch') {
    return String(input.tool_input.url || '');
  }
  return JSON.stringify(input.tool_input).slice(0, 120);
}

/** Log a decision to the audit file. */
export function logDecision(
  input: HookInput,
  result: EvaluationResult,
  config: ApproverConfig
): void {
  if (config.logLevel === 'warn') return;

  try {
    ensureDir(config.logFile);
    const summary = summarizeInput(input);
    const line = `[${timestamp()}] decision=${result.decision} confidence=${result.confidence} model=${result.model} latency=${result.latencyMs}ms tool=${input.tool_name} input="${summary}" reasoning="${result.reasoning}"\n`;
    appendFileSync(config.logFile, line);
  } catch {
    // Never break the hook if logging fails
  }
}

/** Log a warning message. */
export function logWarning(message: string, config: ApproverConfig): void {
  try {
    ensureDir(config.logFile);
    const line = `[${timestamp()}] WARN ${message}\n`;
    appendFileSync(config.logFile, line);
  } catch {
    // Never break the hook if logging fails
  }
}

/** Log an error. */
export function logError(
  input: HookInput | null,
  error: unknown,
  config: ApproverConfig
): void {
  try {
    ensureDir(config.logFile);
    const errMsg = error instanceof Error ? error.message : String(error);
    const tool = input ? `tool=${input.tool_name} ` : '';
    const line = `[${timestamp()}] ERROR ${tool}error="${errMsg}"\n`;
    appendFileSync(config.logFile, line);
  } catch {
    // Never break the hook if logging fails
  }
}

/** Log debug information (only when logLevel is 'debug'). */
export function logDebug(message: string, config: ApproverConfig): void {
  if (config.logLevel !== 'debug') return;

  try {
    ensureDir(config.logFile);
    const line = `[${timestamp()}] DEBUG ${message}\n`;
    appendFileSync(config.logFile, line);
  } catch {
    // Never break the hook if logging fails
  }
}
