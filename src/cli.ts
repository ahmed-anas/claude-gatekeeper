#!/usr/bin/env node

/**
 * CLI entry point for Claude Gatekeeper.
 *
 * Subcommands:
 *   setup   — Interactive setup wizard (register hook, create config)
 *   status  — Show current installation status
 *   (none)  — Run as a PermissionRequest hook (reads stdin)
 */

import { existsSync } from 'fs';
import { Command } from 'commander';
import { main as runHook } from './index';
import { setup } from './setup';
import { status } from './status';
import { uninstall } from './uninstall';
import { setMode } from './mode';
import { setEnabled } from './enable';
import { notifySetup } from './notify-setup';
import { sendTestNotification } from './notify';
import { loadConfig, getConfigPath } from './config';
import { readJson, writeJson } from './fs-utils';

const program = new Command();

program
  .name('claude-gatekeeper')
  .description('Claude Code hook that uses AI to auto-approve safe permission requests')
  .version('1.0.0');

program
  .command('setup')
  .description('Register the hook in Claude Code and configure settings')
  .action(async () => {
    try {
      await setup();
    } catch (err) {
      console.error(`Setup failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show current installation and configuration status')
  .action(() => {
    try {
      status();
    } catch (err) {
      console.error(`Status check failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command('uninstall')
  .description('Remove the hook and optionally delete config/logs')
  .action(async () => {
    try {
      await uninstall();
    } catch (err) {
      console.error(`Uninstall failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command('mode [mode-name]')
  .description('View or switch operating mode (allow-or-ask, hands-free)')
  .action((modeName?: string) => {
    try {
      setMode(modeName);
    } catch (err) {
      console.error(`Mode change failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command('enable')
  .description('Enable the gatekeeper')
  .action(() => {
    try {
      setEnabled(true);
    } catch (err) {
      console.error(`Enable failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command('disable')
  .description('Disable the gatekeeper (hooks remain registered but escalate all requests)')
  .action(() => {
    try {
      setEnabled(false);
    } catch (err) {
      console.error(`Disable failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

const notify = program
  .command('notify')
  .description('Manage push notifications for remote approval');

notify
  .command('setup')
  .description('Interactive setup wizard for push notifications')
  .action(async () => {
    try {
      await notifySetup();
    } catch (err) {
      console.error(`Notify setup failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

notify
  .command('test')
  .description('Send a test notification to verify your setup')
  .action(async () => {
    try {
      const config = loadConfig();
      if (!config.notify?.topic) {
        console.error('\nNotifications are not configured. Run `claude-gatekeeper notify setup` first.\n');
        process.exit(1);
      }
      const server = config.notify.server || 'https://ntfy.sh';
      console.log(`\nSending test notification to ${server}/${config.notify.topic}...`);
      const sent = await sendTestNotification(config.notify.topic, server);
      if (sent) {
        console.log('  [ok] Notification sent! Check your phone.\n');
      } else {
        console.error('  [error] Failed to send notification.\n');
        process.exit(1);
      }
    } catch (err) {
      console.error(`Notify test failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

notify
  .command('disable')
  .description('Remove notification configuration')
  .action(() => {
    try {
      const configPath = getConfigPath();
      if (!existsSync(configPath)) {
        console.log('\nNotifications are not configured.\n');
        return;
      }
      const existing = readJson(configPath) ?? {};
      delete (existing as Record<string, unknown>).notify;
      writeJson(configPath, existing);
      console.log('\nNotifications disabled. Config updated.\n');
    } catch (err) {
      console.error(`Notify disable failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command('hook', { hidden: true, isDefault: true })
  .description('Run as a PermissionRequest hook (reads stdin)')
  .action(async () => {
    await runHook();
  });

program.parse();
