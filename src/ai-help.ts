/**
 * AI-assisted help command.
 *
 * Launches an interactive Claude Code session with full context about
 * the gatekeeper's commands, current configuration, and system state.
 * The AI can run gatekeeper commands, read logs, and guide the user.
 */

import { spawnSync, execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { loadConfig, getConfigPath } from './config';
import { getStatusText } from './status';
import { readJson, writeJson } from './fs-utils';
import { ask, closePrompt } from './cli-prompt';

/** Package version, read from package.json at build time. */
function getVersion(): string {
  try {
    const pkgPath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Build the system prompt with full gatekeeper context. */
function buildSystemPrompt(): string {
  const config = loadConfig();
  const configPath = getConfigPath();
  const version = getVersion();
  const home = homedir();
  const policyDir = join(home, '.claude', 'claude-gatekeeper');
  const globalPolicyPath = join(policyDir, 'GATEKEEPER_POLICY.md');
  const readmeUrl = `https://github.com/ahmed-anas/claude-gatekeeper/blob/v${version}/README.md`;

  const statusText = getStatusText();

  const sections: string[] = [];

  sections.push(`You are an AI assistant helping the user manage their Claude Gatekeeper installation (v${version}).
You have full context about the tool and can run commands on the user's behalf.
Be concise and helpful. When the user asks you to do something (enable, disable, change mode, etc.), just do it using the CLI commands listed below.`);

  // Current status
  sections.push(`## Current Status

${statusText}`);

  // Available commands
  sections.push(`## Available CLI Commands

All commands are run as \`claude-gatekeeper <command>\`.

| Command | Description |
|---------|-------------|
| \`setup\` | Register hooks in Claude Code and configure settings (interactive wizard) |
| \`status\` | Show current installation and configuration |
| \`mode\` | Show current operating mode and available modes |
| \`mode allow-or-ask\` | Switch to allow-or-ask mode |
| \`mode hands-free\` | Switch to hands-free mode |
| \`enable\` | Enable the gatekeeper |
| \`disable\` | Disable the gatekeeper (hooks stay registered, all requests escalate) |
| \`notify setup\` | Interactive setup wizard for ntfy.sh push notifications |
| \`notify test\` | Send a test push notification |
| \`notify disable\` | Remove notification configuration |
| \`uninstall\` | Remove hooks and optionally delete config/logs |

You can run these commands directly using Bash. For example, to enable: \`claude-gatekeeper enable\`.
For interactive commands like \`setup\` and \`notify setup\`, tell the user to run them manually since they require interactive input.`);

  // Mode explanations
  sections.push(`## Operating Modes

### allow-or-ask (default, supervised)
- Safe commands are auto-approved by AI
- Uncertain commands: the permission prompt appears for the user
- If ntfy notifications are configured, a push notification is sent first and the hook waits for a remote approve/deny
- AI never auto-denies in this mode — the user always has final say
- Errors always escalate (fail-safe)

### hands-free (fully autonomous)
- Safe commands are auto-approved by AI
- Dangerous or uncertain commands are denied with a reason sent back to Claude
- Claude receives the denial reason and can adjust its approach
- No user interaction — designed for when the user is away
- Errors cause a deny (fail-closed)`);

  // Notifications
  sections.push(`## Push Notifications (ntfy.sh)

${config.notify?.topic
    ? `Notifications are **enabled** using topic \`${config.notify.topic}\` on server \`${config.notify.server || 'https://ntfy.sh'}\`.
When the gatekeeper escalates a request in allow-or-ask mode, a push notification is sent to the user's phone with Approve/Deny buttons. The hook waits up to ${(config.notify.timeoutMs || 60000) / 1000}s for a response.`
    : `Notifications are **not configured**. To set up push notifications, the user should run \`claude-gatekeeper notify setup\`.
ntfy.sh sends push notifications to the user's phone with Approve/Deny action buttons when the gatekeeper needs a decision.`}`);

  // Config and files
  sections.push(`## Configuration and Files

| Path | Description |
|------|-------------|
| \`${configPath}\` | Main configuration file (JSON) |
| \`${globalPolicyPath}\` | Global approval policy (Markdown rules the AI follows when evaluating commands)${existsSync(globalPolicyPath) ? '' : ' — NOT FOUND'} |
| \`${config.logFile}\` | Decision audit log (one line per decision, includes tool, command, confidence, reasoning) |
| \`~/.claude/settings.json\` | Claude Code settings where hooks are registered |

The GATEKEEPER_POLICY.md file contains rules that guide the AI when deciding whether to approve or escalate commands. It is NOT the same as CLAUDE.md. Users can customize it to match their workflow. A project-level policy can also be placed at \`<project>/GATEKEEPER_POLICY.md\` or \`<project>/.claude/GATEKEEPER_POLICY.md\`.

### Reading the decision log

The log file at \`${config.logFile}\` contains one line per decision. Each line includes timestamp, decision (approve/escalate/deny), confidence level, tool name, input summary, and AI reasoning. You can read this file to answer questions about recent approvals, denials, or escalations.`);

  // Config fields
  sections.push(`## Config Fields (config.json)

| Field | Current Value | Description |
|-------|--------------|-------------|
| \`enabled\` | \`${config.enabled}\` | Master on/off switch |
| \`mode\` | \`${config.mode}\` | Operating mode: allow-or-ask or hands-free |
| \`backend\` | \`${config.backend}\` | AI backend: cli (uses \`claude -p\`) or api (Anthropic SDK) |
| \`model\` | \`${config.model}\` | Model used for evaluations |
| \`confidenceThreshold\` | \`${config.confidenceThreshold}\` | Minimum confidence to auto-approve (none/low/medium/high/absolute) |
| \`timeoutMs\` | \`${config.timeoutMs}\` | Max milliseconds for AI evaluation |
| \`logLevel\` | \`${config.logLevel}\` | Log verbosity: debug, info, or warn |
| \`logFile\` | \`${config.logFile}\` | Path to decision audit log |`);

  // Documentation link
  sections.push(`## Documentation

Full documentation: ${readmeUrl}
npm package: https://www.npmjs.com/package/claude-gatekeeper`);

  return sections.join('\n\n');
}

/** Check that the claude CLI is available. */
function checkClaudeCli(): boolean {
  try {
    execSync('which claude', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** Show consent prompt for first-time users. Returns true if user consents. */
async function ensureConsent(): Promise<boolean> {
  const config = loadConfig();
  if (config.aiHelpAcknowledged) return true;

  console.log('\n  This will start an interactive Claude Code session to help you');
  console.log('  manage claude-gatekeeper. Claude will have context about your');
  console.log('  current setup, available commands, and configuration.\n');
  console.log('  It can run gatekeeper commands, read your decision log, and');
  console.log('  guide you through setup and configuration.\n');
  console.log('  Requires the `claude` CLI to be installed and configured.\n');

  const ok = await ask('  Continue?', true);
  closePrompt();

  if (!ok) return false;

  // Persist acknowledgement
  const configPath = getConfigPath();
  const existing = existsSync(configPath) ? readJson(configPath) ?? {} : {};
  existing.aiHelpAcknowledged = true;
  writeJson(configPath, existing);

  return true;
}

/** Launch the interactive Claude session. */
function launchClaude(systemPrompt: string): void {
  const result = spawnSync('claude', ['--system-prompt', systemPrompt], {
    stdio: 'inherit',
    env: { ...process.env },
  });

  if (result.error) {
    console.error(`\nFailed to launch claude: ${result.error.message}`);
    console.error('Make sure the `claude` CLI is installed and on your PATH.\n');
    process.exit(1);
  }

  process.exit(result.status ?? 0);
}

/** Main entry point for the ai help command. */
export async function aiHelp(): Promise<void> {
  if (!checkClaudeCli()) {
    console.error('\n  The `claude` CLI is not installed or not on your PATH.');
    console.error('  Install it from: https://docs.anthropic.com/en/docs/claude-code\n');
    process.exit(1);
  }

  const consented = await ensureConsent();
  if (!consented) {
    console.log('\n  Cancelled.\n');
    return;
  }

  const systemPrompt = buildSystemPrompt();
  launchClaude(systemPrompt);
}
