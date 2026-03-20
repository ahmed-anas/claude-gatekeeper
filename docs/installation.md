# Installation

## Prerequisites

- Node.js 18+
- Claude Code installed and authenticated
- (Optional) `ANTHROPIC_API_KEY` for the faster API backend

## Step 1: Build

```bash
cd /path/to/claude-gatekeeper
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
            "command": "/absolute/path/to/claude-gatekeeper/bin/gatekeeper",
            "timeout": 60000
          }
        ]
      }
    ]
  }
}
```

**Important:**
- Use the **absolute path** to the `bin/gatekeeper` script
- The empty `matcher` (`""`) matches all tools — the hook fires for every permission prompt
- The `timeout` of 60000ms (60s) gives the AI enough time to evaluate. If it times out, the normal prompt appears.

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
            "command": "/absolute/path/to/claude-gatekeeper/bin/gatekeeper",
            "timeout": 60000
          }
        ]
      }
    ]
  }
}
```

## Step 3: (Optional) Create Gatekeeper Policy

Copy the template to your project:

```bash
cp /path/to/claude-gatekeeper/templates/GATEKEEPER_POLICY.md ./GATEKEEPER_POLICY.md
```

Edit it to match your project's specific needs.

## Step 4: (Optional) Custom Configuration

Create `~/.claude/claude-gatekeeper/config.json`:

```bash
mkdir -p ~/.claude/claude-gatekeeper
cat > ~/.claude/claude-gatekeeper/config.json << 'EOF'
{
  "confidenceThreshold": "high",
  "logLevel": "info"
}
EOF
```

See [configuration.md](configuration.md) for all options.

## Step 5: Verify

Start a new Claude Code session and trigger a command that would normally prompt you. Check the audit log:

```bash
cat ~/.claude/claude-gatekeeper/decisions.log
```

You should see decision entries with timestamps, confidence scores, and reasoning.

## Uninstalling

1. Remove the `PermissionRequest` hook from `~/.claude/settings.json`
2. (Optional) Delete the config and log files:
   ```bash
   rm -rf ~/.claude/claude-gatekeeper
   ```

## Troubleshooting

### Hook doesn't seem to be running
- Verify the path in `~/.claude/settings.json` is correct and absolute
- Check that `bin/gatekeeper` is executable: `chmod +x bin/gatekeeper`
- Restart Claude Code (hooks are loaded at session start)

### Everything is escalating (nothing auto-approved)
- Check the log file for errors: `tail ~/.claude/claude-gatekeeper/decisions.log`
- If using CLI backend: ensure `claude` is in your PATH
- If using API backend: ensure `ANTHROPIC_API_KEY` is set
- Try lowering `confidenceThreshold` to `"medium"`

### Auto-approvals are too aggressive
- Raise `confidenceThreshold` to `"absolute"`
- Add patterns to `alwaysEscalatePatterns` in config
- Make your `GATEKEEPER_POLICY.md` more restrictive
