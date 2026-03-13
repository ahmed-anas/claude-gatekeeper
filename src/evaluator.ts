/**
 * AI evaluation backends.
 *
 * Two backends are supported:
 *
 * 1. CLI backend (default): Spawns `claude -p --model haiku` as a subprocess.
 *    Piggybacks on the user's existing Claude Code OAuth authentication.
 *    No API key needed. Slower (~2-5s) due to CLI startup overhead.
 *
 * 2. API backend (optional): Uses @anthropic-ai/sdk directly with
 *    ANTHROPIC_API_KEY. Faster (~0.5-2s) but requires explicit API key.
 *    The SDK is lazy-imported to avoid loading it when not needed.
 *
 * Both backends parse the AI response (JSON with decision/confidence/reasoning),
 * handle timeouts via AbortController/kill, and fall back to escalation on
 * any error. The evaluate() function routes to the correct backend based
 * on config and API key availability.
 */

import { spawn } from 'child_process';
import { ApproverConfig, EvaluationResult } from './types';

/** Parse a decision from AI response text. */
export function parseAiResponse(text: string): Pick<EvaluationResult, 'decision' | 'confidence' | 'reasoning'> {
  // Try to extract a JSON object with a "decision" field
  const jsonMatch = text.match(/\{[\s\S]*?"decision"[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.decision === 'approve' || parsed.decision === 'escalate') {
        return {
          decision: parsed.decision,
          confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
          reasoning: String(parsed.reasoning || 'No reasoning provided'),
        };
      }
    } catch {
      // Malformed JSON — fall through
    }
  }

  // Fallback: keyword matching
  const lower = text.toLowerCase();
  if (lower.includes('approve') && !lower.includes('escalate')) {
    return { decision: 'approve', confidence: 0.5, reasoning: text.slice(0, 200) };
  }

  // Default to escalate (safe fallback)
  return { decision: 'escalate', confidence: 0.5, reasoning: text.slice(0, 200) };
}

/** Evaluate using `claude -p` CLI (default backend, no API key needed). */
export async function evaluateWithCli(
  systemPrompt: string,
  userMessage: string,
  config: ApproverConfig
): Promise<EvaluationResult> {
  const startTime = Date.now();
  const fullPrompt = `${systemPrompt}\n\n---\n\n${userMessage}`;

  return new Promise((resolve) => {
    const proc = spawn('claude', ['-p', '--model', config.model, '--output-format', 'json'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDECODE: '' },
      timeout: config.timeoutMs,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    // Set up a timeout
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({
        decision: 'escalate',
        confidence: 0,
        reasoning: 'AI evaluation timed out',
        model: `cli:${config.model}`,
        latencyMs: Date.now() - startTime,
      });
    }, config.timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      const latencyMs = Date.now() - startTime;

      if (code !== 0) {
        resolve({
          decision: 'escalate',
          confidence: 0,
          reasoning: `CLI exited with code ${code}: ${stderr.slice(0, 200)}`,
          model: `cli:${config.model}`,
          latencyMs,
        });
        return;
      }

      try {
        // claude --output-format json returns {"result": "...", ...}
        const jsonOut = JSON.parse(stdout);
        const responseText = String(jsonOut.result ?? jsonOut.text ?? stdout);
        const parsed = parseAiResponse(responseText);
        resolve({ ...parsed, model: `cli:${config.model}`, latencyMs });
      } catch {
        // Try parsing stdout directly as AI response
        const parsed = parseAiResponse(stdout);
        resolve({ ...parsed, model: `cli:${config.model}`, latencyMs });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        decision: 'escalate',
        confidence: 0,
        reasoning: `CLI spawn error: ${err.message}`,
        model: `cli:${config.model}`,
        latencyMs: Date.now() - startTime,
      });
    });

    // Write prompt to stdin and close
    proc.stdin.write(fullPrompt);
    proc.stdin.end();
  });
}

/** Evaluate using direct Anthropic API (faster, requires ANTHROPIC_API_KEY). */
export async function evaluateWithApi(
  systemPrompt: string,
  userMessage: string,
  config: ApproverConfig
): Promise<EvaluationResult> {
  const startTime = Date.now();

  try {
    // Lazy import to avoid loading SDK when not needed
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    const response = await client.messages.create(
      {
        model: config.model === 'haiku' ? 'claude-haiku-4-5-20251001' : config.model,
        max_tokens: 256,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      },
      { signal: controller.signal }
    );

    clearTimeout(timer);

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => ('text' in block ? block.text : ''))
      .join('');

    const parsed = parseAiResponse(text);
    return { ...parsed, model: `api:${config.model}`, latencyMs: Date.now() - startTime };
  } catch (err) {
    return {
      decision: 'escalate',
      confidence: 0,
      reasoning: `API error: ${err instanceof Error ? err.message : String(err)}`,
      model: `api:${config.model}`,
      latencyMs: Date.now() - startTime,
    };
  }
}

/** Evaluate a permission request using the configured backend. */
export async function evaluate(
  systemPrompt: string,
  userMessage: string,
  config: ApproverConfig
): Promise<EvaluationResult> {
  if (config.backend === 'api') {
    if (!process.env.ANTHROPIC_API_KEY) {
      // Fallback to CLI if API key is not set
      return evaluateWithCli(systemPrompt, userMessage, config);
    }
    return evaluateWithApi(systemPrompt, userMessage, config);
  }
  return evaluateWithCli(systemPrompt, userMessage, config);
}
