import { useLayoutEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../../../types/domain';
import { useTimelineInsertCompensation } from '../useTimelineInsertCompensation';

const BOTTOM_THRESHOLD = 36;
const JUMP_THRESHOLD = 300;
const TOP_JUMP_THRESHOLD = 300;
const USER_REPLY_STAGE_TOP_OFFSET = 18;
const PROGRAMMATIC_SCROLL_GUARD_MS = 160;
const PROGRAMMATIC_SMOOTH_SCROLL_GUARD_MS = 420;
const MAX_SMOOTH_JUMP_VIEWPORTS = 2;

export type FollowMode = 'bottom' | 'reply-stage' | 'manual';

type TimelineScrollArgs = {
  conversationId: string | null;
  messages: ChatMessage[];
  isGenerationActive: boolean;
  isActiveWorld: boolean;
  isWorldSettled: boolean;
};

function isAtBottom(container: HTMLDivElement) {
  return getMaxScrollTop(container) - container.scrollTop <= BOTTOM_THRESHOLD;
}

function shouldShowJumpToTop(container: HTMLDivElement) {
  return container.scrollTop > TOP_JUMP_THRESHOLD;
}

function shouldShowJumpToLatest(container: HTMLDivElement) {
  return getMaxScrollTop(container) - container.scrollTop > JUMP_THRESHOLD;
}

function getMaxScrollTop(container: HTMLDivElement) {
  return Math.max(0, container.scrollHeight - container.clientHeight);
}

export function resolveReplyStageScrollTop(args: {
  rowOffsetTop: number;
  maxScrollTop: number;
}) {
  return Math.min(
    Math.max(0, args.rowOffsetTop - USER_REPLY_STAGE_TOP_OFFSET),
    args.maxScrollTop
  );
}

export function resolveTimelineJumpBehavior(args: {
  currentTop: number;
  targetTop: number;
  viewportHeight: number;
}): ScrollBehavior {
  if (args.viewportHeight <= 0) return 'auto';
  return Math.abs(args.targetTop - args.currentTop) <= args.viewportHeight * MAX_SMOOTH_JUMP_VIEWPORTS
    ? 'smooth'
    : 'auto';
}

function getLatestMessageId(messages: ChatMessage[]) {
  return messages[messages.length - 1]?.id ?? null;
}

function getLatestUserMessageId(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user' && !message.toolInvocation) {
      return message.id;
    }
  }
  return null;
}

function findMessageRow(container: HTMLDivElement, messageId: string) {
  const rows = container.querySelectorAll<HTMLElement>('[data-message-id]');
  for (const row of rows) {
    if (row.dataset.messageId === messageId) return row;
  }
  return null;
}

function runWithInstantScroll(container: HTMLDivElement, action: () => void) {
  const previousBehavior = container.style.scrollBehavior;
  container.style.scrollBehavior = 'auto';
  action();
  window.requestAnimationFrame(() => {
    if (container.style.scrollBehavior === 'auto') {
      container.style.scrollBehavior = previousBehavior;
    }
  });
}

type ConversationScrollSnapshot = {
  bottomOffset: number;
  followMode: FollowMode;
  replyStageMessageId: string | null;
};

const conversationScrollSnapshots = new Map<string, ConversationScrollSnapshot>();

export function normalizePersistedFollowMode(mode: FollowMode, isGenerationActive: boolean): FollowMode {
  void isGenerationActive;
  return mode;
}

function readConversationScrollSnapshot(conversationId: string | null) {
  return conversationId ? conversationScrollSnapshots.get(conversationId) ?? null : null;
}

export function useTimelineScroll({
  conversationId,
  messages,
  isGenerationActive,
  isActiveWorld,
  isWorldSettled
}: TimelineScrollArgs) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousConversationIdRef = useRef<string | null>(null);
  const previousActiveWorldRef = useRef(isActiveWorld);
  const previousWorldSettledRef = useRef(isWorldSettled);
  const previousGenerationActiveRef = useRef(isGenerationActive);
  const previousLatestMessageIdRef = useRef<string | null>(getLatestMessageId(messages));
  const previousLatestUserMessageIdRef = useRef<string | null>(getLatestUserMessageId(messages));
  const suppressNextLiveScrollAnimationRef = useRef(false);
  const pendingManualModeRestoreRef = useRef(false);
  const pendingReplyStageMessageIdRef = useRef<string | null>(null);
  const ignoreProgrammaticScrollUntilRef = useRef(0);
  const lastProgrammaticScrollTopRef = useRef<number | null>(null);
  const programmaticScrollBehaviorRef = useRef<ScrollBehavior | null>(null);
  const [followMode, setFollowMode] = useState<FollowMode>('bottom');
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [showJumpToTop, setShowJumpToTop] = useState(false);

  const updateJumpButtons = (container: HTMLDivElement, options?: { latest?: boolean }) => {
    if (options?.latest !== undefined) {
      setShowJumpToLatest(options.latest);
    } else {
      setShowJumpToLatest(shouldShowJumpToLatest(container));
    }
    setShowJumpToTop(shouldShowJumpToTop(container));
  };

  const guardProgrammaticScroll = (
    targetTop: number,
    behavior: ScrollBehavior = 'auto',
    durationMs = PROGRAMMATIC_SCROLL_GUARD_MS
  ) => {
    lastProgrammaticScrollTopRef.current = targetTop;
    programmaticScrollBehaviorRef.current = behavior;
    ignoreProgrammaticScrollUntilRef.current = window.performance.now() + durationMs;
  };

  const scrollToBottom = (behavior: ScrollBehavior) => {
    const container = containerRef.current;
    if (!container) return;
    const top = container.scrollHeight - container.clientHeight;
    setShowJumpToTop(top > TOP_JUMP_THRESHOLD);
    if (behavior === 'smooth') {
      guardProgrammaticScroll(top, 'smooth', PROGRAMMATIC_SMOOTH_SCROLL_GUARD_MS);
      container.scrollTo({ top, behavior: 'smooth' });
      return;
    }
    guardProgrammaticScroll(top);
    runWithInstantScroll(container, () => {
      container.scrollTop = top;
    });
    updateJumpButtons(container, { latest: false });
  };

  const scrollToTop = (behavior: ScrollBehavior) => {
    const container = containerRef.current;
    if (!container) return;
    guardProgrammaticScroll(0, behavior, behavior === 'smooth' ? PROGRAMMATIC_SMOOTH_SCROLL_GUARD_MS : PROGRAMMATIC_SCROLL_GUARD_MS);
    if (behavior === 'smooth') {
      container.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    runWithInstantScroll(container, () => {
      container.scrollTop = 0;
    });
    updateJumpButtons(container, { latest: shouldShowJumpToLatest(container) });
  };

  const scrollMessageToReplyStage = (messageId: string) => {
    const container = containerRef.current;
    if (!container) return false;
    const row = findMessageRow(container, messageId);
    if (!row) return false;
    const top = resolveReplyStageScrollTop({
      rowOffsetTop: row.offsetTop,
      maxScrollTop: getMaxScrollTop(container)
    });
    guardProgrammaticScroll(top);
    runWithInstantScroll(container, () => {
      container.scrollTop = top;
    });
    setShowJumpToTop(top > TOP_JUMP_THRESHOLD);
    return true;
  };

  const queueReplyStageScroll = (messageId: string) => {
    pendingReplyStageMessageIdRef.current = messageId;
    setFollowMode('reply-stage');
    setShowJumpToLatest(false);
  };

  const rememberScrollState = (mode = followMode) => {
    if (!conversationId) return;
    const container = containerRef.current;
    if (!container) return;
    const maxScrollTop = getMaxScrollTop(container);
    const persistedMode = normalizePersistedFollowMode(mode, isGenerationActive);

    conversationScrollSnapshots.set(conversationId, {
      bottomOffset: Math.max(0, maxScrollTop - container.scrollTop),
      followMode: persistedMode,
      replyStageMessageId: getLatestUserMessageId(messages)
    });
  };

  const restoreConversationScroll = (
    snapshot: ConversationScrollSnapshot | null,
    latestUserMessageId: string | null
  ) => {
    const container = containerRef.current;
    if (!container) return;
    if (!snapshot) return;
    const maxScrollTop = getMaxScrollTop(container);

    if (snapshot.followMode === 'bottom') {
      scrollToBottom('auto');
      return;
    }

    if (snapshot.followMode === 'reply-stage') {
      if (!isGenerationActive) {
        const nextTop = Math.max(0, maxScrollTop - snapshot.bottomOffset);
        guardProgrammaticScroll(nextTop);
        runWithInstantScroll(container, () => {
          container.scrollTop = nextTop;
        });
        updateJumpButtons(container);
        return;
      }
      const replyStageMessageId = latestUserMessageId ?? snapshot.replyStageMessageId;
      if (replyStageMessageId) {
        queueReplyStageScroll(replyStageMessageId);
        return;
      }
      scrollToBottom('auto');
      return;
    }

    const nextTop = Math.max(0, maxScrollTop - snapshot.bottomOffset);
    guardProgrammaticScroll(nextTop);
    runWithInstantScroll(container, () => {
      container.scrollTop = nextTop;
    });
    updateJumpButtons(container);
  };

  const restoreConversationScrollOrLatest = (latestUserMessageId: string | null) => {
    const snapshot = readConversationScrollSnapshot(conversationId);
    if (snapshot) {
      restoreConversationScroll(snapshot, latestUserMessageId);
      return;
    }
    scrollToBottom('auto');
  };

  useLayoutEffect(() => {
    if (previousConversationIdRef.current && previousConversationIdRef.current !== conversationId) {
      rememberScrollState();
    }
    if (previousConversationIdRef.current === conversationId) return;
    previousConversationIdRef.current = conversationId;
    const latestMessageId = getLatestMessageId(messages);
    const latestUserMessageId = getLatestUserMessageId(messages);
    previousLatestMessageIdRef.current = latestMessageId;
    previousLatestUserMessageIdRef.current = latestUserMessageId;
    const nextSnapshot = readConversationScrollSnapshot(conversationId);
    const nextFollowMode = nextSnapshot?.followMode ?? 'bottom';
    setFollowMode(nextFollowMode);
    setShowJumpToLatest(false);
    setShowJumpToTop(false);
    if (!isActiveWorld) return;
    if (nextSnapshot) {
      restoreConversationScroll(nextSnapshot, latestUserMessageId);
      return;
    }
    scrollToBottom('auto');
  }, [conversationId, isActiveWorld, isWorldSettled]);

  useLayoutEffect(() => {
    if (!pendingManualModeRestoreRef.current) return;
    if (followMode !== 'manual') return;
    if (!isActiveWorld || !isWorldSettled) return;
    pendingManualModeRestoreRef.current = false;
    restoreConversationScroll(readConversationScrollSnapshot(conversationId), getLatestUserMessageId(messages));
  }, [conversationId, followMode, isActiveWorld, isWorldSettled, messages]);

  useLayoutEffect(() => {
    if (previousActiveWorldRef.current && !isActiveWorld) {
      rememberScrollState();
    }
    previousActiveWorldRef.current = isActiveWorld;

    const becameSettled = isActiveWorld && isWorldSettled && !previousWorldSettledRef.current;
    previousWorldSettledRef.current = isWorldSettled;

    if (!isActiveWorld) return;
    if (becameSettled) {
      suppressNextLiveScrollAnimationRef.current = true;
    }
    restoreConversationScrollOrLatest(getLatestUserMessageId(messages));
  }, [conversationId, isActiveWorld, isWorldSettled]);

  useLayoutEffect(() => {
    const latestMessageId = getLatestMessageId(messages);
    const latestUserMessageId = getLatestUserMessageId(messages);
    const messagesChanged = previousLatestMessageIdRef.current !== latestMessageId;
    const latestUserChanged = previousLatestUserMessageIdRef.current !== latestUserMessageId;
    previousLatestMessageIdRef.current = latestMessageId;
    previousLatestUserMessageIdRef.current = latestUserMessageId;

    const generationStateChanged = previousGenerationActiveRef.current !== isGenerationActive;
    previousGenerationActiveRef.current = isGenerationActive;
    if (generationStateChanged) {
      suppressNextLiveScrollAnimationRef.current = true;
    }

    if (!isActiveWorld || !isWorldSettled) return;
    if (latestUserChanged && latestUserMessageId) {
      queueReplyStageScroll(latestUserMessageId);
      return;
    }

    if (followMode === 'reply-stage') {
      if (!latestUserMessageId) {
        setFollowMode('bottom');
        scrollToBottom('auto');
        return;
      }
      if (!messagesChanged && !generationStateChanged) return;
      scrollMessageToReplyStage(latestUserMessageId);
      return;
    }

    if (followMode === 'manual') return;
    if (!messagesChanged && !generationStateChanged) return;
    const behavior: ScrollBehavior =
      isGenerationActive || suppressNextLiveScrollAnimationRef.current ? 'auto' : 'smooth';
    suppressNextLiveScrollAnimationRef.current = false;
    scrollToBottom(behavior);
  }, [followMode, isActiveWorld, isWorldSettled, isGenerationActive, messages]);

  useLayoutEffect(() => {
    if (!isActiveWorld || !isWorldSettled || followMode !== 'reply-stage') return;
    const messageId = pendingReplyStageMessageIdRef.current;
    if (!messageId) return;
    if (scrollMessageToReplyStage(messageId)) {
      pendingReplyStageMessageIdRef.current = null;
    }
  }, [followMode, isActiveWorld, isWorldSettled, messages]);

  useTimelineInsertCompensation({
    flowRef: containerRef,
    liveMode: followMode !== 'manual',
    messages
  });

  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) return;
    if (window.performance.now() <= ignoreProgrammaticScrollUntilRef.current) {
      if (programmaticScrollBehaviorRef.current === 'smooth') {
        if (Math.abs(container.scrollTop - (lastProgrammaticScrollTopRef.current ?? container.scrollTop)) <= 2) {
          programmaticScrollBehaviorRef.current = null;
        }
        return;
      }
      const expectedTop = lastProgrammaticScrollTopRef.current;
      if (expectedTop !== null && Math.abs(container.scrollTop - expectedTop) <= 2) {
        programmaticScrollBehaviorRef.current = null;
        return;
      }
      ignoreProgrammaticScrollUntilRef.current = 0;
      programmaticScrollBehaviorRef.current = null;
    }
    const nextIsAtBottom = isAtBottom(container);
    if (nextIsAtBottom) {
      rememberScrollState('bottom');
      setFollowMode('bottom');
      setShowJumpToLatest(false);
      setShowJumpToTop(shouldShowJumpToTop(container));
      return;
    }
    rememberScrollState('manual');
    pendingManualModeRestoreRef.current = followMode !== 'manual';
    setFollowMode('manual');
    updateJumpButtons(container);
  };

  return {
    containerRef,
    handleScroll,
    followMode,
    jumpToTop: () => {
      const container = containerRef.current;
      if (!container) return;
      setFollowMode('manual');
      setShowJumpToLatest(getMaxScrollTop(container) > JUMP_THRESHOLD);
      setShowJumpToTop(false);
      scrollToTop(resolveTimelineJumpBehavior({
        currentTop: container.scrollTop,
        targetTop: 0,
        viewportHeight: container.clientHeight
      }));
    },
    jumpToLatest: () => {
      const latestUserMessageId = getLatestUserMessageId(messages);
      if (isGenerationActive && latestUserMessageId) {
        const container = containerRef.current;
        queueReplyStageScroll(latestUserMessageId);
        setShowJumpToTop(container ? shouldShowJumpToTop(container) : false);
        return;
      }
      setFollowMode('bottom');
      setShowJumpToLatest(false);
      const container = containerRef.current;
      scrollToBottom(container
        ? resolveTimelineJumpBehavior({
            currentTop: container.scrollTop,
            targetTop: getMaxScrollTop(container),
            viewportHeight: container.clientHeight
          })
        : 'auto');
    },
    showJumpToLatest,
    showJumpToTop
  };
}
