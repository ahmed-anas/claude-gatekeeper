/**
 * Shared interactive prompt utilities.
 *
 * Buffers stdin lines so that multiple sequential ask() calls work
 * correctly even when input is piped (all data arrives at once).
 */

import { createInterface, Interface } from 'readline';

let rl: Interface | null = null;
const lineBuffer: string[] = [];
const waiters: ((line: string) => void)[] = [];

/** Get or create the shared readline interface. */
function ensureReadline(): Interface {
  if (!rl) {
    rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY ?? false });
    rl.on('line', (line) => {
      const waiter = waiters.shift();
      if (waiter) {
        waiter(line);
      } else {
        lineBuffer.push(line);
      }
    });
    rl.on('close', () => {
      // Resolve any pending waiters with empty string (use defaults)
      for (const waiter of waiters) waiter('');
      waiters.length = 0;
    });
  }
  return rl;
}

/** Close the shared readline interface. */
export function closePrompt(): void {
  if (rl) {
    rl.close();
    rl = null;
  }
}

/** Wait for the next line from the buffer or stdin. */
function nextLine(): Promise<string> {
  ensureReadline();
  const buffered = lineBuffer.shift();
  if (buffered !== undefined) return Promise.resolve(buffered);
  return new Promise((res) => { waiters.push(res); });
}

/** Ask a yes/no question. Returns true for yes. */
export async function ask(question: string, defaultYes = false): Promise<boolean> {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  process.stdout.write(`${question} ${hint}: `);

  const answer = await nextLine();
  const a = answer.trim().toLowerCase();
  if (a === '') return defaultYes;
  return a === 'y' || a === 'yes';
}
