import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { injectRoomPreviewBridge } from './roomPreviewBridge';

type SavedMessage = { type: string; revision: number; state: Record<string, unknown>; flush?: boolean };

function runBridge(fieldType: 'input' | 'textarea' | 'editable' = 'input') {
  class Element {
    id = 'note';
    dataset: Record<string, string> = {};
    isContentEditable = false;
    writes: string[] = [];
    text = '';
    handlers = new Map<string, (event?: { isComposing?: boolean }) => void>();
    getAttribute() { return null; }
    addEventListener(name: string, handler: (event?: { isComposing?: boolean }) => void) {
      this.handlers.set(name, handler);
    }
    get innerHTML() { return this.text; }
    set innerHTML(value: string) { this.writes.push(value); this.text = value; }
    fire(name: string, event?: { isComposing?: boolean }) { this.handlers.get(name)?.(event); }
  }
  class Input extends Element {
    type = 'text';
    get value() { return this.text; }
    set value(value: string) { this.writes.push(value); this.text = value; }
  }
  class TextArea extends Input {}
  const field = fieldType === 'editable' ? new Element() : fieldType === 'textarea' ? new TextArea() : new Input();
  field.isContentEditable = fieldType === 'editable';
  const messages: SavedMessage[] = [];
  const listeners = new Map<string, (event: unknown) => void>();
  const window = {
    addEventListener(name: string, handler: (event: unknown) => void) { listeners.set(name, handler); },
    dispatchEvent() {},
    PolarisRoom: null as unknown as { patchState: (state: unknown) => void; whenReady: () => Promise<unknown> },
    localStorage: null as unknown as Storage
  };
  const html = injectRoomPreviewBridge('<head></head>', 'room');
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)![1], {
    window,
    document: { readyState: 'complete', querySelectorAll: () => [field], addEventListener() {} },
    parent: { postMessage(message: SavedMessage) { messages.push(message); } },
    HTMLElement: Element, HTMLInputElement: Input, HTMLTextAreaElement: TextArea,
    HTMLSelectElement: class extends Element {}, MutationObserver: undefined,
    CustomEvent: class {}, setTimeout() {}
  });
  return {
    field, window,
    saves: () => messages.filter(message => message.type === 'save'),
    hydrate(state: unknown, revision = 0) {
      listeners.get('message')?.({ data: { source: 'polaris-room-host', roomId: 'room', type: 'hydrate', state, revision } });
    },
    pagehide() { listeners.get('pagehide')?.({}); }
  };
}

describe('room preview input persistence', () => {
  for (const fieldType of ['input', 'textarea', 'editable'] as const) {
    it(`preserves ${fieldType} composition through hydration and storage writes, then saves committed text`, () => {
      const bridge = runBridge(fieldType);
      bridge.hydrate({ __polarisForm: { note: 'old' } });
      bridge.field.writes.length = 0;
      bridge.field.fire('compositionstart');
      bridge.field.text = 'ni';
      bridge.field.fire('input', { isComposing: true });
      expect(bridge.saves()).toHaveLength(0);
      bridge.hydrate({ __polarisForm: { note: 'remote' } });
      bridge.window.localStorage.setItem('other', 'value');
      expect(bridge.field.text).toBe('ni');
      expect(bridge.field.writes).toEqual([]);
      bridge.field.text = '你';
      bridge.field.fire('compositionend');
      bridge.field.fire('input');
      expect(bridge.saves()).toHaveLength(2); // storage write, then committed form
      expect(bridge.saves()[bridge.saves().length - 1]?.state).toMatchObject({ __polarisForm: { note: '你' } });
    });
  }

  it('does not assign identical field values or disturb the selection on repeated hydration', () => {
    const bridge = runBridge();
    bridge.hydrate({ __polarisForm: { note: 'hello' } });
    bridge.field.writes.length = 0;
    bridge.hydrate({ __polarisForm: { note: 'hello' } });
    expect(bridge.field.writes).toEqual([]);
    bridge.hydrate({ __polarisForm: { note: 'updated externally' } });
    expect(bridge.field.text).toBe('updated externally');
    expect(bridge.field.writes).toEqual(['updated externally']);
  });

  it('rejects an old queued hydrate after a newer local save while still completing readiness', async () => {
    const bridge = runBridge();
    bridge.field.text = 'ni';
    bridge.field.fire('input');
    const first = bridge.saves()[0];
    bridge.field.text = 'nih';
    bridge.field.fire('input');
    const latest = bridge.saves()[1];
    bridge.hydrate(first.state, first.revision);
    expect(bridge.field.text).toBe('nih');
    await expect(bridge.window.PolarisRoom.whenReady()).resolves.toMatchObject({ __polarisForm: { note: 'nih' } });
    bridge.hydrate({ __polarisForm: { note: 'external update' } }, latest.revision);
    expect(bridge.field.text).toBe('external update');
  });

  it('flushes the final committed text and storage on page exit', () => {
    const bridge = runBridge();
    bridge.field.fire('compositionstart');
    bridge.field.text = '你好';
    bridge.field.fire('compositionend');
    bridge.window.localStorage.setItem('draft', 'saved');
    bridge.pagehide();
    expect(bridge.saves()[bridge.saves().length - 1]).toMatchObject({
      flush: true, state: { __polarisForm: { note: '你好' }, __polarisStorage: { draft: 'saved' } }
    });
  });
});
