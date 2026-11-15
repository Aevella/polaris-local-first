import { describe, expect, it } from 'vitest';
import type { McpServerConfig } from '../types/domain';
import { normalizeDiscoveredMcpTools } from './mcpToolCatalog';

function createServer(): McpServerConfig {
  return {
    id: 'games-server',
    handle: 'games',
    name: '小游戏',
    description: '',
    transport: 'streamable-http',
    url: 'https://games.example.com/mcp',
    headers: [],
    tools: [],
    isActive: true
  };
}

describe('normalizeDiscoveredMcpTools', () => {
  it('isolates one malformed external tool while preserving valid sibling tools', () => {
    const result = normalizeDiscoveredMcpTools(createServer(), [
      {
        name: 'roll_dice',
        inputSchema: {
          type: 'object',
          properties: { sides: { type: 'integer', minimum: 2 } },
          required: ['sides']
        }
      },
      {
        name: 'broken_tool',
        inputSchema: {
          type: 'object',
          properties: { mode: { type: ['string', 'not-a-type'] } }
        }
      }
    ]);

    expect(result.tools.map((tool) => tool.toolName)).toEqual(['roll_dice']);
    expect(result.errors).toEqual([
      '小游戏 / broken_tool：inputSchema.properties.mode.type 不是合法的 JSON Schema 类型，已跳过该工具。'
    ]);
  });
});
