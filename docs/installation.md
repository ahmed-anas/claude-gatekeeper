# Installation

## Prerequisites

- Node.js 18+
- Claude Code installed and authenticated
- (Optional) `ANTHROPIC_API_KEY` for the faster API backend

## Step 1: Build

```bash
cd /path/to/claude-ai-approver
nvm exec npm install
nvm exec npm run build
```

This compiles TypeScript to JavaScript in the `dist/` directory.

## Step 2: Register the Hook

Add the PermissionRequest hook to your `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "/absolute/path/to/claude-ai-approver/bin/ai-approver",
            "timeout": 15000
          }
        ]
      }
    ]
  }
}
```

**Important:**
- Use the **absolute path** to the `bin/ai-approver` script
- The empty `matcher` (`""`) matches all tools — the hook fires for every permission prompt
- The `timeout` of 15000ms (15s) gives the AI enough time to evaluate. If it times out, the normal prompt appears.

If you already have a `hooks` section, merge the `PermissionRequest` key into it.

### Example: Merging with existing hooks

Before:
```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "permission_prompt",
        "hooks": [{"type": "command", "command": "afplay /System/Library/Sounds/Glass.aiff &"}]
      }
    ]
  }
}
```

After:
```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "permission_prompt",
        "hooks": [{"type": "command", "command": "afplay /System/Library/Sounds/Glass.aiff &"}]
      }
    ],
    "PermissionRequest": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "/absolute/path/to/claude-ai-approver/bin/ai-approver",
            "timeout": 15000
          }
        ]
      }
    ]
  }
}
```

## Step 3: (Optional) Create Approval Policy

Copy the template to your project:

```bash
cp /path/to/claude-ai-approver/templates/APPROVAL_POLICY.md ./APPROVAL_POLICY.md
```

Edit it to match your project's specific needs.

## Step 4: (Optional) Custom Configuration

Create `~/.config/claude-ai-approver/config.json`:

```bash
mkdir -p ~/.config/claude-ai-approver
cat > ~/.config/claude-ai-approver/config.json << 'EOF'
{
  "confidenceThreshold": 0.85,
  "logLevel": "info"
}
EOF
```

See [configuration.md](configuration.md) for all options.

## Step 5: Verify

Start a new Claude Code session and trigger a command that would normally prompt you. Check the audit log:

```bash
cat ~/.config/claude-ai-approver/decisions.log
```

You should see decision entries with timestamps, confidence scores, and reasoning.

## Uninstalling

1. Remove the `PermissionRequest` hook from `~/.claude/settings.json`
2. (Optional) Delete the config and log files:
   ```bash
   rm -rf ~/.config/claude-ai-approver
   ```

## Troubleshooting

### Hook doesn't seem to be running
- Verify the path in `~/.claude/settings.json` is correct and absolute
- Check that `bin/ai-approver` is executable: `chmod +x bin/ai-approver`
- Restart Claude Code (hooks are loaded at session start)

### Everything is escalating (nothing auto-approved)
- Check the log file for errors: `tail ~/.config/claude-ai-approver/decisions.log`
- If using CLI backend: ensure `claude` is in your PATH
- If using API backend: ensure `ANTHROPIC_API_KEY` is set
- Try lowering `confidenceThreshold` to `0.7`

### Auto-approvals are too aggressive
- Raise `confidenceThreshold` to `0.95`
- Add patterns to `alwaysEscalatePatterns` in config
- Make your `APPROVAL_POLICY.md` more restrictive
