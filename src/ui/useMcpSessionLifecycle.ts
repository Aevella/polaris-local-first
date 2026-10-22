import { useEffect, useMemo } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { closeAllMcpSessions, primeMcpSessions, reconcileMcpSessions } from '../engines/mcpRuntime';
import { useRuntimeStore } from '../stores/runtimeStore';

export function useMcpSessionLifecycle({ enabled = true }: { enabled?: boolean } = {}) {
  const hydrated = useRuntimeStore((state) => state.hydrated);
  const mcpServers = useRuntimeStore((state) => state.mcpServers);
  const mcpToolTimeoutSeconds = useRuntimeStore((state) => state.mcpToolTimeoutSeconds);
  const mcpToolsEnabled = useRuntimeStore((state) => state.toolPromptPreferences.mcp);
  const sessionConfigKey = useMemo(
    () => mcpServers
      .map((server) => [
        server.id,
        server.transport,
        server.url,
        server.isActive ? 'on' : 'off',
        server.headers.map((header) => `${header.key}:${header.value}`).join('\u001f')
      ].join('\u001f'))
      .join('\u001e'),
    [mcpServers]
  );

  useEffect(() => {
    if (!enabled || !hydrated) return;
    reconcileMcpSessions(mcpServers);
    if (!mcpToolsEnabled) return;
    void primeMcpSessions({
      servers: mcpServers,
      timeoutSeconds: mcpToolTimeoutSeconds
    });
  }, [enabled, hydrated, mcpServers, mcpToolTimeoutSeconds, mcpToolsEnabled, sessionConfigKey]);

  useEffect(() => {
    if (!enabled || !hydrated || !mcpToolsEnabled) return;
    const recover = () => {
      void primeMcpSessions({
        servers: mcpServers,
        timeoutSeconds: mcpToolTimeoutSeconds,
        revalidate: true
      });
    };
    let foreground = document.visibilityState !== 'hidden';
    const updateForeground = (active: boolean) => {
      const resumed = active && !foreground;
      foreground = active;
      if (resumed) recover();
    };
    const onVisibilityChange = () => updateForeground(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', recover);
    let cancelled = false;
    let removeNativeListener: (() => void) | undefined;
    if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('App')) {
      void CapacitorApp.addListener('appStateChange', (state) => updateForeground(state.isActive))
        .then((listener) => {
          if (cancelled) void listener.remove();
          else removeNativeListener = () => { void listener.remove(); };
        }).catch(() => undefined);
    }
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', recover);
      removeNativeListener?.();
    };
  }, [enabled, hydrated, mcpToolsEnabled, mcpServers, mcpToolTimeoutSeconds, sessionConfigKey]);

  useEffect(() => () => {
    void closeAllMcpSessions();
  }, []);
}
