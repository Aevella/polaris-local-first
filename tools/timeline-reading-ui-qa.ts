import type { Page } from 'playwright';

/** Runs against an isolated QA browser; never loads customer data or sends a model request. */
export async function verifyTimelineConversationSwitching(page: Page) {
  const errors: string[] = [];
  const onError = (error: Error) => errors.push(error.message);
  page.on('pageerror', onError);
  try {
    const ids = await page.evaluate(async () => {
      const chatPath = '/src/stores/chatStore.ts';
      const { useChatStore } = await import(chatPath) as typeof import('../src/stores/chatStore');
      const ids = await Promise.all([3, 26, 9, 20].map(async (count, index) => {
        const id = useChatStore.getState().createConversation('pharos');
        useChatStore.getState().replaceConversationMessages((await useChatStore.getState().ensureConversationWritable(id))!, Array.from({ length: count }, (_, row) => ({
          id: `timeline-qa-${index}-${row}`,
          role: row % 2 ? 'assistant' as const : 'user' as const,
          content: `Reading regression ${index} / ${row}\n\n${'A complete paragraph for stable reading. '.repeat(row % 3 ? 4 : 40)}`,
          timestamp: Date.now() + row
        })));
        return id;
      }));
      return ids;
    });
    for (const id of [...ids, ...ids, ...ids]) {
      await page.evaluate(async (id) => {
        const chatPath = '/src/stores/chatStore.ts';
        const { useChatStore } = await import(chatPath) as typeof import('../src/stores/chatStore');
        useChatStore.getState().setActiveConversation(id);
      }, id);
      await page.waitForSelector('.chat-flow [data-message-id]', { timeout: 10_000 });
      await page.waitForTimeout(150);
      if (await page.locator('.world-frame-recovery').count()) break;
      await page.locator('.chat-flow').evaluate((flow) => { flow.scrollTop -= 400; });
    }
    const recoveryVisible = await page.locator('.world-frame-recovery').count() > 0;
    return { passed: errors.length === 0 && !recoveryVisible, errors, recoveryVisible, switches: ids.length * 3 };
  } finally {
    page.off('pageerror', onError);
  }
}

async function settleTimeline(page: Page) {
  await page.locator('.chat-flow').evaluate(async (flow) => {
    let previous = '';
    let stable = 0;
    for (let frame = 0; frame < 180 && stable < 6; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const geometry = `${flow.scrollTop}:${flow.scrollHeight}:${flow.querySelectorAll('[data-message-id]').length}`;
      stable = geometry === previous ? stable + 1 : 0;
      previous = geometry;
    }
    if (stable < 6) throw new Error('Timeline geometry did not settle');
  });
}

/** Reproduce a scroll that precedes its event, then commits new rows in that frame. */
export async function verifyTimelineScrollCommitRace(page: Page) {
  const ids = await page.evaluate(async () => {
    const path = '/src/stores/chatStore.ts';
    const { useChatStore } = await import(path) as typeof import('../src/stores/chatStore');
    return Promise.all([300, 6].map(async (count, index) => {
      const id = useChatStore.getState().createConversation('pharos');
      useChatStore.getState().replaceConversationMessages((await useChatStore.getState().ensureConversationWritable(id))!, Array.from({ length: count }, (_, row) => ({
        id: `commit-qa-${index}-${row}`,
        role: row % 2 ? 'assistant' as const : 'user' as const,
        content: `Message ${row}\n\n${'A complete paragraph for reading. '.repeat(row % 7 ? 3 : 150)}`,
        timestamp: Date.now() + row
      })));
      return id;
    }));
  });
  const activate = async (id: string) => {
    await page.evaluate(async (id) => {
      const path = '/src/stores/chatStore.ts';
      const { useChatStore } = await import(path) as typeof import('../src/stores/chatStore');
      useChatStore.getState().setActiveConversation(id);
    }, id);
    await settleTimeline(page);
  };
  await activate(ids[0]);
  await page.locator('.chat-flow').evaluate((flow) => { flow.scrollTop -= 4000; });
  await settleTimeline(page);
  const runRace = () => page.evaluate(async () => {
    const path = '/src/stores/chatStore.ts';
    const reactPath = performance.getEntriesByType('resource').map(entry => entry.name)
      .find(name => new URL(name).pathname.endsWith('/deps/react-dom.js'));
    if (!reactPath) throw new Error('The app React DOM dependency has not loaded');
    const { useChatStore } = await import(path) as typeof import('../src/stores/chatStore');
    const react = await import(reactPath);
    const flushSync = (react.flushSync ?? react.default.flushSync) as typeof import('react-dom')['flushSync'];
    const flow = document.querySelector<HTMLDivElement>('.chat-flow')!;
    const row = Array.from(flow.querySelectorAll<HTMLElement>('[data-message-id]'))
      .find((row) => row.getBoundingClientRect().bottom > flow.getBoundingClientRect().top)!;
    flow.dispatchEvent(new WheelEvent('wheel', { deltaY: -80, bubbles: true }));
    flow.scrollTop -= 80;
    const expected = row.getBoundingClientRect().top;
    const state = useChatStore.getState();
    const id = state.activeConversationId!;
    const messages = state.conversations.find((conversation) => conversation.id === id)!.messages;
    const writable = await state.ensureConversationWritable(id);
    if (!writable) throw new Error('QA conversation did not become writable');
    flushSync(() => state.replaceConversationMessages(writable, [...messages, {
      id: `commit-qa-tool-${messages.length}`, role: 'system', origin: 'tool-runtime',
      content: 'Read a synthetic card', timestamp: Date.now(),
      toolInvocation: {
        id: `commit-qa-tool-${messages.length}`, kind: 'readCodeCard', status: 'executed',
        title: 'Read card', summary: 'Read a synthetic card', originMessageId: messages[messages.length - 1]!.id
      }
    }, ...Array.from({ length: 10 }, (_, index) => ({
      id: `commit-qa-appended-${messages.length}-${index}`, role: 'assistant' as const, content: 'New paragraph', timestamp: Date.now() + index
    }))]));
    return { expected, actual: row.getBoundingClientRect().top };
  });
  const race = await runRace();
  await settleTimeline(page);
  const position = await page.locator('.chat-flow').evaluate((flow) => {
    const top = flow.getBoundingClientRect().top;
    const row = Array.from(flow.querySelectorAll<HTMLElement>('[data-message-id]'))
      .find((row) => row.getBoundingClientRect().bottom > top)!;
    return { messageId: row.dataset.messageId!, offset: row.getBoundingClientRect().top - top };
  });
  await activate(ids[1]);
  await activate(ids[0]);
  const restoredOffset = await page.locator('.chat-flow').evaluate((flow, position) => {
    const row = Array.from(flow.querySelectorAll<HTMLElement>('[data-message-id]'))
      .find((row) => row.dataset.messageId === position.messageId);
    return row ? row.getBoundingClientRect().top - flow.getBoundingClientRect().top : null;
  }, position);
  await page.locator('.chat-jump-latest-btn:not(.chat-jump-top-btn)').click();
  await settleTimeline(page);
  const bottomDistance = await page.locator('.chat-flow').evaluate((flow) => flow.scrollHeight - flow.clientHeight - flow.scrollTop);
  const fromBottomRace = await runRace();
  await settleTimeline(page);
  await activate(ids[1]);
  await page.locator('[data-message-id="commit-qa-1-4"] .bubble').dispatchEvent('contextmenu');
  await page.getByRole('menuitem', { name: '编辑并重发', exact: true }).click();
  const editor = page.locator('.message-edit-input');
  const draft = Array.from({ length: 40 }, (_, index) => `Edited line ${index}`).join('\n');
  await editor.fill(draft);
  await settleTimeline(page);
  const editingRetained = await editor.inputValue() === draft;
  await page.locator('.message-edit-panel').getByRole('button', { name: '取消', exact: true }).click();
  await settleTimeline(page);
  const editingEnded = await editor.count() === 0;
  return {
    passed: editingRetained && editingEnded && Math.abs(fromBottomRace.actual - fromBottomRace.expected) < 1 && Math.abs(race.actual - race.expected) < 1
      && restoredOffset !== null && Math.abs(restoredOffset - position.offset) < 1 && bottomDistance <= 1,
    race, fromBottomRace, position, restoredOffset, bottomDistance, editingRetained, editingEnded
  };
}
