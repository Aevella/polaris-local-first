import { useEffect, useMemo, useState } from 'react';
import {
  readLatestPersistenceError,
  subscribeLatestPersistenceError,
  type PersistenceDiagnosticEntry
} from '../../infrastructure/persistenceDiagnostics';
import { useChatStore } from '../../stores/chatStore';
import { useCollectionStore } from '../../stores/collectionStore';
import { usePersonaStore } from '../../stores/personaStore';
import { useRuntimeStore } from '../../stores/runtimeStore';

export type PersistenceReadFailureNoticeState = {
  visible: boolean;
  error: PersistenceDiagnosticEntry | null;
  blockedStores: string[];
  reason: 'read-failure' | 'isolated-row' | null;
};

export type PersistenceReadFailureHydrationState = {
  startupReady: boolean;
  chatHydrated: boolean;
  collectionHydrated: boolean;
  personaHydrated: boolean;
  runtimeHydrated: boolean;
};

function isCoreHydrationReadFailure(error: PersistenceDiagnosticEntry | null) {
  if (!error) return false;
  return (
    ['chat', 'collection', 'persona', 'runtime'].includes(error.store) &&
    error.operation.startsWith('read')
  );
}

export function derivePersistenceReadFailureNotice(
  error: PersistenceDiagnosticEntry | null,
  hydration: PersistenceReadFailureHydrationState
): PersistenceReadFailureNoticeState {
  const blockedStores = [
    !hydration.chatHydrated ? '对话' : null,
    !hydration.collectionHydrated ? '房间' : null,
    !hydration.personaHydrated ? '协作者' : null,
    !hydration.runtimeHydrated ? '设置' : null
  ].filter((item): item is string => Boolean(item));
  const isolated = error?.operation === 'read-isolated-row';
  const coreStoresHydrated = blockedStores.length === 0;
  const isolatedStore = error ? ({
    chat: '对话', collection: '房间', persona: '协作者', runtime: '设置',
    space: '界面状态', document: '文档', asset: '附件'
  } as Record<string, string>)[error.store] : null;

  return {
    visible: Boolean(hydration.startupReady && (
      (isolated && coreStoresHydrated)
      || (blockedStores.length > 0 && isCoreHydrationReadFailure(error))
    )),
    error,
    blockedStores: isolated ? [isolatedStore ?? error?.store ?? '本地数据'] : blockedStores,
    reason: isolated ? 'isolated-row' : isCoreHydrationReadFailure(error) ? 'read-failure' : null
  };
}

export function usePersistenceReadFailureNotice(startupReady: boolean): PersistenceReadFailureNoticeState {
  const chatHydrated = useChatStore((state) => state.hydrated);
  const collectionHydrated = useCollectionStore((state) => state.hydrated);
  const personaHydrated = usePersonaStore((state) => state.hydrated);
  const runtimeHydrated = useRuntimeStore((state) => state.hydrated);
  const [error, setError] = useState<PersistenceDiagnosticEntry | null>(() => readLatestPersistenceError());

  useEffect(() => subscribeLatestPersistenceError(setError), []);

  return useMemo(
    () => derivePersistenceReadFailureNotice(error, {
      startupReady,
      chatHydrated,
      collectionHydrated,
      personaHydrated,
      runtimeHydrated
    }),
    [chatHydrated, collectionHydrated, error, personaHydrated, runtimeHydrated, startupReady]
  );
}
