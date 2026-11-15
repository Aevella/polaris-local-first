const ROOM_BRIDGE_SCRIPT_TEMPLATE = String.raw`<script>
(function () {
  var ROOM_ID = __POLARIS_ROOM_ID__;
  var INITIAL_STATE = __POLARIS_INITIAL_STATE__;
  var BRIDGE_SOURCE = 'polaris-room-bridge';
  var HOST_SOURCE = 'polaris-room-host';
  var FORM_BUCKET_KEY = '__polarisForm';
  var LOCAL_STORAGE_BUCKET_KEY = '__polarisStorage';
  var SESSION_STORAGE_BUCKET_KEY = '__polarisSessionStorage';
  var listeners = [];
  var ready = false;
  var readyResolvers = [];
  var lifecycleFlushActive = false;
  var revision = 0;
  var composingElements = new WeakSet();
  var roomState = normalizeState(INITIAL_STATE);

  function clone(value) {
    try {
      return JSON.parse(JSON.stringify(value ?? {}));
    } catch (_error) {
      return {};
    }
  }

  function normalizeState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return clone(value);
  }

  function getFormBucket() {
    var nextState = normalizeState(roomState);
    var fields = nextState[FORM_BUCKET_KEY];
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      fields = {};
    } else {
      fields = clone(fields);
    }
    nextState[FORM_BUCKET_KEY] = fields;
    roomState = nextState;
    return fields;
  }

  function getStorageBucket(bucketKey) {
    var nextState = normalizeState(roomState);
    var storage = nextState[bucketKey];
    if (!storage || typeof storage !== 'object' || Array.isArray(storage)) {
      storage = {};
    } else {
      storage = clone(storage);
    }
    nextState[bucketKey] = storage;
    roomState = nextState;
    return storage;
  }

  function normalizeStorageValue(value) {
    return value === undefined || value === null ? String(value) : String(value);
  }

  function persistStorageBucket(bucketKey, nextStorage) {
    var nextState = normalizeState(roomState);
    nextState[bucketKey] = clone(nextStorage);
    roomState = nextState;
    emitState();
    persistState();
  }

  function dispatch(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail: detail }));
  }

  function emitState() {
    var snapshot = api.getState();
    syncPersistedFields(document);
    listeners.slice().forEach(function (listener) {
      try {
        listener(snapshot);
      } catch (_error) {
      }
    });
    dispatch('polaris-room-state', snapshot);
  }

  function resolveReady() {
    var snapshot = api.getState();
    readyResolvers.splice(0).forEach(function (resolve) {
      resolve(snapshot);
    });
    dispatch('polaris-room-ready', snapshot);
  }

  function postToHost(type, payload) {
    parent.postMessage(Object.assign({
      source: BRIDGE_SOURCE,
      roomId: ROOM_ID,
      type: type
    }, payload || {}), '*');
  }

  function shouldFlushImmediately() {
    return lifecycleFlushActive || document.hidden === true || document.visibilityState === 'hidden';
  }

  function persistState(options) {
    revision += 1;
    postToHost('save', {
      revision: revision,
      state: api.getState(),
      flush: Boolean(options && options.flush) || shouldFlushImmediately()
    });
  }

  function flushStateForPageLifecycle() {
    lifecycleFlushActive = true;
    persistState({ flush: true });
    setTimeout(function () {
      lifecycleFlushActive = false;
    }, 0);
  }

  function installStorageShim(propertyName, bucketKey) {
    var storageApi = {
      getItem: function (key) {
        if (key === undefined || key === null) return null;
        var storage = getStorageBucket(bucketKey);
        var normalizedKey = String(key);
        return Object.prototype.hasOwnProperty.call(storage, normalizedKey)
          ? normalizeStorageValue(storage[normalizedKey])
          : null;
      },
      setItem: function (key, value) {
        if (key === undefined || key === null) return;
        var storage = getStorageBucket(bucketKey);
        storage[String(key)] = normalizeStorageValue(value);
        persistStorageBucket(bucketKey, storage);
      },
      removeItem: function (key) {
        if (key === undefined || key === null) return;
        var storage = getStorageBucket(bucketKey);
        delete storage[String(key)];
        persistStorageBucket(bucketKey, storage);
      },
      clear: function () {
        persistStorageBucket(bucketKey, {});
      },
      key: function (index) {
        var keys = Object.keys(getStorageBucket(bucketKey));
        return index >= 0 && index < keys.length ? keys[index] : null;
      }
    };

    Object.defineProperty(storageApi, 'length', {
      get: function () {
        return Object.keys(getStorageBucket(bucketKey)).length;
      }
    });

    try {
      Object.defineProperty(window, propertyName, {
        configurable: true,
        enumerable: true,
        writable: false,
        value: storageApi
      });
    } catch (_error) {
      try {
        window[propertyName] = storageApi;
      } catch (_secondaryError) {
      }
    }
  }

  function getPersistKey(element) {
    var explicitKey = element.getAttribute('data-polaris-persist') || element.getAttribute('name') || element.id;
    if (explicitKey) return explicitKey;

    if (element.dataset.polarisAutoKey) return element.dataset.polarisAutoKey;

    var elements = document.querySelectorAll('textarea, input, select, [contenteditable=""], [contenteditable="true"]');
    var index = Array.prototype.indexOf.call(elements, element);
    var nextKey = 'auto:' + element.tagName.toLowerCase() + ':' + String(index >= 0 ? index : 0);
    element.dataset.polarisAutoKey = nextKey;
    return nextKey;
  }

  function readElementValue(element) {
    if (element instanceof HTMLInputElement) {
      if (element.type === 'checkbox') return element.checked;
      if (element.type === 'radio') return element.checked ? element.value : undefined;
      return element.value;
    }

    if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      return element.value;
    }

    if (element.isContentEditable) {
      return element.innerHTML;
    }

    return undefined;
  }

  function writeElementValue(element, value) {
    if (value === undefined || composingElements.has(element)) return;

    if (element instanceof HTMLInputElement) {
      if (element.type === 'checkbox') {
        if (element.checked !== Boolean(value)) element.checked = Boolean(value);
        return;
      }

      if (element.type === 'radio') {
        var checked = String(value) === element.value;
        if (element.checked !== checked) element.checked = checked;
        return;
      }

      if (element.value !== String(value)) element.value = String(value);
      return;
    }

    if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      if (element.value !== String(value)) element.value = String(value);
      return;
    }

    if (element.isContentEditable) {
      if (element.innerHTML !== String(value)) element.innerHTML = String(value);
    }
  }

  function syncElementFromState(element) {
    if (!(element instanceof HTMLElement)) return;
    var key = getPersistKey(element);
    if (!key) return;

    var fields = getFormBucket();
    if (!Object.prototype.hasOwnProperty.call(fields, key)) return;
    writeElementValue(element, fields[key]);
  }

  function bindElement(element) {
    if (!(element instanceof HTMLElement)) return;
    var key = getPersistKey(element);
    if (!key || element.dataset.polarisPersistBound === '1') return;

    element.dataset.polarisPersistBound = '1';
    syncElementFromState(element);

    var handleInput = function (event) {
      if (composingElements.has(element) || (event && event.isComposing)) return;
      var nextValue = readElementValue(element);
      if (nextValue === undefined) return;

      var nextFields = getFormBucket();
      if (nextFields[key] === nextValue) return;
      nextFields[key] = nextValue;
      persistState();
    };

    element.addEventListener('input', handleInput);
    element.addEventListener('change', handleInput);
    element.addEventListener('compositionstart', function () {
      composingElements.add(element);
    });
    element.addEventListener('compositionend', function () {
      composingElements.delete(element);
      handleInput();
    });
  }

  function syncPersistedFields(root) {
    if (!root) return;

    if (root instanceof HTMLElement) {
      syncElementFromState(root);
      bindElement(root);
    }

    var elements = root.querySelectorAll
      ? root.querySelectorAll('textarea, input, select, [contenteditable=""], [contenteditable="true"]')
      : [];
    Array.prototype.forEach.call(elements, function (element) {
      syncElementFromState(element);
      bindElement(element);
    });
  }

  var api = {
    id: ROOM_ID,
    getState: function () {
      return normalizeState(roomState);
    },
    setState: function (nextState) {
      roomState = normalizeState(nextState);
      emitState();
      persistState();
      return api.getState();
    },
    patchState: function (patch) {
      roomState = Object.assign({}, normalizeState(roomState), normalizeState(patch));
      emitState();
      persistState();
      return api.getState();
    },
    save: function () {
      persistState();
    },
    whenReady: function () {
      return ready
        ? Promise.resolve(api.getState())
        : new Promise(function (resolve) {
            readyResolvers.push(resolve);
          });
    },
    subscribe: function (listener) {
      listeners.push(listener);
      return function () {
        listeners = listeners.filter(function (entry) {
          return entry !== listener;
        });
      };
    }
  };

  installStorageShim('localStorage', LOCAL_STORAGE_BUCKET_KEY);
  installStorageShim('sessionStorage', SESSION_STORAGE_BUCKET_KEY);
  window.PolarisRoom = api;

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.source !== HOST_SOURCE || data.roomId !== ROOM_ID) return;
    if (data.type !== 'hydrate') return;
    // A host message queued before a newer local save cannot replace that edit.
    if (data.revision === undefined || data.revision >= revision) {
      roomState = normalizeState(data.state);
      emitState();
    }
    if (!ready) {
      ready = true;
      resolveReady();
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden || document.visibilityState === 'hidden') {
      flushStateForPageLifecycle();
    }
  });
  window.addEventListener('pagehide', flushStateForPageLifecycle);
  window.addEventListener('beforeunload', flushStateForPageLifecycle);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      syncPersistedFields(document);
    }, { once: true });
  } else {
    syncPersistedFields(document);
  }

  if (typeof MutationObserver !== 'undefined') {
    var observer = new MutationObserver(function (records) {
      records.forEach(function (record) {
        Array.prototype.forEach.call(record.addedNodes, function (node) {
          if (!(node instanceof HTMLElement)) return;
          syncPersistedFields(node);
        });
      });
    });
    observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
  }

  postToHost('ready');
})();
</script>`;

function buildRoomBridgeScript(cardId: string, initialState: unknown) {
  const serializedInitialState = JSON.stringify(initialState ?? {}).replace(/<\/script/gi, '<\\/script');
  return ROOM_BRIDGE_SCRIPT_TEMPLATE
    .replace('__POLARIS_ROOM_ID__', JSON.stringify(cardId))
    .replace('__POLARIS_INITIAL_STATE__', serializedInitialState);
}

function injectAfterOpeningTag(source: string, tagName: string, injection: string) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>`, 'i');
  const match = source.match(pattern);
  if (!match || match.index === undefined) return null;
  const insertAt = match.index + match[0].length;
  return `${source.slice(0, insertAt)}${injection}${source.slice(insertAt)}`;
}

export function injectRoomPreviewBridge(srcDoc: string, cardId: string, initialState?: unknown) {
  const trimmed = srcDoc.trim();
  if (!trimmed) return srcDoc;

  const script = buildRoomBridgeScript(cardId, initialState);

  return (
    injectAfterOpeningTag(trimmed, 'head', script)
    ?? injectAfterOpeningTag(trimmed, 'body', script)
    ?? `${script}${trimmed}`
  );
}
