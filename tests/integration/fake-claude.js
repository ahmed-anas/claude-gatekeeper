#!/usr/bin/env node
/**
 * Fake Claude CLI for e2e testing.
 *
 * Mimics `claude -p --model haiku --output-format json`.
 * Behavior controlled by the FAKE_CLAUDE_BEHAVIOR env var.
 *
 * This script reads stdin (the prompt) and returns a canned JSON response,
 * allowing e2e tests to exercise the full hook pipeline without calling
 * the real Claude API.
 */

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { stdin += chunk; });
process.stdin.on('end', () => {
  const behavior = process.env.FAKE_CLAUDE_BEHAVIOR || 'error';

  const responses = {
    approve_high:     { decision: 'approve',  confidence: 'high',     reasoning: 'Standard development command' },
    approve_absolute: { decision: 'approve',  confidence: 'absolute', reasoning: 'Clearly safe operation' },
    approve_medium:   { decision: 'approve',  confidence: 'medium',   reasoning: 'Probably safe but not certain' },
    approve_low:      { decision: 'approve',  confidence: 'low',      reasoning: 'Uncertain about safety' },
    escalate_high:    { decision: 'escalate', confidence: 'high',     reasoning: 'Potentially dangerous operation' },
    escalate_absolute:{ decision: 'escalate', confidence: 'absolute', reasoning: 'Clearly dangerous' },
  };

  if (behavior === 'timeout') {
    // Hang forever — the hook's timeout will kill us
    setTimeout(() => {}, 999999);
    return;
  }

  if (behavior === 'garbage') {
    // Return text that isn't valid JSON and doesn't contain keyword triggers
    process.stdout.write('unable to process this request\n');
    return;
  }

  if (behavior === 'error') {
    process.exit(1);
  }

  const response = responses[behavior];
  if (!response) {
    process.stderr.write('Unknown FAKE_CLAUDE_BEHAVIOR: ' + behavior + '\n');
    process.exit(1);
  }

  // Mimic `claude --output-format json` wrapping: {"result": "<inner json>"}
  process.stdout.write(JSON.stringify({ result: JSON.stringify(response) }) + '\n');
});
