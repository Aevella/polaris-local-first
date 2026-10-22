import { describe, it, expect } from 'vitest';
import { createCodeCardProjectionReader } from './chatCodeCardProjection';
import type { ChatMessage, CodeCard } from '../../types/domain';
const message = (id: string, role: ChatMessage['role'], content = '```ts\nanswer()\n```'): ChatMessage => ({ id, role, content, timestamp: 1 });
describe('createCodeCardProjectionReader', () => {
  it('retains historical results when only the last reply changes', () => {
    const read = createCodeCardProjectionReader([]);
    const history = [message('u', 'user'), message('a', 'assistant'), message('u2', 'user'), message('a2', 'assistant')];
    const before = read('c', history);
    const after = read('c', [...history.slice(0, -1), { ...history[3]!, content: 'hello' }]);
    expect(after.codeCardProgressByMessageId.a).toBe(before.codeCardProgressByMessageId.a);
    expect(after.codeCardProgressByMessageId.a2).toBeUndefined();
  });
  it('consumes a continue reference only for the first ordinary assistant reply', () => {
    const card = { id: 'card', code: 'answer()', source: 'manual' } as CodeCard;
    const read = createCodeCardProjectionReader([card]);
    const user = { ...message('u', 'user'), cardReference: { id: 'card', mode: 'continue' } } as ChatMessage;
    const messages = [user, message('s', 'system'), message('a', 'assistant'), message('a2', 'assistant')];
    const result = read('c', messages);
    expect(result.codeCardActionModeByMessageId.a).toBe('open');
    expect(result.codeCardActionModeByMessageId.a2).toBe('save');
    const edited = read('c', [{ ...user, cardReference: undefined }, ...messages.slice(1)]);
    expect(edited.codeCardActionModeByMessageId.a).toBe('save');
  });
  it('recomputes card ownership when the collection changes and handles empty input', () => {
    const assistant = message('a', 'assistant');
    expect(createCodeCardProjectionReader([])('c', []).codeCardProgressByMessageId).toEqual({});
    expect(createCodeCardProjectionReader([])('c', [assistant]).codeCardActionModeByMessageId.a).toBe('save');
    const card = { id: 'card', code: 'answer()', source: 'chat-generated' } as CodeCard;
    expect(createCodeCardProjectionReader([card])('c', [assistant]).codeCardActionModeByMessageId.a).toBe('open');
  });
});
