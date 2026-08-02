import { describe, expect, it } from 'vitest';
import { derivePersistenceReadFailureNotice } from './usePersistenceReadFailureNotice';
import type { PersistenceDiagnosticEntry } from '../../infrastructure/persistenceDiagnostics';

const error: PersistenceDiagnosticEntry = {
  id: 'error-1',
  at: '2026-05-27T00:00:00.000Z',
  label: '[store:persist]',
  store: 'chat',
  operation: 'read',
  message: 'chat read failed'
};

describe('derivePersistenceReadFailureNotice', () => {
  it('stays hidden without a persistence error', () => {
    expect(derivePersistenceReadFailureNotice(null, {
      startupReady: true,
      chatHydrated: false,
      collectionHydrated: false,
      personaHydrated: false,
      runtimeHydrated: false
    })).toEqual({
      visible: false,
      error: null,
      blockedStores: ['对话', '房间', '协作者', '设置'],
      reason: null
    });
  });

  it('stays hidden when stores are hydrated after an error', () => {
    expect(derivePersistenceReadFailureNotice(error, {
      startupReady: true,
      chatHydrated: true,
      collectionHydrated: true,
      personaHydrated: true,
      runtimeHydrated: true
    })).toEqual({
      visible: false,
      error,
      blockedStores: [],
      reason: 'read-failure'
    });
  });

  it('stays hidden for non-read persistence errors', () => {
    expect(derivePersistenceReadFailureNotice({
      ...error,
      operation: 'write'
    }, {
      startupReady: true,
      chatHydrated: false,
      collectionHydrated: true,
      personaHydrated: true,
      runtimeHydrated: true
    })).toEqual({
      visible: false,
      error: {
        ...error,
        operation: 'write'
      },
      blockedStores: ['对话'],
      reason: null
    });
  });

  it('stays hidden while startup hydration is still in flight', () => {
    expect(derivePersistenceReadFailureNotice(error, {
      startupReady: false,
      chatHydrated: false,
      collectionHydrated: true,
      personaHydrated: true,
      runtimeHydrated: true
    })).toEqual({
      visible: false,
      error,
      blockedStores: ['对话'],
      reason: 'read-failure'
    });
  });

  it('stays hidden when startup hydration stalls without a read error', () => {
    expect(derivePersistenceReadFailureNotice(null, {
      startupReady: false,
      chatHydrated: false,
      collectionHydrated: true,
      personaHydrated: false,
      runtimeHydrated: true
    })).toEqual({
      visible: false,
      error: null,
      blockedStores: ['对话', '协作者'],
      reason: null
    });
  });

  it('shows the affected unhydrated stores after a persistence error', () => {
    expect(derivePersistenceReadFailureNotice(error, {
      startupReady: true,
      chatHydrated: false,
      collectionHydrated: true,
      personaHydrated: false,
      runtimeHydrated: true
    })).toEqual({
      visible: true,
      error,
      blockedStores: ['对话', '协作者'],
      reason: 'read-failure'
    });
  });

  it('shows a non-blocking isolation notice after healthy records finish hydrating', () => {
    const isolated = {
      ...error,
      store: 'document',
      operation: 'read-isolated-row',
      integrity: 'degraded' as const,
      fingerprint: 'anon-1234abcd'
    };
    expect(derivePersistenceReadFailureNotice(isolated, {
      startupReady: true,
      chatHydrated: true,
      collectionHydrated: true,
      personaHydrated: true,
      runtimeHydrated: true
    })).toEqual({
      visible: true,
      error: isolated,
      blockedStores: ['文档'],
      reason: 'isolated-row'
    });

    expect(derivePersistenceReadFailureNotice(isolated, {
      startupReady: true,
      chatHydrated: true,
      collectionHydrated: false,
      personaHydrated: true,
      runtimeHydrated: true
    }).visible).toBe(false);
  });
});
