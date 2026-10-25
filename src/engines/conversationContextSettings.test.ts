import { describe, it, expect } from 'vitest';
import { normalizeConversationRequestContext, normalizeConversationWindowDefaults, createConversationWindowSettings, applyConversationRequestContext, selectConversationRequestMessages, selectSteppedRequestMessages } from './conversationContextSettings';
import { createPersonaTemplate } from '../config/persona/personaBuilder';
import { normalizeConversationSettings as normalizeConversationRecord } from './conversationContextSettings';

describe('normalizeConversationRequestContext', () => {
  it('reads old backups without rewriting their source or imposing a count cap', () => {
    expect(normalizeConversationRequestContext(undefined, 0)).toEqual({ mode: 'all' });
    expect(normalizeConversationRequestContext(undefined, 100000)).toEqual({ mode: 'recent', messageCount: 100000 });
    for (const value of [-1, 1.5, NaN, Infinity, '40', null]) {
      expect(normalizeConversationRequestContext(undefined, value)).toEqual({ mode: 'inherit' });
    }
    const source = { contextMessageLimit: 500, title: 'old', messages: [] };
    const result = normalizeConversationRecord(source);
    expect(result).toMatchObject({ requestContext: { mode: 'recent', messageCount: 500 } });
    expect(result).not.toHaveProperty('contextMessageLimit');
    expect(source.contextMessageLimit).toBe(500);
  });
  it('treats the new shape as authoritative and discards contradictory legacy fields', () => {
    expect(normalizeConversationRequestContext({ mode: 'all', messageCount: 40 }, 80)).toEqual({ mode: 'all' });
    expect(normalizeConversationRequestContext({ mode: 'recent', messageCount: 0 }, 80)).toEqual({ mode: 'inherit' });
    expect(normalizeConversationRequestContext({ mode: 'recent', messageCount: 100000 })).toEqual({ mode: 'recent', messageCount: 100000 });
  });
});
describe('normalizeConversationWindowDefaults', () => {
  it('leaves old personas without new defaults and normalizes imported settings', () => {
    expect(normalizeConversationWindowDefaults(undefined)).toBeUndefined();
    expect(normalizeConversationWindowDefaults({ requestContext: { mode: 'all' }, reasoningStrength: 'invalid' }))
      .toMatchObject({ requestContext: { mode: 'all' }, reasoningStrength: 'automatic' });
    const persona = createPersonaTemplate({ id: 'p', name: 'P', description: '', conversationDefaults: { requestContext: { mode: 'recent', messageCount: 90 }, reasoningStrength: 'high' } });
    expect(persona.conversationDefaults).toMatchObject({ requestContext: { mode: 'recent', messageCount: 90 }, reasoningStrength: 'high' });
  });
});
describe('createConversationWindowSettings', () => {
  it('copies defaults so existing windows remain independent', () => {
    const defaults = { requestContext: { mode: 'recent' as const, messageCount: 90 }, reasoningStrength: 'high' as const };
    const window = createConversationWindowSettings(defaults);
    defaults.requestContext.messageCount = 5;
    expect(window.requestContext).toEqual({ mode: 'recent', messageCount: 90 });
    expect(createConversationWindowSettings({ requestContext: { mode: 'fromMessage', anchorMessageId: 'old-window-message' }, reasoningStrength: 'automatic' }).requestContext).toEqual({ mode: 'fromMessage', anchorMessageId: null });
    expect(createConversationWindowSettings()).toMatchObject({ requestContext: { mode: 'inherit' }, reasoningStrength: 'automatic' });
  });
});
describe('applyConversationRequestContext', () => {
  it('inherits by identity and overrides only the request-local persona', () => {
    const persona = createPersonaTemplate({ id: 'p', name: 'P', description: '' });
    persona.advanced.contextMessageLimit = '12';
    expect(applyConversationRequestContext(persona, { mode: 'inherit' })).toBe(persona);
    expect(applyConversationRequestContext(persona, { mode: 'recent', messageCount: 80 })?.advanced.contextMessageLimit).toBe('80');
    expect(applyConversationRequestContext(persona, { mode: 'all' })?.advanced.contextMessageLimit).toBe('');
    expect(persona.advanced.contextMessageLimit).toBe('12');
    expect(applyConversationRequestContext(null, { mode: 'all' })).toBeNull();
  });
});


describe('selectConversationRequestMessages', () => {
  it('uses a stable message id and falls back explicitly for missing anchors', () => {
    const messages = [{ id: 'old', role: 'user' as const, content: 'before', timestamp: 1 }, { id: 'start', role: 'user' as const, content: 'start', timestamp: 1 }, { id: 'answer', role: 'assistant' as const, content: 'after', timestamp: 1 }];
    expect(selectConversationRequestMessages(messages, { mode: 'fromMessage', anchorMessageId: 'start' })).toEqual(messages.slice(1));
    expect(selectConversationRequestMessages(messages, { mode: 'fromMessage', anchorMessageId: 'missing' })).toBe(messages);
    expect(selectConversationRequestMessages(messages, { mode: 'fromMessage', anchorMessageId: null })).toBe(messages);
    expect(selectConversationRequestMessages(messages, { mode: 'fromMessage', anchorMessageId: 'answer' })).toEqual(messages.slice(2));
    expect(messages).toHaveLength(3);
  });
});

describe('selectSteppedRequestMessages', () => {
  const history = (count: number) => Array.from({ length: count }, (_, id) => ({ id, role: 'user' as const }));
  it('keeps one boundary across an entire step and moves only at the next threshold', () => {
    expect(selectSteppedRequestMessages(history(100), 100)[0].id).toBe(0);
    for (let count = 101; count <= 125; count++) expect(selectSteppedRequestMessages(history(count), 100)[0].id).toBe(25);
    expect(selectSteppedRequestMessages(history(126), 100)[0].id).toBe(50);
    expect(selectSteppedRequestMessages(history(1), 1)[0].id).toBe(0);
    expect(selectSteppedRequestMessages(history(2), 1)[0].id).toBe(1);
    expect(selectSteppedRequestMessages([], 100)).toEqual([]);
  });
  it('preserves the latest turn and aligns a reply boundary back to its user', () => {
    const messages = [{ role: 'user' as const }, { role: 'assistant' as const }, { role: 'system' as const }];
    expect(selectSteppedRequestMessages(messages, 1)).toEqual(messages);
    const pairs = Array.from({length: 126}, (_, id) => ({ id, role: id % 2 ? 'assistant' as const : 'user' as const }));
    expect(selectSteppedRequestMessages(pairs.slice(0, 101), 100)[0].id).toBe(24);
    expect(selectSteppedRequestMessages(pairs, 100)[0].id).toBe(50);
  });
});
