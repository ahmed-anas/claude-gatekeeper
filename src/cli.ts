#!/usr/bin/env node

/**
 * CLI entry point for Claude Gatekeeper.
 *
 * Subcommands:
 *   setup   — Interactive setup wizard (register hook, create config)
 *   status  — Show current installation status
 *   (none)  — Run as a PermissionRequest hook (reads stdin)
 */

import { Command } from 'commander';
import { main as runHook } from './index';
import { setup } from './setup';
import { status } from './status';
import { uninstall } from './uninstall';

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
  .command('hook', { hidden: true, isDefault: true })
  .description('Run as a PermissionRequest hook (reads stdin)')
  .action(async () => {
    await runHook();
  });

program.parse();
