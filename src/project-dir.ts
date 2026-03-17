/**
 * Extracts the real project directory from a Claude Code hook payload.
 *
 * Claude Code subagents sometimes report `/private/tmp` as the cwd,
 * which is wrong. The `transcript_path` field reliably contains the
 * real project directory encoded as a folder name under ~/.claude/projects/.
 *
 * Encoding algorithm (from Claude Code's minified cli.js, function `bD`):
 *   1. Replace all non-alphanumeric chars with "-"
 *   2. If short enough, use as-is
 *   3. If too long, truncate and append a hash
 *
 * Reference: @anthropic-ai/claude-code cli.js (minified), function `bD`:
 *   function bD(A) {
 *     let q = A.replace(/[^a-zA-Z0-9]/g, "-");
 *     if (q.length <= pHA) return q;
 *     let K = typeof Bun < "u" ? Bun.hash(A).toString(36) : Q2K(A);
 *     return `${q.slice(0, pHA)}-${K}`;
 *   }
 *
 * Since the encoding is lossy (both "/" and "-" become "-"), decoding
 * uses a greedy filesystem walk: at each "-", try "/" first, and if the
 * resulting path exists as a directory, use "/". Otherwise keep "-".
 */

import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { HookInput } from './types';

/**
 * Replicate Claude Code's encoding: replace all non-alphanumeric chars with "-".
 * Used to verify our decoding by re-encoding and comparing.
 */
export function encodeProjectPath(absolutePath: string): string {
  return absolutePath.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Decode a project slug back to a filesystem path using greedy directory walking.
 *
 * At each "-", tries "/" first. If the resulting partial path exists as a
 * directory, uses "/". Otherwise keeps "-" as a literal character.
 *
 * Returns null if decoding fails (no valid path found).
 */
export function decodeProjectSlug(slug: string): string | null {
  // The slug starts with "-" because absolute paths start with "/"
  if (!slug.startsWith('-')) return null;

  const segments = slug.split('-').filter(Boolean);
  if (segments.length === 0) return null;

  // Build path greedily from left to right
  let currentPath = '';
  let pending = '';

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];

    if (pending) {
      // Try as directory separator first: /currentPath/pending/segment
      const withSlash = currentPath + '/' + pending;
      if (isDirectory(withSlash)) {
        currentPath = withSlash;
        pending = segment;
      } else {
        // Keep the "-" as literal
        pending = pending + '-' + segment;
      }
    } else {
      pending = segment;
    }
  }

  // Append the final pending segment
  if (pending) {
    const finalPath = currentPath + '/' + pending;
    if (isDirectory(finalPath)) {
      return finalPath;
    }
    // Try keeping it attached to current path
    return currentPath ? currentPath + '/' + pending : null;
  }

  return currentPath || null;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Extract the project slug from a transcript_path.
 *
 * transcript_path format: ~/.claude/projects/<slug>/<session-id>.jsonl
 * Returns the slug portion, or null if the path doesn't match.
 */
export function extractSlugFromTranscriptPath(transcriptPath: string): string | null {
  const projectsDir = join(homedir(), '.claude', 'projects');
  if (!transcriptPath.startsWith(projectsDir)) return null;

  // Get the part after "~/.claude/projects/"
  const remainder = transcriptPath.slice(projectsDir.length + 1);
  // The slug is everything before the first "/"
  const slashIndex = remainder.indexOf('/');
  if (slashIndex < 0) return null;

  return remainder.slice(0, slashIndex);
}

/**
 * Resolve the real project directory from a hook input.
 *
 * Priority:
 *   1. Decode from transcript_path (reliable even for subagents)
 *   2. Fall back to cwd from the hook input
 */
export function resolveProjectDir(input: HookInput): string {
  if (input.transcript_path) {
    const slug = extractSlugFromTranscriptPath(input.transcript_path);
    if (slug) {
      const decoded = decodeProjectSlug(slug);
      if (decoded && isDirectory(decoded)) {
        return decoded;
      }
    }
  }

  return input.cwd;
}
