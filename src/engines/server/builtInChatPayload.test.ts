import { describe, expect, it } from 'vitest';
import { prepareBuiltInChatPayloadForModel } from './builtInChatPayload';

describe('builtInChatPayload', () => {
  it('preserves structured request content and only resolves the upstream model', () => {
    const payload = {
      model: 'openai/gpt-oss-120b:free',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '答案' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,abc' } }
        ]
      }]
    };

    expect(prepareBuiltInChatPayloadForModel(payload, 'mimo-v2.5-pro')).toEqual({
      ...payload,
      model: 'mimo-v2.5-pro'
    });
  });
});
