import { createDebugLog } from '../../infrastructure/debugLog';

type StreamDebugPhase =
  | 'request-path'
  | 'silent-retry'
  | 'fetch-stream-start'
  | 'fetch-stream-first-chunk'
  | 'fetch-stream-finish'
  | 'native-stream-start'
  | 'native-stream-headers'
  | 'native-stream-first-chunk'
  | 'native-stream-finish'
  | 'native-stream-error';

export type StreamDebugEntry = {
  at: number;
  phase: StreamDebugPhase;
  meta?: Record<string, unknown>;
};

const STREAM_DEBUG_STORAGE_KEY = 'polaris-stream-debug-log';
const STREAM_DEBUG_LIMIT = 40;

const streamDebugLog = createDebugLog<StreamDebugEntry>(STREAM_DEBUG_STORAGE_KEY, {
  maxEntries: STREAM_DEBUG_LIMIT
});

export function readStreamDebugEntries(): StreamDebugEntry[] {
  return streamDebugLog.read();
}

export function clearStreamDebugEntries() {
  streamDebugLog.clear();
}

export function recordStreamDebug(phase: StreamDebugPhase, meta?: Record<string, unknown>) {
  const entry: StreamDebugEntry = {
    at: Date.now(),
    phase,
    meta
  };

  console.info('[polaris-stream]', phase, meta ?? {});

  streamDebugLog.append(entry);
}
