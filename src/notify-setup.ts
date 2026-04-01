/**
 * Interactive notification setup wizard.
 */

import { randomBytes } from 'crypto';
import { existsSync } from 'fs';
import { ask, closePrompt } from './cli-prompt';
import { getConfigPath } from './config';
import { readJson, writeJson } from './fs-utils';
import { sendTestNotification, sendTestApproval } from './notify';

function generateTopic(): string {
  return 'gk-' + randomBytes(8).toString('hex');
}

export async function notifySetup(): Promise<void> {
  console.log('\nNotification Setup');
  console.log('==================\n');

  console.log('Step 1: Install the ntfy app on your phone');
  console.log('  iOS:     https://apps.apple.com/us/app/ntfy/id1625396347');
  console.log('  Android: https://play.google.com/store/apps/details?id=io.heckel.ntfy');
  console.log('  Web:     https://ntfy.sh (use browser notifications)\n');

  const hasApp = await ask('Have you installed the app?');
  if (!hasApp) {
    console.log('\n  Install the app and re-run `claude-gatekeeper notify setup`.\n');
    closePrompt();
    return;
  }

  const topic = generateTopic();
  console.log('\nStep 2: Subscribe to this topic in the ntfy app');
  console.log(`  Topic: ${topic}`);
  console.log('\n  Open the ntfy app -> tap "+" -> enter the topic name exactly as shown above.\n');

  const subscribed = await ask('Have you subscribed to the topic?');
  if (!subscribed) {
    console.log('\n  Subscribe to the topic and re-run `claude-gatekeeper notify setup`.\n');
    closePrompt();
    return;
  }

  console.log('\nStep 3: Sending test notification...');
  const sent = await sendTestNotification(topic, 'https://ntfy.sh');
  if (!sent) {
    console.error('  [error] Failed to send notification. Check your internet connection.\n');
    closePrompt();
    return;
  }
  console.log('  [ok] Notification sent! Check your phone.\n');

  const received = await ask('Did you receive the notification?');
  if (!received) {
    console.log('\n  Troubleshooting:');
    console.log('  - Make sure you subscribed to the exact topic: ' + topic);
    console.log('  - Check that notifications are enabled for the ntfy app');
    console.log('  - Try again with `claude-gatekeeper notify setup`\n');
    closePrompt();
    return;
  }

  console.log('\nStep 4: Testing approve/deny buttons...');
  console.log('  A test approval request was sent to your phone.');
  console.log('  Please tap "Approve" on the notification.\n');

  process.stdout.write('  Waiting for response...');
  const response = await sendTestApproval(topic, 'https://ntfy.sh', 60000);

  if (response === 'approve') {
    console.log(' [ok] Received: approve\n');
  } else if (response === 'deny') {
    console.log(' [ok] Received: deny (buttons work!)\n');
  } else {
    console.log(' [timeout]\n');
    console.log('  Could not receive a response. Possible causes:');
    console.log('  - The ntfy app may not support action buttons on your device');
    console.log('  - Try tapping the button again');
    console.log('  - Notifications will still work (one-way), but remote approval won\'t.\n');
    const continueAnyway = await ask('Save the config anyway?');
    if (!continueAnyway) {
      closePrompt();
      return;
    }
  }

  const configPath = getConfigPath();
  const existing = existsSync(configPath) ? readJson(configPath) ?? {} : {};
  (existing as Record<string, unknown>).notify = {
    topic,
    server: 'https://ntfy.sh',
    timeoutMs: 60000,
  };
  writeJson(configPath, existing);

  console.log('  [ok] Config saved to ' + configPath);
  closePrompt();
  console.log('\n---');
  console.log('Setup complete! Notifications are configured.');
  console.log('Test anytime with: claude-gatekeeper notify test');
  console.log('Disable with: claude-gatekeeper notify disable\n');
}
