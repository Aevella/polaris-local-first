import { readKelivoSQLiteSnapshot } from './kelivoSQLiteImportReader';

const KELIVO_SETTINGS_PATH = 'settings.json';
const KELIVO_CHATS_PATH = 'chats.json';
const KELIVO_MANIFEST_PATH = 'manifest.json';
const KELIVO_DATABASE_PATH = 'database/kelivo.db';
const KELIVO_SETTING_MARKERS = [
  'assistants_v1',
  'assistant_memories_v1',
  'provider_configs_v1',
  'mcp_servers_v1',
  'world_books_v1',
  'current_assistant_id_v1'
] as const;

export type KelivoZip = import('jszip') & { close: () => Promise<void> };
export type KelivoSettings = Record<string, unknown>;
export type KelivoArchiveShape = 'legacy-json' | 'sqlite-v2';

export type KelivoBackupPayload = {
  settings: KelivoSettings;
  chats: unknown;
};

function parseJson<T>(content: string, label: string): T {
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new Error(`${label} 格式不正确`);
  }
}

export async function openKelivoBackupArchive(source: Blob) {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await source.arrayBuffer());
  return Object.assign(zip, { close: async () => {} });
}

async function readOptionalSettings(zip: KelivoZip) {
  const settingsFile = zip.file(KELIVO_SETTINGS_PATH);
  if (!settingsFile) return {};
  const settings = parseJson<KelivoSettings>(await settingsFile.async('string'), KELIVO_SETTINGS_PATH);
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('Kelivo settings.json 格式不正确');
  }
  return settings;
}

export async function detectKelivoArchiveShape(zip: KelivoZip): Promise<KelivoArchiveShape | null> {
  const manifestFile = zip.file(KELIVO_MANIFEST_PATH);
  if (manifestFile) {
    const manifest = parseJson<Record<string, unknown>>(
      await manifestFile.async('string'),
      KELIVO_MANIFEST_PATH
    );
    if (manifest && typeof manifest === 'object' && !Array.isArray(manifest)) {
      if (manifest.format === 'kelivo-backup' && manifest.formatVersion === 2) {
        return 'sqlite-v2';
      }
      if (manifest.format === 'kelivo-backup') {
        throw new Error(`暂不支持 Kelivo 备份版本 ${String(manifest.formatVersion ?? '未知')}。`);
      }
    }
    return null;
  }

  if (!zip.file(KELIVO_SETTINGS_PATH)) return null;
  const settings = await readOptionalSettings(zip);
  return KELIVO_SETTING_MARKERS.some((key) => Object.prototype.hasOwnProperty.call(settings, key))
    ? 'legacy-json'
    : null;
}

export async function readKelivoSettings(zip: KelivoZip) {
  if (!zip.file(KELIVO_SETTINGS_PATH)) {
    throw new Error('Kelivo 备份缺少 settings.json');
  }
  return await readOptionalSettings(zip);
}

export async function readKelivoChats(zip: KelivoZip) {
  const chatsFile = zip.file(KELIVO_CHATS_PATH);
  if (!chatsFile) return null;
  return parseJson<unknown>(await chatsFile.async('string'), KELIVO_CHATS_PATH);
}

export async function readKelivoBackupPayload(
  zip: KelivoZip,
  shape: KelivoArchiveShape
): Promise<KelivoBackupPayload> {
  if (shape === 'legacy-json') {
    return {
      settings: await readKelivoSettings(zip),
      chats: await readKelivoChats(zip)
    };
  }

  const databaseFile = zip.file(KELIVO_DATABASE_PATH);
  if (!databaseFile) {
    throw new Error('Kelivo 新版备份缺少 database/kelivo.db');
  }
  const database = await readKelivoSQLiteSnapshot(
    new Uint8Array(await databaseFile.async('arraybuffer'))
  );
  return {
    settings: {
      ...await readOptionalSettings(zip),
      ...database.settings
    },
    chats: {
      conversations: database.conversations,
      messages: database.messages
    }
  };
}
