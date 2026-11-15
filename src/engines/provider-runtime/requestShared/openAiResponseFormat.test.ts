import { describe, expect, it } from 'vitest';
import { normalizeOpenAiChatResponseFormat } from './openAiResponseFormat';

describe('normalizeOpenAiChatResponseFormat', () => {
  it.each(['text', 'json_object'])('normalizes %s without changing other request fields', (type) => {
    const body = { response_format: ` ${type} `, model: 'chat', stream: true };
    normalizeOpenAiChatResponseFormat(body);
    expect(body).toEqual({ response_format: { type }, model: 'chat', stream: true });
  });
  it.each([undefined, null, { type: 'json_schema', json_schema: { name: 'result' } }, 'vendor-format', 'b64_json', 'url'])('preserves unspecified, structured and provider-specific formats: %j', (format) => {
    const body = { response_format: format };
    normalizeOpenAiChatResponseFormat(body);
    expect(body.response_format).toEqual(format);
  });
});
