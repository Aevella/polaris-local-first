import { useEffect, useState } from 'react';
import { openMcpOAuthAuthorizationUrl } from '../../../app/shell/mcpOAuthBrowser';
import {
  MCP_OAUTH_CATALOG_REFRESHED_EVENT,
  MCP_OAUTH_CATALOG_REFRESH_FAILED_EVENT,
  type McpOAuthCatalogRefreshedDetail,
  type McpOAuthCatalogRefreshFailedDetail
} from '../../../app/shell/mcpServerConnection';
import {
  beginMcpOAuthAuthorization,
  disconnectMcpOAuth,
  getMcpOAuthStatus,
  MCP_OAUTH_COMPLETED_EVENT,
  type McpOAuthAuthorizationRequest,
  type McpOAuthStatus
} from '../../../engines/mcp-auth';
import { disposeMcpSession } from '../../../engines/mcpTransport';
import { useI18n } from '../../../i18n/useI18n';
import type { McpServerConfig } from '../../../types/domain';

type McpOAuthPanelProps = {
  open: boolean;
  server: McpServerConfig | null;
  draftServer: McpServerConfig;
  authorizationRequest: McpOAuthAuthorizationRequest | null;
  onSaveAndConnect: () => Promise<void>;
  onAuthorizationCleared: () => void;
  onMessage: (status: 'idle' | 'success' | 'warning' | 'error', message?: string) => void;
};

export function McpOAuthPanel({
  open,
  server,
  draftServer,
  authorizationRequest,
  onSaveAndConnect,
  onAuthorizationCleared,
  onMessage
}: McpOAuthPanelProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<McpOAuthStatus>('disconnected');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !server) {
      setStatus('disconnected');
      return;
    }
    void getMcpOAuthStatus(server.id)
      .then(setStatus)
      .catch(() => onMessage('error', t('settings.mcp.oauthCredentialStoreFailed')));
  }, [onMessage, open, server, t]);

  useEffect(() => {
    if (!open || !server) return;
    const completed = (event: Event) => {
      const detail = (event as CustomEvent<{ serverId: string }>).detail;
      if (detail?.serverId !== server.id) return;
      setStatus('connected');
      onAuthorizationCleared();
      onMessage('warning', t('settings.mcp.oauthConnectedRefreshing'));
    };
    const catalogRefreshed = (event: Event) => {
      const detail = (event as CustomEvent<McpOAuthCatalogRefreshedDetail>).detail;
      if (detail?.serverId !== server.id) return;
      setStatus('connected');
      onAuthorizationCleared();
      onMessage('success', t('settings.mcp.oauthConnectedRefreshed', { count: detail.toolCount }));
    };
    const catalogRefreshFailed = (event: Event) => {
      const detail = (event as CustomEvent<McpOAuthCatalogRefreshFailedDetail>).detail;
      if (detail?.serverId !== server.id) return;
      setStatus('connected');
      const message = detail.reason === 'empty'
        ? t('settings.mcp.oauthConnectedNoTools')
        : detail.message
          ? t('settings.mcp.oauthCatalogRefreshFailedWithReason', { reason: detail.message })
          : t('settings.mcp.oauthCatalogRefreshFailed');
      onMessage(detail.reason === 'empty' ? 'warning' : 'error', message);
    };
    const failed = (event: Event) => {
      const detail = (event as CustomEvent<{ message: string }>).detail;
      onMessage('error', detail?.message || t('settings.mcp.oauthFailed'));
    };
    globalThis.addEventListener(MCP_OAUTH_COMPLETED_EVENT, completed);
    globalThis.addEventListener('polaris:mcp-oauth-failed', failed);
    globalThis.addEventListener(MCP_OAUTH_CATALOG_REFRESHED_EVENT, catalogRefreshed);
    globalThis.addEventListener(MCP_OAUTH_CATALOG_REFRESH_FAILED_EVENT, catalogRefreshFailed);
    return () => {
      globalThis.removeEventListener(MCP_OAUTH_COMPLETED_EVENT, completed);
      globalThis.removeEventListener('polaris:mcp-oauth-failed', failed);
      globalThis.removeEventListener(MCP_OAUTH_CATALOG_REFRESHED_EVENT, catalogRefreshed);
      globalThis.removeEventListener(MCP_OAUTH_CATALOG_REFRESH_FAILED_EVENT, catalogRefreshFailed);
    };
  }, [onAuthorizationCleared, onMessage, open, server, t]);

  const authorizationRequired = Boolean(authorizationRequest);
  if (!authorizationRequired && status !== 'connected') return null;

  const authorize = async () => {
    if (!server) {
      await onSaveAndConnect();
      return;
    }
    if (!authorizationRequest) {
      onMessage('error', t('settings.mcp.oauthFailed'));
      return;
    }
    setBusy(true);
    try {
      const result = await beginMcpOAuthAuthorization({
        server: draftServer,
        challenge: authorizationRequest.challenge
      });
      await openMcpOAuthAuthorizationUrl(result.authorizationUrl);
    } catch (error) {
      onMessage('error', error instanceof Error ? error.message : t('settings.mcp.oauthFailed'));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!server) return;
    setBusy(true);
    try {
      await disconnectMcpOAuth(server.id);
      await disposeMcpSession(server.id);
      setStatus('disconnected');
      onAuthorizationCleared();
      onMessage('idle');
    } catch {
      onMessage('error', t('settings.mcp.oauthCredentialStoreFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mcp-test-panel mcp-test-panel--warning mcp-oauth-panel">
      <div>
        <strong>{status === 'connected' && !authorizationRequired ? t('settings.mcp.oauthConnected') : t('settings.mcp.oauthRequiredTitle')}</strong>
        <p>{status === 'connected' && !authorizationRequired ? t('settings.mcp.oauthConnectedDetail') : t('settings.mcp.oauthRequiredDetail')}</p>
      </div>
      {status === 'connected' && !authorizationRequired ? (
        <button type="button" className="mcp-btn secondary" onClick={disconnect} disabled={busy}>
          {t('settings.mcp.oauthDisconnect')}
        </button>
      ) : (
        <button type="button" className="mcp-btn primary" onClick={authorize} disabled={busy}>
          {busy
            ? t('settings.mcp.oauthOpening')
            : server
              ? t('settings.mcp.oauthAuthorize')
              : t('settings.mcp.saveAndConnect')}
        </button>
      )}
    </div>
  );
}
