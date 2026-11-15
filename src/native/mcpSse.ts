import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

type NativeMcpSseEvent = {
  connectionId: string;
  event?: string;
  data?: string;
  message?: string;
};

type NativeMcpSsePlugin = {
  open(options: {
    connectionId: string;
    url: string;
    headers: Record<string, string>;
    timeoutMs: number;
  }): Promise<{ endpoint: string }>;
  close(options: { connectionId: string }): Promise<void>;
  addListener(
    eventName: 'event' | 'error',
    listener: (event: NativeMcpSseEvent) => void
  ): Promise<PluginListenerHandle>;
};

const NativeMcpSse = registerPlugin<NativeMcpSsePlugin>('NativeMcpSse');

function createConnectionId() {
  return `mcp-sse-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
}

export function canUseNativeMcpSse() {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('NativeMcpSse')) return false;
  const platform = Capacitor.getPlatform();
  return platform === 'ios' || platform === 'android';
}

export async function openNativeMcpSse(args: {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
  onEvent: (event: string, data: string) => void;
  onError: (error: Error) => void;
}) {
  const connectionId = createConnectionId();
  const [eventListener, errorListener] = await Promise.all([
    NativeMcpSse.addListener('event', (event) => {
      if (event.connectionId !== connectionId || typeof event.data !== 'string') return;
      args.onEvent(event.event || 'message', event.data);
    }),
    NativeMcpSse.addListener('error', (event) => {
      if (event.connectionId !== connectionId) return;
      args.onError(new Error(event.message?.trim() || '原生 MCP SSE 连接中断。'));
    })
  ]);

  try {
    const result = await NativeMcpSse.open({
      connectionId,
      url: args.url,
      headers: args.headers,
      timeoutMs: args.timeoutMs
    });
    return {
      endpoint: result.endpoint,
      close: async () => {
        await NativeMcpSse.close({ connectionId }).catch(() => undefined);
        await Promise.all([
          eventListener.remove(),
          errorListener.remove()
        ]);
      }
    };
  } catch (error) {
    await Promise.all([
      eventListener.remove(),
      errorListener.remove()
    ]);
    throw error;
  }
}
