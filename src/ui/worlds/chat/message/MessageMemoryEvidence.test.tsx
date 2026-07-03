import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ChatMemoryEvidence } from '../../../../types/domain';
import { createTranslator } from '../../../../i18n';
import { MessageMemoryEvidence } from './MessageMemoryEvidence';

const evidence: ChatMemoryEvidence = {
  requestId: 'request-1',
  strategy: 'semantic_index',
  status: 'within_budget',
  items: [{
    id: 'recall:vector_match:old:chunk-1',
    kind: 'vector_match',
    label: '向量索引讨论 · 2026-06-07',
    sourceConversationId: 'old',
    sourceMessageIds: ['u1', 'a1'],
    textExcerpt: 'user: 记忆应该能看到向量切片。 assistant: 可以把对话轮作为来源片段。',
    estimatedTokens: 42,
    charCount: 180,
    score: 0.872,
    memoryChunkKind: 'dialogue_turn'
  }]
};

const textEvidence: ChatMemoryEvidence = {
  requestId: 'request-2',
  strategy: 'local_scan',
  status: 'within_budget',
  items: [{
    id: 'recall:matched_context:old:u1',
    kind: 'matched_context',
    label: '记忆讨论 · 2026-06-07',
    sourceConversationId: 'old',
    sourceMessageIds: ['u1'],
    textExcerpt: '记忆索引要能区分锚点命中和向量语义线索。',
    estimatedTokens: 18,
    charCount: 42,
    score: 0.42
  }]
};

const mixedEvidence: ChatMemoryEvidence = {
  ...evidence,
  requestId: 'request-3',
  items: [
    ...evidence.items,
    ...textEvidence.items
  ]
};

describe('MessageMemoryEvidence', () => {
  it('renders the lightweight book trigger while collapsed', () => {
    const html = renderToStaticMarkup(
      <MessageMemoryEvidence evidence={evidence} expanded={false} onToggle={() => {}} />
    );

    expect(html).toContain('1 条记忆 · 1 条向量');
    expect(html).toContain('data-kind="vector"');
    expect(html).not.toContain('送入本轮的记忆');
  });

  it('renders vector slice details when expanded', () => {
    const html = renderToStaticMarkup(
      <MessageMemoryEvidence evidence={evidence} expanded={true} onToggle={() => {}} />
    );

    expect(html).toContain('送入本轮的记忆');
    expect(html).toContain('向量片段');
    expect(html).toContain('对话轮');
    expect(html).toContain('2 条消息');
  });

  it('renders anchor recall with a separate trigger tone', () => {
    const html = renderToStaticMarkup(
      <MessageMemoryEvidence evidence={textEvidence} expanded={true} onToggle={() => {}} />
    );

    expect(html).toContain('1 条记忆 · 1 条锚点');
    expect(html).toContain('data-kind="text"');
    expect(html).toContain('锚点命中');
  });

  it('marks mixed recall when vector and text similarity are both present', () => {
    const html = renderToStaticMarkup(
      <MessageMemoryEvidence evidence={mixedEvidence} expanded={false} onToggle={() => {}} />
    );

    expect(html).toContain('2 条记忆 · 1 条向量 · 1 条锚点');
    expect(html).toContain('data-kind="mixed"');
  });

  it('renders embedded evidence without the inline trigger', () => {
    const html = renderToStaticMarkup(
      <MessageMemoryEvidence evidence={mixedEvidence} expanded={true} onToggle={() => {}} showTrigger={false} />
    );

    expect(html).toContain('embedded');
    expect(html).toContain('2 条记忆 · 1 条向量 · 1 条锚点');
    expect(html).toContain('向量索引');
    expect(html).not.toContain('message-memory-evidence-trigger');
  });

  it('localizes memory evidence chrome without translating evidence payload', () => {
    const html = renderToStaticMarkup(
      <MessageMemoryEvidence
        evidence={mixedEvidence}
        expanded={true}
        onToggle={() => {}}
        copy={createTranslator('en-US')}
      />
    );

    expect(html).toContain('2 memories · 1 vector hit · 1 anchor hit');
    expect(html).toContain('Memory sent into this turn');
    expect(html).toContain('Vector match');
    expect(html).toContain('Anchor hit');
    expect(html).toContain('2 messages');
    expect(html).toContain('Similarity 0.872');
    expect(html).toContain('向量索引讨论 · 2026-06-07');
    expect(html).toContain('记忆索引要能区分锚点命中和向量语义线索。');
  });
});
