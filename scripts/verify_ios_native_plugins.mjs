import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const configPath = resolve('ios/App/App/capacitor.config.json');
const requiredPluginClasses = [
  'MediaPlugin',
  'AppPlugin',
  'CAPCameraPlugin',
  'ClipboardPlugin',
  'HapticsPlugin',
  'KeyboardPlugin',
  'LocalNotificationsPlugin',
  'PushNotificationsPlugin'
];

const config = JSON.parse(await readFile(configPath, 'utf8'));
const registeredPluginClasses = Array.isArray(config.packageClassList)
  ? new Set(config.packageClassList)
  : new Set();
const missingPluginClasses = requiredPluginClasses.filter(
  (pluginClass) => !registeredPluginClasses.has(pluginClass)
);

if (missingPluginClasses.length > 0) {
  throw new Error(
    `iOS native plugin registry is incomplete: ${missingPluginClasses.join(', ')}. `
      + 'Run `npx cap copy ios` to regenerate it before building or archiving.'
  );
}

console.log(`Verified ${requiredPluginClasses.length} iOS native plugin registrations.`);
