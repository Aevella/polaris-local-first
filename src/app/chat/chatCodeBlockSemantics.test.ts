import { describe, expect, it } from 'vitest';
import { readMessageCodeBlocks } from './chatCodeBlockSemantics';

describe('readMessageCodeBlocks', () => {
  it('reuses unchanged history when the tail of a 5000-message conversation changes', () => {
    const messages = Array.from({ length: 5000 }, (_, index) => ({
      content: index % 2 ? '```js\nconst count = 1;\n```' : '普通消息'
    }));
    const before = messages.map(readMessageCodeBlocks);
    messages[4999] = { content: '```python\nprint(2)\n```' };
    const after = messages.map(readMessageCodeBlocks);
    for (let index = 0; index < 4999; index += 1) expect(after[index]).toBe(before[index]);
    expect(after[4999]).toMatchObject([{ language: 'python', code: 'print(2)' }]);
    expect(before[4999]).toMatchObject([{ language: 'javascript', code: 'const count = 1;' }]);
  });

  it('invalidates parsed blocks when the same message object receives different content', () => {
    const message = { content: '```css\nbody { color: red; }\n```' };
    expect(readMessageCodeBlocks(message)).toHaveLength(1);
    message.content = '只有文字';
    expect(readMessageCodeBlocks(message)).toEqual([]);
  });
});
