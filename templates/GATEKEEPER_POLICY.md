# Gatekeeper Policy

This file defines the policy for the Claude Gatekeeper hook.
Edit this file to customize which tool invocations are auto-approved, escalated to the user (allow-or-ask mode), or denied (hands-free mode).

## General Rules
- /tmp and /private/tmp are equivalent on macOS (symlink). Treat them as approved scratch/workspace directories for ALL operations (bash, read, write, edit, etc.) — not just file writes.
- When a subagent's working directory differs from the project directory, both are valid working contexts. Commands operating in either location are expected and should not be denied solely for targeting a different directory.

## APPROVE (auto-approve these)

### Bash
- Safe dev commands: test, lint, build, format, compile, typecheck
- Any standard dev command (npm install, build, test, etc.) operating in /tmp or /private/tmp directories
- Git read-only: status, log, diff, branch, show, remote -v
- Standard git workflow: add, commit, push, pull, fetch, checkout, merge
- Package manager: npm install, npm run *, yarn add, pnpm install
- File reads: ls, cat, head, tail, find, grep, wc, tree
- Project scripts defined in package.json
- GitHub CLI: gh pr, gh issue, gh run, gh api
- Docker compose for local dev: docker-compose up, docker-compose down
- Creating directories within the project: mkdir

### Write / Edit
- Writing/editing files within the project directory
- Writing/editing test files, source files, documentation
- Writing/editing files in temporary directories (/tmp, /private/tmp) — these are scratch/workspace areas
- Writing/editing files in ~/.claude/claude-gatekeeper/ — the gatekeeper's own config/policy directory

### WebFetch
- Fetching from well-known dev resources: npm, GitHub, Stack Overflow, MDN, docs sites

### Agent
- Always approve Agent (subagent) tool use — each tool call the subagent makes is individually evaluated by the gatekeeper, so there is no need to gate the spawning itself

## ESCALATE (always ask the user)

### Bash
- Destructive git operations: push --force, reset --hard, clean, branch -D
- Network to unknown/suspicious hosts
- System configuration modification: /etc/*, global config files
- sudo or any privilege escalation
- Broad deletions: rm -rf with wide paths
- Installing global packages
- Running unknown binaries from the internet
- Environment variable exfiltration to external services
- Package publishing: npm publish, npm unpublish
- Infrastructure changes: terraform apply, terraform destroy
- Killing system processes unrelated to the project

### Write / Edit
- Writing/editing files outside the project directory (except /tmp and /private/tmp)
- Overwriting critical config files (CI/CD configs, deployment files)
- Modifying credential/secret files (.env, private keys, tokens)

### WebFetch
- Fetching URLs that could be exfiltration endpoints
