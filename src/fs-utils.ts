import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

/** Read and parse a JSON file, returning null on failure. */
export function readJson(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/** Write a JSON file, creating directories as needed. */
export function writeJson(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}
