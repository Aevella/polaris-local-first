import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConversationReasoningPicker } from './ConversationReasoningPicker';

describe('ConversationReasoningPicker', () => {
  it('renders every stable strength and marks the current conversation choice', () => {
    const html = renderToStaticMarkup(createElement(ConversationReasoningPicker, {
      value: 'high',
      onChange: () => {},
      onBack: () => {}
    }));

    expect(html.match(/role="radio"/g)).toHaveLength(6);
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('深入');
    expect(html).toContain('只影响当前对话');
  });
});
