import { useEffect, useState } from 'react';
import { App as CapacitorApp, type URLOpenListenerEvent } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import {
  clearMcpOAuthCallbackFromWebUrl,
  completeMcpOAuthAuthorization,
  dispatchMcpOAuthCompleted,
  getMcpOAuthNativeRelayUrl
} from '../../engines/mcp-auth';
import { useRuntimeStore } from '../../stores/runtimeStore';
import {
  inspectMcpServerConnection,
  MCP_OAUTH_OPEN_SETTINGS_EVENT,
  MCP_OAUTH_CATALOG_REFRESHED_EVENT,
  MCP_OAUTH_CATALOG_REFRESH_FAILED_EVENT,
  publishMcpOAuthConnectionNotice,
  type McpOAuthCatalogRefreshedDetail,
  type McpOAuthCatalogRefreshFailedDetail
} from './mcpServerConnection';

function isMcpOAuthCallbackUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'polaris:'
      ? parsed.hostname === 'mcp' && parsed.pathname === '/oauth/callback'
      : parsed.searchParams.get('mcp_oauth_callback') === '1';
  } catch {
    return false;
  }
}

async function completeCallback(url: string, onCompleted: (serverId: string) => void) {
  if (!isMcpOAuthCallbackUrl(url)) return;
  const nativeRelayUrl = getMcpOAuthNativeRelayUrl(url);
  if (nativeRelayUrl) {
    globalThis.location.replace(nativeRelayUrl);
    return;
  }
  try {
    const result = await completeMcpOAuthAuthorization(url);
    if (result) {
      dispatchMcpOAuthCompleted(result);
      publishMcpOAuthConnectionNotice({ serverId: result.serverId, phase: 'refreshing' });
      globalThis.dispatchEvent(new CustomEvent(MCP_OAUTH_OPEN_SETTINGS_EVENT));
      onCompleted(result.serverId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'MCP OAuth 授权失败。';
    publishMcpOAuthConnectionNotice({ serverId: null, phase: 'failed', message });
    globalThis.dispatchEvent(new CustomEvent(MCP_OAUTH_OPEN_SETTINGS_EVENT));
    globalThis.dispatchEvent(new CustomEvent('polaris:mcp-oauth-failed', {
      detail: {
        message
      }
    }));
  } finally {
    clearMcpOAuthCallbackFromWebUrl();
    if (Capacitor.isNativePlatform()) {
      await Browser.close().catch(() => undefined);
    }
  }
}

export function useMcpOAuthCallbackRuntime() {
  const hydrated = useRuntimeStore((state) => state.hydrated);
  const mcpServers = useRuntimeStore((state) => state.mcpServers);
  const timeoutSeconds = useRuntimeStore((state) => state.mcpToolTimeoutSeconds);
  const updateMcpServer = useRuntimeStore((state) => state.updateMcpServer);
  const [pendingCatalogServerId, setPendingCatalogServerId] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let listener: PluginListenerHandle | null = null;

    const queueCatalogRefresh = (serverId: string) => setPendingCatalogServerId(serverId);

    void completeCallback(globalThis.location.href, queueCatalogRefresh);

    if (Capacitor.isNativePlatform()) {
      void CapacitorApp.getLaunchUrl().then((result) => {
        if (!disposed && result?.url) void completeCallback(result.url, queueCatalogRefresh);
      });
      void CapacitorApp.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
        if (!disposed) void completeCallback(event.url, queueCatalogRefresh);
      }).then((handle) => {
        if (disposed) {
          void handle.remove();
          return;
        }
        listener = handle;
      });
    }

    return () => {
      disposed = true;
      if (listener) void listener.remove();
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !pendingCatalogServerId) return;
    const serverId = pendingCatalogServerId;
    const server = mcpServers.find((entry) => entry.id === serverId);
    setPendingCatalogServerId(null);
    if (!server) {
      publishMcpOAuthConnectionNotice({ serverId, phase: 'failed' });
      globalThis.dispatchEvent(new CustomEvent<McpOAuthCatalogRefreshFailedDetail>(
        MCP_OAUTH_CATALOG_REFRESH_FAILED_EVENT,
        { detail: { serverId, reason: 'missing-server' } }
      ));
      return;
    }

    void inspectMcpServerConnection({ server, timeoutSeconds })
      .then((result) => {
        if (result.status === 'connected') {
          updateMcpServer(server.id, { tools: result.tools });
          publishMcpOAuthConnectionNotice({
            serverId: server.id,
            phase: 'connected',
            toolCount: result.tools.length
          });
          globalThis.dispatchEvent(new CustomEvent<McpOAuthCatalogRefreshedDetail>(
            MCP_OAUTH_CATALOG_REFRESHED_EVENT,
            { detail: { serverId: server.id, toolCount: result.tools.length } }
          ));
          return;
        }
        publishMcpOAuthConnectionNotice({
          serverId: server.id,
          phase: result.status === 'empty' ? 'empty' : 'failed',
          ...(result.status === 'error' ? { message: result.message } : {})
        });
        globalThis.dispatchEvent(new CustomEvent<McpOAuthCatalogRefreshFailedDetail>(
          MCP_OAUTH_CATALOG_REFRESH_FAILED_EVENT,
          {
            detail: {
              serverId: server.id,
              reason: result.status,
              ...(result.status === 'error' ? { message: result.message } : {})
            }
          }
        ));
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : '读取 MCP 工具目录失败。';
        publishMcpOAuthConnectionNotice({ serverId: server.id, phase: 'failed', message });
        globalThis.dispatchEvent(new CustomEvent<McpOAuthCatalogRefreshFailedDetail>(
          MCP_OAUTH_CATALOG_REFRESH_FAILED_EVENT,
          {
            detail: {
              serverId: server.id,
              reason: 'error',
              message
            }
          }
        ));
      });
  }, [hydrated, mcpServers, pendingCatalogServerId, timeoutSeconds, updateMcpServer]);
}
