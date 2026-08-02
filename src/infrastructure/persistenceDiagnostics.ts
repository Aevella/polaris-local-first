import { recordClientError } from './clientErrorLog';

export type PersistenceDiagnosticContext = {
  label: string;
  store: string;
  operation: string;
  backend?: string;
  domain?: string;
  stage?: string;
  integrity?: 'complete' | 'degraded' | 'failed';
  rowCount?: number;
  fingerprint?: string;
};

export type PersistenceDiagnosticEntry = PersistenceDiagnosticContext & {
  id: string;
  at: string;
  message: string;
  stack?: string;
};

let latestPersistenceError: PersistenceDiagnosticEntry | null = null;
const listeners = new Set<(entry: PersistenceDiagnosticEntry | null) => void>();

function emitPersistenceErrorChange() {
  listeners.forEach((listener) => listener(latestPersistenceError));
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

function errorStack(error: unknown) {
  return error instanceof Error && error.stack ? error.stack : undefined;
}

export function fingerprintDiagnosticId(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `anon-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function reportPersistenceError(
  context: PersistenceDiagnosticContext,
  error: unknown
) {
  console.warn(context.label, error);
  const clientError = recordClientError(error, 'persistence', {
    context: `${context.store}:${context.operation}`
  });
  latestPersistenceError = {
    ...context,
    id: clientError.id,
    at: clientError.at,
    message: errorMessage(error),
    stack: errorStack(error)
  };
  emitPersistenceErrorChange();
}

export function readLatestPersistenceError() {
  return latestPersistenceError;
}

export function clearLatestPersistenceError() {
  latestPersistenceError = null;
  emitPersistenceErrorChange();
}

export function subscribeLatestPersistenceError(listener: (entry: PersistenceDiagnosticEntry | null) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
