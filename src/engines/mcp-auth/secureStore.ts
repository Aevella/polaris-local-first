import { Capacitor, registerPlugin } from '@capacitor/core';
import type { McpOAuthPendingAuthorization, McpOAuthTokenSet } from './types';

type NativeSecretStorePlugin = {
  get(options: { key: string }): Promise<{ value?: string }>;
  set(options: { key: string; value: string }): Promise<void>;
  delete(options: { key: string }): Promise<void>;
};

const NativeSecretStore = registerPlugin<NativeSecretStorePlugin>('NativeSecretStore');
const WEB_DATABASE_NAME = 'polaris-secure-credentials';
const WEB_STORE_NAME = 'entries';
const TOKEN_PREFIX = 'mcp-oauth-token:';
const PENDING_PREFIX = 'mcp-oauth-pending:';
const memoryFallback = new Map<string, string>();

function canUseNativeSecretStore() {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('NativeSecretStore');
}

function openWebDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(WEB_DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(WEB_STORE_NAME)) {
        request.result.createObjectStore(WEB_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开 MCP 授权存储。'));
  });
}

async function withWebStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
) {
  const database = await openWebDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(WEB_STORE_NAME, mode);
      const request = run(transaction.objectStore(WEB_STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('MCP 授权存储操作失败。'));
      transaction.onabort = () => reject(transaction.error ?? new Error('MCP 授权存储事务失败。'));
    });
  } finally {
    database.close();
  }
}

async function getSecret(key: string) {
  if (canUseNativeSecretStore()) {
    return (await NativeSecretStore.get({ key })).value ?? null;
  }
  if (typeof indexedDB === 'undefined') {
    return memoryFallback.get(key) ?? null;
  }
  const value = await withWebStore<unknown>('readonly', (store) => store.get(key));
  return typeof value === 'string' ? value : null;
}

async function setSecret(key: string, value: string) {
  if (canUseNativeSecretStore()) {
    await NativeSecretStore.set({ key, value });
    return;
  }
  if (typeof indexedDB === 'undefined') {
    memoryFallback.set(key, value);
    return;
  }
  await withWebStore<IDBValidKey>('readwrite', (store) => store.put(value, key));
}

async function deleteSecret(key: string) {
  if (canUseNativeSecretStore()) {
    await NativeSecretStore.delete({ key });
    return;
  }
  if (typeof indexedDB === 'undefined') {
    memoryFallback.delete(key);
    return;
  }
  await withWebStore<undefined>('readwrite', (store) => store.delete(key));
}

async function readJson<T>(key: string): Promise<T | null> {
  const value = await getSecret(key);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    await deleteSecret(key);
    return null;
  }
}

export function readMcpOAuthToken(serverId: string) {
  return readJson<McpOAuthTokenSet>(`${TOKEN_PREFIX}${serverId}`);
}

export function writeMcpOAuthToken(serverId: string, token: McpOAuthTokenSet) {
  return setSecret(`${TOKEN_PREFIX}${serverId}`, JSON.stringify(token));
}

export function deleteMcpOAuthToken(serverId: string) {
  return deleteSecret(`${TOKEN_PREFIX}${serverId}`);
}

export function readMcpOAuthPendingAuthorization(state: string) {
  return readJson<McpOAuthPendingAuthorization>(`${PENDING_PREFIX}${state}`);
}

export function writeMcpOAuthPendingAuthorization(pending: McpOAuthPendingAuthorization) {
  return setSecret(`${PENDING_PREFIX}${pending.state}`, JSON.stringify(pending));
}

export function deleteMcpOAuthPendingAuthorization(state: string) {
  return deleteSecret(`${PENDING_PREFIX}${state}`);
}

export function clearMcpOAuthSecretStoreForTests() {
  memoryFallback.clear();
}
