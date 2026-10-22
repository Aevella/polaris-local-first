import { describe, expect, it } from 'vitest';
import {
  McpHttpError,
  ensureSuccessMessage,
  parseHttpJsonRpcResponse,
  parseMcpAuthorizationChallenge,
  parseSseEvents
} from './protocol';

describe('MCP transport protocol', () => {
  it('parses JSON-RPC responses by request id', async () => {
    const result = await parseHttpJsonRpcResponse(new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: 'request-1',
      result: { tools: [] }
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }), 'request-1', '读取目录');

    expect(result).toEqual({
      jsonrpc: '2.0',
      id: 'request-1',
      result: { tools: [] }
    });
  });

  it('parses matching JSON-RPC messages from SSE responses', async () => {
    const result = await parseHttpJsonRpcResponse(new Response([
      'event: message',
      'data: {"jsonrpc":"2.0","id":"request-2","result":{"ok":true}}',
      '',
      ''
    ].join('\n'), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    }), 'request-2', '调用工具');

    expect(result?.result).toEqual({ ok: true });
  });

  it('preserves HTTP status and response body in transport failures', async () => {
    await expect(parseHttpJsonRpcResponse(new Response('Method Not Allowed', {
      status: 405,
      headers: { 'content-type': 'text/plain' }
    }), 'request-3', '初始化 MCP 服务')).rejects.toThrow(
      '初始化 MCP 服务 失败：HTTP 405 · Method Not Allowed'
    );
  });

  it('preserves OAuth metadata from a Bearer challenge', async () => {
    const error = await parseHttpJsonRpcResponse(new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: {
        'content-type': 'application/json',
        'www-authenticate': 'Bearer resource_metadata="https://mcp.example.com/oauth-resource", scope="memory.read memory.write"'
      }
    }), 'request-auth', '初始化 MCP').catch((value) => value);

    expect(error).toBeInstanceOf(McpHttpError);
    expect(error).toMatchObject({
      status: 401,
      authorizationChallenge: {
        resourceMetadataUrl: 'https://mcp.example.com/oauth-resource',
        scope: 'memory.read memory.write'
      }
    });
  });

  it('reads resource metadata from a JSON 401 body when needed', () => {
    expect(parseMcpAuthorizationChallenge(
      'Bearer',
      JSON.stringify({ resource_metadata: 'https://mcp.example.com/oauth-resource' })
    )).toEqual({
      scheme: 'Bearer',
      resourceMetadataUrl: 'https://mcp.example.com/oauth-resource'
    });
  });

  it('keeps multiline SSE data and rejects JSON-RPC errors', () => {
    expect(parseSseEvents('event: endpoint\ndata: /messages\ndata: ?session=1\n\n')).toEqual([
      { event: 'endpoint', data: '/messages\n?session=1' }
    ]);
    expect(() => ensureSuccessMessage({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32601, message: 'Unknown method' }
    }, '初始化')).toThrow('初始化 失败：Unknown method');
  });
});
