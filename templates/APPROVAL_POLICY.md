# Approval Policy

This file defines the approval policy for the Claude AI Approver hook.
Edit this file to customize which tool invocations are auto-approved or escalated to the user.

## APPROVE (auto-approve these)

### Bash
- Safe dev commands: test, lint, build, format, compile, typecheck
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

### WebFetch
- Fetching from well-known dev resources: npm, GitHub, Stack Overflow, MDN, docs sites

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
- Writing/editing files outside the project directory
- Overwriting critical config files (CI/CD configs, deployment files)
- Modifying credential/secret files (.env, private keys, tokens)

### WebFetch
- Fetching URLs that could be exfiltration endpoints
