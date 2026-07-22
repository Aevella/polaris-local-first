import { useMemo, useState } from 'react';
import {
  clearStreamDebugEntries,
  readStreamDebugEntries,
  type StreamDebugEntry
} from '../../engines/chat-api/chatApiStreamDebug';
import { useI18n } from '../../i18n/useI18n';
import type { I18nTranslator } from '../../i18n/translator';

function findLatestEntry(entries: StreamDebugEntry[], phase: StreamDebugEntry['phase']) {
  return [...entries].reverse().find((entry) => entry.phase === phase);
}

function formatDebugTime(at: number, t: I18nTranslator['t']) {
  try {
    return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return t('apiProvider.debug.justNow');
  }
}

function formatDuration(ms: number | null, t: I18nTranslator['t']) {
  if (ms === null || !Number.isFinite(ms)) return t('apiProvider.debug.notRecorded');
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function summarizeEndpoint(endpoint: string | null, t: I18nTranslator['t']) {
  if (!endpoint) return t('apiProvider.debug.notRecorded');
  try {
    const parsed = new URL(endpoint);
    const endpointLabel = `${parsed.host}${parsed.pathname}`;
    if (parsed.pathname.startsWith('/api/')) {
      return t('apiProvider.debug.viaRelay', { endpoint: endpointLabel });
    }
    return t('apiProvider.debug.direct', { endpoint: endpointLabel });
  } catch {
    return endpoint;
  }
}

function buildLatestRequestSummary(entries: StreamDebugEntry[], t: I18nTranslator['t']) {
  const latestPath = findLatestEntry(entries, 'request-path');
  if (!latestPath) return null;

  const requestAt = latestPath.at;
  const path = typeof latestPath.meta?.path === 'string' ? latestPath.meta.path : 'unknown';
  const endpoint = typeof latestPath.meta?.endpoint === 'string' ? latestPath.meta.endpoint : null;
  const latestFirstChunk =
    [...entries]
      .reverse()
      .find((entry) =>
        (entry.phase === 'fetch-stream-first-chunk' || entry.phase === 'native-stream-first-chunk') && entry.at >= requestAt
      ) ?? null;
  const latestFinish =
    [...entries]
      .reverse()
      .find((entry) =>
        (entry.phase === 'fetch-stream-finish'
          || entry.phase === 'native-stream-finish'
          || entry.phase === 'native-stream-error')
          && entry.at >= requestAt
      ) ?? null;

  const firstChunkMs =
    typeof latestFirstChunk?.meta?.elapsedMs === 'number'
      ? latestFirstChunk.meta.elapsedMs
      : null;
  const waitingForFirstChunk = latestPath.meta?.requestStream === true && !latestFirstChunk && !latestFinish;

  return {
    path,
    route: summarizeEndpoint(endpoint, t),
    firstChunkMs,
    waitingForFirstChunk
  };
}

function summarizeLatestPath(entries: StreamDebugEntry[], t: I18nTranslator['t']) {
  const latestPath = findLatestEntry(entries, 'request-path');
  const path = typeof latestPath?.meta?.path === 'string' ? latestPath.meta.path : null;
  const requestStream = latestPath?.meta?.requestStream === true;
  const providerStreamingEnabled = latestPath?.meta?.providerStreamingEnabled === true;
  const personaStreamingEnabled =
    typeof latestPath?.meta?.personaStreamingEnabled === 'boolean'
      ? latestPath.meta.personaStreamingEnabled
      : null;
  const latestNativeFinish = findLatestEntry(entries, 'native-stream-finish');
  const latestFetchFinish = findLatestEntry(entries, 'fetch-stream-finish');
  const latestFirstChunk = findLatestEntry(entries, 'fetch-stream-first-chunk') ?? findLatestEntry(entries, 'native-stream-first-chunk');
  const nativeBuffered =
    path === 'native-stream'
      && latestNativeFinish?.meta?.firstChunkSeen === false;
  const fetchBuffered =
    path === 'fetch-stream'
      && latestFetchFinish?.meta?.firstChunkSeen === false;

  if (!requestStream) {
    if (!providerStreamingEnabled) return t('apiProvider.debug.noProviderStream');
    if (personaStreamingEnabled === false) return t('apiProvider.debug.noPersonaStream');
    return t('apiProvider.debug.noStream');
  }
  if (!latestFirstChunk && (path === 'fetch-stream' || path === 'native-stream')) {
    return t('apiProvider.debug.waitingFirstChunk');
  }
  if (nativeBuffered) return t('apiProvider.debug.nativeBuffered');
  if (fetchBuffered) return t('apiProvider.debug.fetchBuffered');
  if (path === 'native-stream') return t('apiProvider.debug.nativeStream');
  if (path === 'fetch-stream') return t('apiProvider.debug.fetchStream');
  return t('apiProvider.debug.pathMissing');
}

function summarizeEntryMeta(entry: StreamDebugEntry, t: I18nTranslator['t']) {
  switch (entry.phase) {
    case 'request-path': {
      const path = typeof entry.meta?.path === 'string' ? entry.meta.path : 'unknown';
      const requestStream = entry.meta?.requestStream === true ? 'stream=true' : 'stream=false';
      return `${path} · ${requestStream}`;
    }
    case 'native-stream-headers': {
      const eventStream = entry.meta?.eventStream === true ? 'event-stream' : 'non-event-stream';
      return `${eventStream}`;
    }
    case 'native-stream-first-chunk':
    case 'fetch-stream-first-chunk': {
      const elapsedMs = typeof entry.meta?.elapsedMs === 'number' ? `${entry.meta.elapsedMs}ms` : null;
      const source = typeof entry.meta?.source === 'string' ? entry.meta.source : null;
      return [source, elapsedMs].filter(Boolean).join(' · ');
    }
    case 'native-stream-finish':
    case 'fetch-stream-finish': {
      const firstChunkSeen = entry.meta?.firstChunkSeen === true
        ? t('apiProvider.debug.firstChunkSeen')
        : t('apiProvider.debug.firstChunkMissing');
      const elapsedMs = typeof entry.meta?.elapsedMs === 'number' ? `${entry.meta.elapsedMs}ms` : null;
      return [firstChunkSeen, elapsedMs].filter(Boolean).join(' · ');
    }
    default:
      return null;
  }
}

export function ApiStreamDebugCard() {
  const { t } = useI18n();
  const [entries, setEntries] = useState(() => readStreamDebugEntries());
  const latestEntries = useMemo(() => [...entries].slice(-6).reverse(), [entries]);
  const latestRequestSummary = useMemo(() => buildLatestRequestSummary(entries, t), [entries, t]);

  return (
    <div className="theme-css-guard-card">
      <div className="theme-css-guard-row">
        <strong>{t('apiProvider.debug.title')}</strong>
        <div className="provider-inline-actions">
          <button type="button" className="btn-secondary compact" onClick={() => setEntries(readStreamDebugEntries())}>
            {t('apiProvider.debug.refresh')}
          </button>
          <button
            type="button"
            className="btn-secondary compact"
            onClick={() => {
              clearStreamDebugEntries();
              setEntries([]);
            }}
          >
            {t('apiProvider.debug.clear')}
          </button>
        </div>
      </div>
      <p>{entries.length ? summarizeLatestPath(entries, t) : t('apiProvider.debug.emptyGuide')}</p>
      {latestRequestSummary && (
        <div className="theme-css-guard-list">
          <span>{t('apiProvider.debug.routeLabel', { route: latestRequestSummary.route })}</span>
          <span>{t('apiProvider.debug.pathLabel', { path: latestRequestSummary.path })}</span>
          <span>{t('apiProvider.debug.firstChunkMs', { duration: formatDuration(latestRequestSummary.firstChunkMs, t) })}</span>
          <span>{latestRequestSummary.waitingForFirstChunk ? t('apiProvider.debug.statusWaiting') : t('apiProvider.debug.statusDone')}</span>
        </div>
      )}
      <div className="theme-css-guard-list">
        {latestEntries.length > 0 ? (
          latestEntries.map((entry) => {
            const meta = summarizeEntryMeta(entry, t);
            return (
              <span key={`${entry.at}-${entry.phase}`}>
                {formatDebugTime(entry.at, t)} · {entry.phase}{meta ? ` · ${meta}` : ''}
              </span>
            );
          })
        ) : (
          <span>{t('apiProvider.debug.emptyEntries')}</span>
        )}
      </div>
    </div>
  );
}
