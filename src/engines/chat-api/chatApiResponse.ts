import { recordStreamDebug } from './chatApiStreamDebug';
import type { AssistantReply, AssistantReplyProgress } from './chatApiTypes';
import { createStreamingReplyCollector } from './chatApiStreamingCollector';
import type { CanonicalProviderStreamEvent } from '../provider-runtime';

export async function readStreamingReply(
  response: Response,
  fallbackModel: string,
  onProgress?: (reply: AssistantReplyProgress) => void,
  onChunk?: () => void,
  parseStreamEvents?: (payload: unknown) => CanonicalProviderStreamEvent[]
): Promise<AssistantReply> {
  if (!response.body) {
    throw new Error('Streaming 响应为空');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const isEventStream = response.headers.get('content-type')?.includes('text/event-stream') ?? false;
  const collector = createStreamingReplyCollector(fallbackModel, onProgress, parseStreamEvents);
  const startedAt = Date.now();
  let sawFirstChunk = false;

  recordStreamDebug('fetch-stream-start', {
    contentType: response.headers.get('content-type') ?? 'unknown',
    eventStream: isEventStream
  });

  while (true) {
    onChunk?.();
    const { value, done } = await reader.read();
    onChunk?.();
    const decodedChunk = decoder.decode(value ?? new Uint8Array(), { stream: !done });
    if (!sawFirstChunk && decodedChunk.trim()) {
      sawFirstChunk = true;
      recordStreamDebug('fetch-stream-first-chunk', {
        elapsedMs: Date.now() - startedAt,
        chunkLength: decodedChunk.length
      });
    }
    collector.pushTextChunk(decodedChunk, isEventStream);
    if (done) break;
  }

  recordStreamDebug('fetch-stream-finish', {
    elapsedMs: Date.now() - startedAt,
    firstChunkSeen: sawFirstChunk
  });
  return collector.finish();
}
