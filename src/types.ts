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

/** JSON structure received on stdin from Claude Code hooks. */
export interface HookInput {
  session_id: string;
  session_name?: string;  // Available once Anthropic ships #17188
  transcript_path?: string;
  cwd: string;
  hook_event_name: 'PermissionRequest' | 'PreToolUse';
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id?: string;
  permission_mode?: string;
}

/** PermissionRequest output — approve only. */
export interface PermissionRequestOutput {
  hookSpecificOutput: {
    hookEventName: 'PermissionRequest';
    decision: {
      behavior: 'allow';
    };
  };
}

/** PreToolUse output — approve or deny with reason. */
export interface PreToolUseOutput {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse';
    permissionDecision: 'allow' | 'deny';
    permissionDecisionReason?: string;
  };
}

/** AI evaluation result. */
export interface EvaluationResult {
  decision: 'approve' | 'escalate' | 'deny';
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
  notify?: NotifyConfig;
}

/** Configuration for ntfy.sh push notifications (optional). */
export interface NotifyConfig {
  /** ntfy topic name — presence activates notifications. */
  topic: string;
  /** ntfy server URL. Default: "https://ntfy.sh" */
  server?: string;
  /** How long to wait for phone response in ms. Default: 60000 */
  timeoutMs?: number;
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
export type RuleDecision = 'approve' | 'escalate' | 'deny' | 'evaluate';

/** Operating modes for the gatekeeper. */
export const GATEKEEPER_MODES = ['allow-or-ask', 'hands-free'] as const;
export type GatekeeperMode = (typeof GATEKEEPER_MODES)[number];
