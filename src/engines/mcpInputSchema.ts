const JSON_SCHEMA_TYPES = new Set([
  'array',
  'boolean',
  'integer',
  'null',
  'number',
  'object',
  'string'
]);

const SCHEMA_MAP_KEYWORDS = [
  '$defs',
  'definitions',
  'dependentSchemas',
  'patternProperties',
  'properties'
] as const;

const SCHEMA_KEYWORDS = [
  'additionalItems',
  'additionalProperties',
  'contains',
  'contentSchema',
  'else',
  'if',
  'items',
  'not',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties'
] as const;

const SCHEMA_ARRAY_KEYWORDS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const;
const STRING_KEYWORDS = [
  '$anchor',
  '$comment',
  '$dynamicAnchor',
  '$dynamicRef',
  '$id',
  '$ref',
  '$schema',
  'contentEncoding',
  'contentMediaType',
  'description',
  'format',
  'pattern',
  'title'
] as const;
const NUMBER_KEYWORDS = [
  'exclusiveMaximum',
  'exclusiveMinimum',
  'maximum',
  'minimum',
  'multipleOf'
] as const;
const NON_NEGATIVE_INTEGER_KEYWORDS = [
  'maxContains',
  'maxItems',
  'maxLength',
  'maxProperties',
  'minContains',
  'minItems',
  'minLength',
  'minProperties'
] as const;

export type McpInputSchemaResolution =
  | { ok: true; schema: Record<string, unknown> }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pathTo(path: string, key: string) {
  return path ? `${path}.${key}` : key;
}

function validateStringArray(value: unknown, path: string) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return `${path} 必须是字符串数组`;
  }
  if (new Set(value).size !== value.length) {
    return `${path} 不能包含重复项`;
  }
  return null;
}

function validateSchemaType(value: unknown, path: string) {
  const values = Array.isArray(value) ? value : [value];
  if (
    values.length === 0
    || values.some((entry) => typeof entry !== 'string' || !JSON_SCHEMA_TYPES.has(entry))
  ) {
    return `${path} 不是合法的 JSON Schema 类型`;
  }
  if (new Set(values).size !== values.length) {
    return `${path} 不能包含重复类型`;
  }
  return null;
}

function validateSchemaMap(value: unknown, path: string): string | null {
  if (!isRecord(value)) return `${path} 必须是对象`;
  for (const [name, schema] of Object.entries(value)) {
    const error = validateSchemaNode(schema, `${path}.${name}`);
    if (error) return error;
  }
  return null;
}

function validateSchemaNode(value: unknown, path: string): string | null {
  if (typeof value === 'boolean') return null;
  if (!isRecord(value)) return `${path} 必须是 JSON Schema 对象`;

  if (value.type !== undefined) {
    const error = validateSchemaType(value.type, pathTo(path, 'type'));
    if (error) return error;
  }

  for (const keyword of STRING_KEYWORDS) {
    if (value[keyword] !== undefined && typeof value[keyword] !== 'string') {
      return `${pathTo(path, keyword)} 必须是字符串`;
    }
  }

  for (const keyword of NUMBER_KEYWORDS) {
    const candidate = value[keyword];
    if (candidate !== undefined && (typeof candidate !== 'number' || !Number.isFinite(candidate))) {
      return `${pathTo(path, keyword)} 必须是有限数字`;
    }
  }
  if (typeof value.multipleOf === 'number' && value.multipleOf <= 0) {
    return `${pathTo(path, 'multipleOf')} 必须大于 0`;
  }

  for (const keyword of NON_NEGATIVE_INTEGER_KEYWORDS) {
    const candidate = value[keyword];
    if (
      candidate !== undefined
      && (!Number.isInteger(candidate) || (candidate as number) < 0)
    ) {
      return `${pathTo(path, keyword)} 必须是非负整数`;
    }
  }

  if (value.required !== undefined) {
    const error = validateStringArray(value.required, pathTo(path, 'required'));
    if (error) return error;
  }

  for (const keyword of SCHEMA_MAP_KEYWORDS) {
    if (value[keyword] === undefined) continue;
    const error = validateSchemaMap(value[keyword], pathTo(path, keyword));
    if (error) return error;
  }

  for (const keyword of SCHEMA_ARRAY_KEYWORDS) {
    const variants = value[keyword];
    if (variants === undefined) continue;
    if (!Array.isArray(variants) || variants.length === 0) {
      return `${pathTo(path, keyword)} 必须是非空的 JSON Schema 数组`;
    }
    for (let index = 0; index < variants.length; index += 1) {
      const error = validateSchemaNode(variants[index], `${pathTo(path, keyword)}[${index}]`);
      if (error) return error;
    }
  }

  for (const keyword of SCHEMA_KEYWORDS) {
    const nested = value[keyword];
    if (nested === undefined) continue;
    if (typeof nested === 'boolean') continue;
    if (keyword === 'items' && Array.isArray(nested)) {
      for (let index = 0; index < nested.length; index += 1) {
        const error = validateSchemaNode(nested[index], `${pathTo(path, keyword)}[${index}]`);
        if (error) return error;
      }
      continue;
    }
    const error = validateSchemaNode(nested, pathTo(path, keyword));
    if (error) return error;
  }

  if (value.enum !== undefined && (!Array.isArray(value.enum) || value.enum.length === 0)) {
    return `${pathTo(path, 'enum')} 必须是非空数组`;
  }
  if (value.uniqueItems !== undefined && typeof value.uniqueItems !== 'boolean') {
    return `${pathTo(path, 'uniqueItems')} 必须是布尔值`;
  }

  return null;
}

function createDefaultInputSchema() {
  return {
    type: 'object',
    additionalProperties: true,
    properties: {}
  } satisfies Record<string, unknown>;
}

export function resolveMcpInputSchema(value: unknown): McpInputSchemaResolution {
  if (value === undefined || value === null) {
    return { ok: true, schema: createDefaultInputSchema() };
  }
  if (!isRecord(value)) {
    return { ok: false, error: 'inputSchema 根节点必须是对象' };
  }
  if (value.type !== 'object') {
    return { ok: false, error: 'inputSchema 根节点 type 必须是 "object"' };
  }
  const error = validateSchemaNode(value, 'inputSchema');
  return error
    ? { ok: false, error }
    : { ok: true, schema: value };
}
