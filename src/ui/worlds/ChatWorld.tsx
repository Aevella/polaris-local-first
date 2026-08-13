import type { DragEvent } from 'react';
import { Suspense, lazy, useRef } from 'react';
import { loadThinkingSheetModule } from '../app-shell/appShellLazyModules';
import { ChatComposer } from './chat/composer/ChatComposer';
import { useComposerFileIngest } from './chat/composer/useComposerFileIngest';
import { ChatProvider } from './chat/ChatProvider';
import { MessageTimeline } from './chat/timeline/MessageTimeline';
import {
  useChatActions,
  useChatComposer,
  useChatPresentation,
  useChatStablePayload,
  useChatUi
} from './chat/context/ChatContext';
import type { ChatUiState } from './chat/context/ChatUiState';

const ThinkingSheet = lazy(() => loadThinkingSheetModule().then((module) => ({ default: module.ThinkingSheet })));

type ChatWorldProps = {
  shell: {
    isActiveWorld: boolean;
    isWorldSwitching: boolean;
    openToolbox: () => void;
    openProviderSettings: () => void;
  };
  ui: ChatUiState;
};

function ChatWorldLayout({ shell }: ChatWorldProps) {
  const stablePayload = useChatStablePayload();
  const presentation = useChatPresentation();
  const composer = useChatComposer();
  const ui = useChatUi();
  const actions = useChatActions();
  const addComposerFiles = useComposerFileIngest();
  const dragDepthRef = useRef(0);
  const thinkingSummaryMessage = ui.thinkingSummaryMessageId
    ? stablePayload.messages.find((message) => message.id === ui.thinkingSummaryMessageId) ?? null
    : null;
  const isFileDrag = (event: DragEvent<HTMLElement>) => event.dataTransfer?.types.includes('Files') ?? false;
  const handleDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    actions.setDragActive(true);
  };
  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!composer.dragActive) actions.setDragActive(true);
  };
  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) actions.setDragActive(false);
  };
  const handleDrop = (event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    actions.setDragActive(false);
    const files = event.dataTransfer?.files;
    if (files?.length) {
      void addComposerFiles(files);
    }
  };

  return (
    <section
      className={`world world-chat timeline-${presentation.timelineDensity} ${composer.dragActive ? 'drag-active' : ''} ${thinkingSummaryMessage ? 'thinking-summary-open' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="chat-body">
        <MessageTimeline isWorldSettled={shell.isActiveWorld && !shell.isWorldSwitching} />
      </div>
      <div className="chat-dock">
        <ChatComposer />
      </div>
      {thinkingSummaryMessage ? (
        <Suspense fallback={null}>
          <ThinkingSheet
            message={thinkingSummaryMessage}
            messages={stablePayload.messages}
            assistantName={presentation.fallbackAssistantName}
            onTranslate={actions.translateThinking}
            onClose={actions.closeThinkingSummary}
          />
        </Suspense>
      ) : null}
    </section>
  );
}

export function ChatWorld(props: ChatWorldProps) {
  const normalizedShell = {
    isActiveWorld: props.shell.isActiveWorld,
    isWorldSwitching: props.shell.isWorldSwitching,
    openToolbox: props.shell.openToolbox,
    openProviderSettings: props.shell.openProviderSettings
  };

  return (
    <ChatProvider shell={normalizedShell} ui={props.ui}>
      <ChatWorldLayout {...props} />
    </ChatProvider>
  );
}
