// MCP tool-call result formatting and attachment extraction.
//
// This module is pure: it turns the raw `tools/call` JSON-RPC result into a
// human-readable text summary and into structured attachment descriptors.
// It performs no I/O — no fetch, no SSE session state, no catalog cache.
// The transport layer in `mcpRuntime.ts` produces the raw result and hands it
// here for projection.

export type ToolsCallResult = {
  content?: unknown[];
  structuredContent?: unknown;
  isError?: boolean;
};

export type McpToolAttachmentContent = {
  kind: 'image' | 'file';
  sourceType: 'image' | 'audio' | 'resource';
  dataUrl: string;
  mimeType: string;
  name: string;
  textContent?: string;
  uri?: string;
};

function formatToolContentItem(item: unknown) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return JSON.stringify(item, null, 2);
  }

  const record = item as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : 'unknown';

  if (type === 'text' && typeof record.text === 'string') {
    return record.text;
  }
  if (type === 'image') {
    return `[image ${typeof record.mimeType === 'string' ? record.mimeType : 'unknown'}]`;
  }
  if (type === 'audio') {
    return `[audio ${typeof record.mimeType === 'string' ? record.mimeType : 'unknown'}]`;
  }
  if (type === 'resource' && record.resource && typeof record.resource === 'object') {
    const uri = typeof (record.resource as Record<string, unknown>).uri === 'string'
      ? (record.resource as Record<string, unknown>).uri
      : 'unknown-resource';
    return `[resource ${uri}]`;
  }

  return JSON.stringify(record, null, 2);
}

function readMimeType(record: Record<string, unknown>, fallback: string) {
  const rawMimeType = typeof record.mimeType === 'string'
    ? record.mimeType
    : typeof record.mime_type === 'string'
      ? record.mime_type
      : '';
  return rawMimeType.trim() || fallback;
}

function extensionFromMimeType(mimeType: string) {
  const normalized = mimeType.trim().toLowerCase().split(';')[0]?.trim() || '';
  if (normalized === 'image/jpeg') return 'jpg';
  if (normalized === 'image/svg+xml') return 'svg';
  if (normalized === 'audio/mpeg') return 'mp3';
  if (normalized === 'audio/wav' || normalized === 'audio/x-wav') return 'wav';
  if (normalized === 'application/json') return 'json';
  if (normalized.startsWith('text/')) return 'txt';
  const match = normalized.match(/^[a-z0-9.+-]+\/([a-z0-9.+-]+)$/);
  return match?.[1]?.replace(/\+xml$/, '') || 'bin';
}

function safeAttachmentName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-') || '';
}

function nameFromResourceUri(uri: string | undefined) {
  if (!uri) return '';
  try {
    const url = new URL(uri);
    return safeAttachmentName(decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? ''));
  } catch {
    return safeAttachmentName(uri.split('/').filter(Boolean).pop() ?? '');
  }
}

function buildMcpAttachmentName(args: {
  record: Record<string, unknown>;
  sourceType: McpToolAttachmentContent['sourceType'];
  mimeType: string;
  uri?: string;
  index: number;
}) {
  const explicitName = typeof args.record.name === 'string'
    ? args.record.name
    : typeof args.record.title === 'string'
      ? args.record.title
      : '';
  const safeExplicitName = safeAttachmentName(explicitName);
  if (safeExplicitName) return safeExplicitName;

  const uriName = nameFromResourceUri(args.uri);
  if (uriName) return uriName;

  return `${args.sourceType}-${args.index + 1}.${extensionFromMimeType(args.mimeType)}`;
}

function base64DataUrl(mimeType: string, data: string) {
  const trimmed = data.trim();
  return trimmed.startsWith('data:') ? trimmed : `data:${mimeType};base64,${trimmed}`;
}

function textDataUrl(mimeType: string, text: string) {
  const normalizedMimeType = mimeType.toLowerCase().startsWith('text/')
    ? mimeType
    : 'text/plain;charset=utf-8';
  return `data:${normalizedMimeType},${encodeURIComponent(text)}`;
}

function extractResourceAttachmentContent(
  record: Record<string, unknown>,
  index: number
): McpToolAttachmentContent | null {
  if (!record.resource || typeof record.resource !== 'object' || Array.isArray(record.resource)) return null;
  const resource = record.resource as Record<string, unknown>;
  const uri = typeof resource.uri === 'string' ? resource.uri.trim() : undefined;

  if (typeof resource.text === 'string') {
    const mimeType = readMimeType(resource, 'text/plain;charset=utf-8');
    return {
      kind: 'file',
      sourceType: 'resource',
      dataUrl: textDataUrl(mimeType, resource.text),
      mimeType,
      name: buildMcpAttachmentName({ record: resource, sourceType: 'resource', mimeType, uri, index }),
      textContent: resource.text,
      ...(uri ? { uri } : {})
    };
  }

  const blobData = typeof resource.blob === 'string'
    ? resource.blob
    : typeof resource.data === 'string'
      ? resource.data
      : '';
  if (!blobData.trim()) return null;

  const mimeType = readMimeType(resource, 'application/octet-stream');
  return {
    kind: mimeType.trim().toLowerCase().startsWith('image/') ? 'image' : 'file',
    sourceType: 'resource',
    dataUrl: base64DataUrl(mimeType, blobData),
    mimeType,
    name: buildMcpAttachmentName({ record: resource, sourceType: 'resource', mimeType, uri, index }),
    ...(uri ? { uri } : {})
  };
}

export function extractToolAttachmentContent(result: ToolsCallResult): McpToolAttachmentContent[] {
  return (result.content ?? [])
    .map((item, index): McpToolAttachmentContent | null => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      if (record.type === 'image' && typeof record.data === 'string' && record.data.trim()) {
        const mimeType = readMimeType(record, 'image/png');
        const normalizedMimeType = mimeType.trim().toLowerCase().startsWith('image/') ? mimeType : 'image/png';
        return {
          kind: 'image',
          sourceType: 'image',
          dataUrl: base64DataUrl(normalizedMimeType, record.data),
          mimeType: normalizedMimeType,
          name: buildMcpAttachmentName({ record, sourceType: 'image', mimeType: normalizedMimeType, index })
        };
      }

      if (record.type === 'audio' && typeof record.data === 'string' && record.data.trim()) {
        const mimeType = readMimeType(record, 'audio/mpeg');
        return {
          kind: 'file',
          sourceType: 'audio',
          dataUrl: base64DataUrl(mimeType, record.data),
          mimeType,
          name: buildMcpAttachmentName({ record, sourceType: 'audio', mimeType, index })
        };
      }

      if (record.type === 'resource') {
        return extractResourceAttachmentContent(record, index);
      }

      return null;
    })
    .filter((item): item is McpToolAttachmentContent => Boolean(item));
}

export function formatToolsCallResult(result: ToolsCallResult) {
  const parts = (result.content ?? [])
    .map((item) => formatToolContentItem(item))
    .filter((item) => item && item.trim());

  if (result.structuredContent !== undefined) {
    parts.push(JSON.stringify(result.structuredContent));
  }

  return parts.join('\n\n').trim() || '（MCP 工具无文本输出）';
}
