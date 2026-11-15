import { describe, expect, it } from 'vitest';
import { resolveMcpInputSchema } from './mcpInputSchema';

describe('resolveMcpInputSchema', () => {
  it('accepts a nested object input schema without stripping JSON Schema keywords', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1 },
        filters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              value: { anyOf: [{ type: 'string' }, { type: 'number' }] }
            }
          }
        }
      },
      required: ['query']
    };

    expect(resolveMcpInputSchema(schema)).toEqual({ ok: true, schema });
  });

  it('rejects a tool schema whose root cannot describe an arguments object', () => {
    expect(resolveMcpInputSchema({ type: 'array', items: { type: 'string' } })).toEqual({
      ok: false,
      error: 'inputSchema 根节点 type 必须是 "object"'
    });
  });

  it('rejects malformed nested property schemas before they reach a provider request', () => {
    expect(resolveMcpInputSchema({
      type: 'object',
      properties: {
        city: { type: 'definitely-not-json-schema' }
      }
    })).toEqual({
      ok: false,
      error: 'inputSchema.properties.city.type 不是合法的 JSON Schema 类型'
    });
  });

  it('uses an explicit open object schema when an older MCP server omits inputSchema', () => {
    expect(resolveMcpInputSchema(undefined)).toEqual({
      ok: true,
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {}
      }
    });
  });
});
