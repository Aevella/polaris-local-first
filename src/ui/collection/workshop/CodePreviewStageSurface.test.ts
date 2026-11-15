import { describe, it, expect, vi, afterEach } from 'vitest';

const harness = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  postMessage: vi.fn(),
  subscribe: vi.fn(),
  update: vi.fn(),
  flush: vi.fn(),
  ensure: vi.fn(),
  cached: vi.fn()
}));
vi.mock('react', () => ({
  useEffect: (effect: () => void | (() => void)) => harness.effects.push(effect),
  useMemo: (build: () => unknown) => build(),
  useRef: () => ({ current: { contentWindow: { postMessage: harness.postMessage } } }),
  useState: () => ['<head></head>', vi.fn()]
}));
vi.mock('../../../engines/roomStatePersistence', () => ({
  subscribeRoomState: harness.subscribe, updateRoomState: harness.update,
  flushRoomState: harness.flush, ensureRoomState: harness.ensure, getCachedRoomState: harness.cached
}));
vi.mock('../../../i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
import { CodePreviewStageSurface } from './CodePreviewStageSurface';

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); harness.effects.length = 0; });

describe('CodePreviewStageSurface room synchronization', () => {
  it('reads the current cache when startup loading completes after a frame save', async () => {
    const listeners = new Map<string, (event: MessageEvent) => void>();
    vi.stubGlobal('window', {
      addEventListener: (name: string, listener: (event: MessageEvent) => void) => listeners.set(name, listener),
      removeEventListener: (name: string) => listeners.delete(name)
    });
    harness.subscribe.mockReturnValue(vi.fn());
    harness.ensure.mockResolvedValue({ draft: 'old disk value' });
    harness.cached.mockReturnValue({ draft: 'old disk value' });
    harness.update.mockImplementation((_room, state) => harness.cached.mockReturnValue(state));
    const view = CodePreviewStageSurface({ cardId: 'room', title: 'Room', frameTitle: 'Room', srcDoc: '<head></head>', code: '' });
    const cleanup = harness.effects[1]();
    const source = view.props.children.ref.current.contentWindow;
    listeners.get('message')?.({ source, data: { source: 'polaris-room-bridge', roomId: 'room', type: 'save', revision: 1, state: { draft: 'new input' } } } as MessageEvent);
    await Promise.resolve();
    expect(harness.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 1, state: { draft: 'new input' } }), '*');
    if (typeof cleanup === 'function') cleanup();
  });

  it('persists iframe saves without echoing them, forwards external changes and flushes on exit', async () => {
    const listeners = new Map<string, (event: MessageEvent) => void>();
    vi.stubGlobal('window', {
      addEventListener: (name: string, listener: (event: MessageEvent) => void) => listeners.set(name, listener),
      removeEventListener: (name: string) => listeners.delete(name)
    });
    let notify = (_state: unknown) => {};
    const unsubscribe = vi.fn();
    harness.subscribe.mockImplementation((_room, listener) => { notify = listener; return unsubscribe; });
    harness.ensure.mockResolvedValue({ loaded: true });
    harness.cached.mockReturnValue({ loaded: true });
    harness.update.mockImplementation((_room, state) => notify(state));
    const view = CodePreviewStageSurface({ cardId: 'room', title: 'Room', frameTitle: 'Room', srcDoc: '<head></head>', code: '' });
    const cleanup = harness.effects[1]();
    await Promise.resolve();
    expect(harness.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 0, state: { loaded: true } }), '*');
    harness.postMessage.mockClear();
    const source = view.props.children.ref.current.contentWindow;
    listeners.get('message')?.({ source, data: { source: 'polaris-room-bridge', roomId: 'room', type: 'save', revision: 2, state: { draft: '你' }, flush: true } } as MessageEvent);
    expect(harness.update).toHaveBeenCalledWith('room', { draft: '你' });
    expect(harness.postMessage).not.toHaveBeenCalled();
    expect(harness.flush).toHaveBeenCalledWith('room');
    notify({ draft: 'external' });
    expect(harness.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 2, state: { draft: 'external' } }), '*');
    if (typeof cleanup === 'function') cleanup();
    expect(unsubscribe).toHaveBeenCalled();
    expect(listeners.has('message')).toBe(false);
  });
});
