/**
 * Ordinal confidence levels for AI decisions (ordered low → high).
 * Used instead of numeric scores so the AI picks from a clear, bounded set.
 */
export const CONFIDENCE_LEVELS = ['none', 'low', 'medium', 'high', 'absolute'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

/** Returns true if `level` is at or above `threshold` in the ordinal ranking. */
export function meetsThreshold(level: ConfidenceLevel, threshold: ConfidenceLevel): boolean {
  return CONFIDENCE_LEVELS.indexOf(level) >= CONFIDENCE_LEVELS.indexOf(threshold);
}

/** JSON structure received on stdin from Claude Code's PermissionRequest hook. */
export interface HookInput {
  session_id: string;
  transcript_path?: string;
  cwd: string;
  hook_event_name: 'PermissionRequest';
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id?: string;
  permission_mode?: string;
}

/** JSON structure written to stdout for Claude Code to consume. */
export interface HookOutput {
  hookSpecificOutput: {
    hookEventName: 'PermissionRequest';
    decision: {
      behavior: 'allow';
    };
  };
}

/** AI evaluation result. */
export interface EvaluationResult {
  decision: 'approve' | 'escalate';
  confidence: ConfidenceLevel;
  reasoning: string;
  model: string;
  latencyMs: number;
}

/** Configuration for the approver. */
export interface ApproverConfig {
  enabled: boolean;
  mode: GatekeeperMode;
  backend: 'cli' | 'api';
  model: string;
  confidenceThreshold: ConfidenceLevel;
  timeoutMs: number;
  maxContextLength: number;
  logFile: string;
  logLevel: 'debug' | 'info' | 'warn';
  alwaysEscalatePatterns: string[];
  alwaysApprovePatterns: string[];
}

/** Loaded context for building the AI prompt. */
export interface PromptContext {
  userSettings: UserSettings | null;
  projectSettings: UserSettings | null;
  claudeMd: string | null;
  projectClaudeMd: string | null;
  globalApprovalPolicy: string | null;
  projectApprovalPolicy: string | null;
}

/** Subset of Claude Code settings relevant to permissions. */
export interface UserSettings {
  permissions?: {
    allow?: string[];
    deny?: string[];
    ask?: string[];
  };
  [key: string]: unknown;
}

/** Static rule check result. */
export type RuleDecision = 'approve' | 'escalate' | 'evaluate';

/** Operating modes for the gatekeeper. */
export const GATEKEEPER_MODES = ['allow-or-ask', 'hands-free'] as const;
export type GatekeeperMode = (typeof GATEKEEPER_MODES)[number];
