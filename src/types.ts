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
  confidence: number;
  reasoning: string;
  model: string;
  latencyMs: number;
}

/** Configuration for the approver. */
export interface ApproverConfig {
  enabled: boolean;
  backend: 'cli' | 'api';
  model: string;
  confidenceThreshold: number;
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
  approvalPolicy: string | null;
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
