import { afterEach, describe, expect, it, vi } from 'vitest';
import { installBootRescueSurface } from './bootRescueSurface';

type FakeEventListener = (event: unknown) => void;

class FakeElement {
  tagName: string;
  className = '';
  textContent = '';
  hidden = false;
  disabled = false;
  type = '';
  href = '';
  download = '';
  children: FakeElement[] = [];
  private listeners = new Map<string, FakeEventListener[]>();

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  get childElementCount() {
    return this.children.length;
  }

  setAttribute() {
    return undefined;
  }

  append(...nodes: FakeElement[]) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes: FakeElement[]) {
    this.children = [...nodes];
    this.textContent = '';
  }

  addEventListener(type: string, listener: FakeEventListener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  click() {
    for (const listener of this.listeners.get('click') ?? []) {
      listener({});
    }
  }
}

function collectText(node: FakeElement): string {
  return [node.textContent, ...node.children.map(collectText)].filter(Boolean).join('\n');
}

function findButton(root: FakeElement, label: string): FakeElement | null {
  if (root.tagName === 'button' && root.textContent === label) return root;
  for (const child of root.children) {
    const found = findButton(child, label);
    if (found) return found;
  }
  return null;
}

function createBrowserGlobals() {
  const listeners = new Map<string, FakeEventListener[]>();
  const root = new FakeElement('div');
  const windowMock = {
    addEventListener: vi.fn((type: string, listener: FakeEventListener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    }),
    removeEventListener: vi.fn((type: string, listener: FakeEventListener) => {
      listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== listener));
    }),
    setTimeout: (handler: TimerHandler, timeout?: number) => setTimeout(handler, timeout),
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
    location: {
      reload: vi.fn()
    },
    URL: {
      createObjectURL: vi.fn(() => 'blob:polaris'),
      revokeObjectURL: vi.fn()
    }
  };
  const documentMock = {
    createElement: vi.fn((tagName: string) => new FakeElement(tagName)),
    getElementById: vi.fn(() => root)
  };

  vi.stubGlobal('window', windowMock);
  vi.stubGlobal('document', documentMock);

  return {
    root,
    emit: (type: string, event: unknown) => {
      for (const listener of listeners.get(type) ?? []) {
        listener(event);
      }
    }
  };
}

describe('installBootRescueSurface', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not turn slow startup into a data warning', () => {
    vi.useFakeTimers();
    const { root } = createBrowserGlobals();
    const rescue = installBootRescueSurface({ root: root as unknown as HTMLElement });
    rescue.watchReactRoot();
    vi.advanceTimersByTime(60000);
    expect(root.childElementCount).toBe(0);
    rescue.dispose();
  });

  it('offers reload after an actual startup failure', () => {
    const { root, emit } = createBrowserGlobals();
    const rescue = installBootRescueSurface({ root: root as unknown as HTMLElement });
    emit('error', { error: new Error('module load failed') });
    expect(collectText(root)).toContain('应用没有打开');
    findButton(root, '重新打开')?.click();
    expect(window.location.reload).toHaveBeenCalledOnce();
    rescue.dispose();
  });

  it('does not replace the root after React content has mounted', () => {
    vi.useFakeTimers();
    const { root, emit } = createBrowserGlobals();
    const mounted = new FakeElement('main');
    mounted.textContent = 'Polaris 已挂载';
    root.replaceChildren(mounted);

    const rescue = installBootRescueSurface({ root: root as unknown as HTMLElement });
    rescue.watchReactRoot();
    emit('error', { error: new Error('late render crash') });
    vi.advanceTimersByTime(10);

    expect(collectText(root)).toBe('Polaris 已挂载');
  });

  it('does not mistake an early post-mount rejection for a boot failure', () => {
    vi.useFakeTimers();
    const { root, emit } = createBrowserGlobals();
    const rescue = installBootRescueSurface({ root: root as unknown as HTMLElement });
    const mounted = new FakeElement('main');
    mounted.textContent = 'Polaris 已挂载';
    root.replaceChildren(mounted);

    emit('unhandledrejection', { reason: new Error('optional native plugin unavailable') });
    rescue.watchReactRoot();
    vi.advanceTimersByTime(10);

    expect(collectText(root)).toBe('Polaris 已挂载');
  });

  it('keeps the rescue card alive when persisted backup export fails', async () => {
    vi.useFakeTimers();
    const { root, emit } = createBrowserGlobals();
    const exportPersistedBackup = vi.fn(async () => {
      throw new Error('IndexedDB read failed');
    });

    installBootRescueSurface({
      root: root as unknown as HTMLElement,
      exportPersistedBackup
    });
    emit('error', { error: new Error('boot failed') });
    findButton(root, '导出本机数据')?.click();
    await vi.runAllTicks();

    expect(exportPersistedBackup).toHaveBeenCalledTimes(1);
    expect(collectText(root)).toContain('应用没有打开');
    expect(collectText(root)).toContain('IndexedDB read failed');
  });
});
