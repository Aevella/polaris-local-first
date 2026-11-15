import { useEffect, useState } from 'react';
import { openMcpOAuthAuthorizationUrl } from '../../../app/shell/mcpOAuthBrowser';
import { inspectMcpServerConnection } from '../../../app/shell/mcpServerConnection';
import { buildMcpHandle } from '../../../engines/mcpHandle';
import {
  beginMcpOAuthAuthorization,
  type McpOAuthAuthorizationRequest
} from '../../../engines/mcp-auth';
import { useI18n } from '../../../i18n/useI18n';
import type { McpServerConfig, McpServerHeader, McpServerToolConfig, McpServerTransport } from '../../../types/domain';
import { Icon } from '../../Icon';
import { McpOAuthPanel } from './McpOAuthPanel';

type McpServerEditorSheetProps = {
  open: boolean;
  server: McpServerConfig | null;
  timeoutSeconds: number;
  onClose: () => void;
  onPersist: (
    serverId: string | null,
    patch: Omit<McpServerConfig, 'id' | 'handle'>
  ) => string;
  onDelete?: () => void;
};

type McpConnectionTestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'success'; message: string }
  | { status: 'warning'; message: string }
  | { status: 'error'; message: string };

function createEmptyHeader(): McpServerHeader {
  return {
    id: `header-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    key: '',
    value: ''
  };
}

function usesCleartextHttp(value: string) {
  try {
    return new URL(value.trim()).protocol === 'http:';
  } catch {
    return false;
  }
}

export function McpServerEditorSheet({
  open,
  server,
  timeoutSeconds,
  onClose,
  onPersist,
  onDelete
}: McpServerEditorSheetProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [transport, setTransport] = useState<McpServerTransport>('streamable-http');
  const [url, setUrl] = useState('');
  const [oauthClientId, setOauthClientId] = useState('');
  const [headers, setHeaders] = useState<McpServerHeader[]>([]);
  const [tools, setTools] = useState<McpServerToolConfig[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [testState, setTestState] = useState<McpConnectionTestState>({ status: 'idle' });
  const [authorizationRequest, setAuthorizationRequest] = useState<McpOAuthAuthorizationRequest | null>(null);
  const [persistedServer, setPersistedServer] = useState<McpServerConfig | null>(server);
  const cleartextHttpActive = usesCleartextHttp(url);

  useEffect(() => {
    if (!open) return;
    setName(server?.name ?? '');
    setDescription(server?.description ?? '');
    setTransport(server?.transport ?? 'streamable-http');
    setUrl(server?.url ?? '');
    setOauthClientId(server?.oauthClientId ?? '');
    setHeaders(server?.headers.length ? server.headers : []);
    setTools(server?.tools ?? []);
    setIsActive(server?.isActive ?? true);
    setTestState({ status: 'idle' });
    setAuthorizationRequest(null);
    setPersistedServer(server);
  }, [open, server?.id]);

  if (!open) return null;

  const normalizedHeaders = () =>
    headers
      .map((header) => ({
        ...header,
        key: header.key.trim(),
        value: header.value
      }))
      .filter((header) => header.key);

  const buildServerPatch = (
    nextTools: McpServerToolConfig[] = tools
  ): Omit<McpServerConfig, 'id' | 'handle'> => ({
    name: name.trim(),
    description: description.trim(),
    transport,
    url: url.trim(),
    ...(oauthClientId.trim() ? { oauthClientId: oauthClientId.trim() } : {}),
    headers: normalizedHeaders(),
    tools: nextTools,
    isActive
  });

  const buildDraftServer = (serverId = persistedServer?.id ?? 'mcp-test-preview'): McpServerConfig => {
    const trimmedName = name.trim() || t('settings.mcp.testNameFallback');
    const trimmedUrl = url.trim();
    return {
      id: serverId,
      handle: buildMcpHandle({
        handle: server?.handle,
        name: trimmedName,
        url: trimmedUrl,
        id: serverId
      }),
      name: trimmedName,
      description: description.trim(),
      transport,
      url: trimmedUrl,
      ...(oauthClientId.trim() ? { oauthClientId: oauthClientId.trim() } : {}),
      headers: normalizedHeaders(),
      tools,
      isActive: true
    };
  };

  const persistDraft = (nextTools: McpServerToolConfig[] = tools) => {
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName) {
      window.alert(t('settings.mcp.nameRequired'));
      return null;
    }
    if (!trimmedUrl) {
      window.alert(t('settings.mcp.urlRequired'));
      return null;
    }

    const patch = buildServerPatch(nextTools);
    const serverId = onPersist(persistedServer?.id ?? null, patch);
    const savedServer: McpServerConfig = {
      id: serverId,
      handle: buildMcpHandle({
        handle: persistedServer?.handle,
        name: patch.name,
        url: patch.url,
        id: serverId
      }),
      ...patch
    };
    setPersistedServer(savedServer);
    return savedServer;
  };

  const applyConnectionResult = async (connectionServer: McpServerConfig, openAuthorization: boolean) => {
    const result = await inspectMcpServerConnection({
      server: connectionServer,
      timeoutSeconds
    });
    if (result.status === 'authorization-required') {
      setAuthorizationRequest(result.request);
      setTestState({ status: 'warning', message: t('settings.mcp.oauthRequired') });
      if (openAuthorization) {
        const authorization = await beginMcpOAuthAuthorization({
          server: connectionServer,
          challenge: result.request.challenge
        });
        await openMcpOAuthAuthorizationUrl(authorization.authorizationUrl);
      }
      return;
    }
    if (result.status === 'error') {
      setTestState({ status: 'error', message: result.message });
      return;
    }
    if (result.status === 'empty') {
      setTestState({ status: 'warning', message: t('settings.mcp.testNoTools') });
      return;
    }

    setTools(result.tools);
    if (connectionServer.id !== 'mcp-test-preview') {
      const patch = buildServerPatch(result.tools);
      onPersist(connectionServer.id, patch);
      setPersistedServer({ ...connectionServer, ...patch });
    }
    const toolNames = result.tools.map((tool) => tool.name).slice(0, 4).join(t('settings.mcp.testToolSeparator'));
    const summary = result.tools.length > 4
      ? t('settings.mcp.testToolSummaryMore', { count: result.tools.length })
      : t('settings.mcp.testToolSummary', { count: result.tools.length });
    setTestState({ status: 'success', message: t('settings.mcp.testSuccess', { summary, tools: toolNames }) });
  };

  const testConnection = async () => {
    if (!url.trim()) {
      setTestState({ status: 'error', message: t('settings.mcp.testMissingUrl') });
      return;
    }

    const draftServer = buildDraftServer();

    setTestState({ status: 'testing' });
    setAuthorizationRequest(null);
    try {
      await applyConnectionResult(draftServer, false);
    } catch (error) {
      setTestState({
        status: 'error',
        message: error instanceof Error ? error.message : t('settings.mcp.testFailed')
      });
    }
  };

  const saveOnly = () => {
    if (!persistDraft()) return;
    onClose();
  };

  const saveAndConnect = async () => {
    const savedServer = persistDraft();
    if (!savedServer) return;
    setTestState({ status: 'testing' });
    setAuthorizationRequest(null);
    try {
      await applyConnectionResult(savedServer, true);
    } catch (error) {
      setTestState({
        status: 'error',
        message: error instanceof Error ? error.message : t('settings.mcp.testFailed')
      });
    }
  };

  return (
    <div className="mcp-inline-sheet-overlay" onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="mcp-inline-sheet mcp-inline-sheet--editor" role="dialog" aria-modal="true" aria-label={server ? t('settings.mcp.editorTitleEdit') : t('settings.mcp.editorTitleCreate')}>
        <div className="sheet-handle" />
        <div className="mcp-inline-sheet-header">
          <button type="button" className="mcp-icon-button" onClick={onClose} aria-label={t('settings.mcp.close')}>
            <Icon name="x" size={16} />
          </button>
          <strong>{server ? t('settings.mcp.editorTitleEdit') : t('settings.mcp.editorTitleCreate')}</strong>
          <button
            type="button"
            className="mcp-inline-sheet-confirm"
            onClick={() => void saveAndConnect()}
            disabled={testState.status === 'testing'}
          >
            {testState.status === 'testing' ? t('settings.mcp.connecting') : t('settings.mcp.saveAndConnect')}
          </button>
        </div>

        <div className="settings-form mcp-settings-form">
          <div className="memory-toggle memory-toggle--switch">
            <div className="memory-toggle-copy">
              <strong>{t('settings.mcp.enabledTitle')}</strong>
              <span>{t('settings.mcp.enabledDetail')}</span>
            </div>
            <button
              type="button"
              className={`ps-toggle-sw memory-toggle-switch ${isActive ? 'ps-toggle-sw--on' : ''}`}
              aria-pressed={isActive}
              onClick={() => setIsActive((value) => !value)}
            >
              <span className="ps-toggle-knob" />
            </button>
          </div>

          <label>
            {t('settings.mcp.nameLabel')}
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="My MCP" />
          </label>

          <label>
            {t('settings.mcp.descriptionLabel')}
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('settings.mcp.descriptionPlaceholder')}
            />
          </label>

          <div className="mcp-transport-field">
            <span>{t('settings.mcp.transportLabel')}</span>
            <div className="mcp-transport-switch">
              <button
                type="button"
                className={transport === 'streamable-http' ? 'active' : ''}
                onClick={() => setTransport('streamable-http')}
              >
                Streamable HTTP
              </button>
              <button
                type="button"
                className={transport === 'sse' ? 'active' : ''}
                onClick={() => setTransport('sse')}
              >
                SSE
              </button>
            </div>
          </div>

          <label>
            {t('settings.mcp.urlLabel')}
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="http://localhost:3000"
            />
          </label>

          {cleartextHttpActive ? (
            <div className="mcp-cleartext-warning" role="status">
              <strong>{t('settings.mcp.cleartextWarningTitle')}</strong>
              <span>{t('settings.mcp.cleartextWarningDetail')}</span>
            </div>
          ) : null}

          <label>
            {t('settings.mcp.oauthClientIdLabel')}
            <input
              value={oauthClientId}
              onChange={(event) => setOauthClientId(event.target.value)}
              placeholder={t('settings.mcp.oauthClientIdPlaceholder')}
            />
            <span className="mcp-field-hint">{t('settings.mcp.oauthClientIdHint')}</span>
          </label>

          <div className={`mcp-test-panel ${testState.status !== 'idle' ? `mcp-test-panel--${testState.status}` : ''}`}>
            <button
              type="button"
              className="mcp-btn secondary mcp-test-button"
              onClick={testConnection}
              disabled={testState.status === 'testing'}
            >
              {testState.status === 'testing' ? t('settings.mcp.testing') : t('settings.mcp.testConnection')}
            </button>
            <p aria-live="polite">
              {testState.status === 'idle'
                ? t('settings.mcp.testIdle')
                : testState.status === 'testing'
                  ? t('settings.mcp.testReading')
                  : testState.message}
            </p>
          </div>

          <McpOAuthPanel
            open={open}
            server={persistedServer}
            draftServer={buildDraftServer()}
            authorizationRequest={authorizationRequest}
            onSaveAndConnect={saveAndConnect}
            onAuthorizationCleared={() => setAuthorizationRequest(null)}
            onMessage={(status, message) => {
              setTestState(status === 'idle' ? { status } : { status, message: message ?? '' });
            }}
          />

          <div className="mcp-tool-editor">
            <div className="mcp-tool-editor-head">
              <div>
                <span>{t('settings.mcp.toolsSection')}</span>
                <strong>{t('settings.mcp.toolsCount', {
                  enabled: tools.filter((tool) => tool.enabled).length,
                  total: tools.length
                })}</strong>
              </div>
              <button
                type="button"
                className="theme-inline-action"
                onClick={testConnection}
                disabled={testState.status === 'testing'}
              >
                {t('settings.mcp.refreshTools')}
              </button>
            </div>
            {tools.length > 0 ? (
              <div className="mcp-tool-list">
                {tools.map((tool) => (
                  <div key={tool.name} className={`mcp-tool-row ${tool.enabled ? '' : 'is-disabled'}`}>
                    <div className="mcp-tool-copy">
                      <strong>{tool.name}</strong>
                      <span>{tool.description || t('settings.mcp.toolNoDescription')}</span>
                    </div>
                    <button
                      type="button"
                      className={`ps-toggle-sw ${tool.enabled ? 'ps-toggle-sw--on' : ''}`}
                      aria-label={t('settings.mcp.toolToggleAria', {
                        name: tool.name,
                        status: tool.enabled ? t('settings.mcp.statusEnabled') : t('settings.mcp.statusDisabled')
                      })}
                      aria-pressed={tool.enabled}
                      onClick={() =>
                        setTools((current) =>
                          current.map((entry) =>
                            entry.name === tool.name ? { ...entry, enabled: !entry.enabled } : entry
                          )
                        )
                      }
                    >
                      <span className="ps-toggle-knob" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mcp-tool-empty">{t('settings.mcp.toolsEmpty')}</p>
            )}
          </div>

          <div className="mcp-header-editor">
            <div className="mcp-header-editor-head">
              <span>{t('settings.mcp.headersSection')}</span>
              <button
                type="button"
                className="theme-inline-action"
                onClick={() => setHeaders((current) => [...current, createEmptyHeader()])}
              >
                {t('settings.mcp.addHeader')}
              </button>
            </div>
            <div className="mcp-header-editor-list">
              {headers.map((header) => (
                <div key={header.id} className="mcp-header-row">
                  <input
                    value={header.key}
                    onChange={(event) =>
                      setHeaders((current) =>
                        current.map((entry) =>
                          entry.id === header.id ? { ...entry, key: event.target.value } : entry
                        )
                      )
                    }
                    placeholder="Header-Key"
                  />
                  <input
                    value={header.value}
                    onChange={(event) =>
                      setHeaders((current) =>
                        current.map((entry) =>
                          entry.id === header.id ? { ...entry, value: event.target.value } : entry
                        )
                      )
                    }
                    placeholder="Header Value"
                  />
                  <button
                    type="button"
                    className="mcp-icon-button subtle"
                    onClick={() => setHeaders((current) => current.filter((entry) => entry.id !== header.id))}
                    aria-label={t('settings.mcp.deleteHeader')}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mcp-inline-sheet-actions">
          {server && onDelete ? (
            <button type="button" className="mcp-btn danger" onClick={onDelete}>
              {t('settings.mcp.delete')}
            </button>
          ) : null}
          <button type="button" className="mcp-btn secondary" onClick={onClose}>
            {t('settings.mcp.cancel')}
          </button>
          <button type="button" className="mcp-btn secondary" onClick={saveOnly}>
            {t('settings.mcp.saveOnly')}
          </button>
          <button
            type="button"
            className="mcp-btn primary"
            onClick={() => void saveAndConnect()}
            disabled={testState.status === 'testing'}
          >
            {testState.status === 'testing' ? t('settings.mcp.connecting') : t('settings.mcp.saveAndConnect')}
          </button>
        </div>
      </div>
    </div>
  );
}
