import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../../i18n';
import { Icon } from '../../Icon';
import { useAssetObjectUrl } from '../../useAssetObjectUrl';
import { MessageMarkdown } from '../chat/message/MessageMarkdown';
import { messageGeneratedImageAttachments, type GroupActivityKey } from '../../../app/group/groupActivity';
import { splitFencedCode } from '../../../app/group/groupMessageCode';
import type { ChatAttachment, ChatMessage, Persona } from '../../../types/domain';
import { GroupAvatar } from './GroupAvatar';
import type { GroupController } from './groupController';

type GroupTimelineProps = {
  controller: GroupController;
};

const GROUP_TIMELINE_BOTTOM_THRESHOLD = 160;

function AttachmentImage({ attachment }: { attachment: ChatAttachment }) {
  const url = useAssetObjectUrl(attachment.assetId, true);
  if (!url) return null;
  return <img src={url} alt={attachment.name} className="group-msg-image" loading="lazy" />;
}

function TypingDots() {
  return (
    <span className="group-typing-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function MemberMessage({
  message,
  member,
  fallbackName,
  onOpenLane,
  onOpenCards,
  cardLabel,
  codeLinesLabel,
  controller,
  streaming = false,
  activityHint = null
}: {
  message: ChatMessage;
  member: Persona | null;
  fallbackName: string;
  onOpenLane: (memberId: string) => void;
  onOpenCards: () => void;
  cardLabel: string;
  codeLinesLabel: (lines: number) => string;
  controller: GroupController;
  streaming?: boolean;
  activityHint?: string | null;
}) {
  const { t } = useI18n();
  const [actionsOpen, setActionsOpen] = useState(false);
  const [editDraft, setEditDraft] = useState<string | null>(null);
  const name = member?.name ?? message.assistantName ?? fallbackName;
  const hasCard = Boolean(message.toolInvocation?.cardId);
  // 写代码是过程：群里压成小物件，完整代码在这位成员的私域里
  const { text, codeBlocks } = useMemo(() => splitFencedCode(message.content), [message.content]);
  const editing = editDraft !== null;

  return (
    <div className="group-msg is-member">
      <button
        type="button"
        className="group-msg-avatar"
        onClick={member ? () => onOpenLane(member.id) : undefined}
        aria-label={name}
      >
        {member ? <GroupAvatar persona={member} size={32} /> : <Icon name="persona" size={18} />}
      </button>
      <div className="group-msg-main">
        <span className="group-msg-name">
          {name}
          {streaming ? (
            <em className="group-msg-typing-hint">{activityHint ?? t('group.timeline.typing')}</em>
          ) : null}
        </span>
        <div
          className={`group-msg-bubble ${editing ? 'is-editing' : ''} ${streaming ? 'is-streaming' : ''}`}
          onClick={editing || streaming ? undefined : () => setActionsOpen((current) => !current)}
        >
          {editing ? (
            <textarea
              className="group-msg-edit-area"
              value={editDraft}
              rows={Math.min(10, Math.max(3, editDraft.split('\n').length + 1))}
              onChange={(event) => setEditDraft(event.target.value)}
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <>
              {text ? <MessageMarkdown content={text} /> : null}
              {codeBlocks.length > 0 ? (
                <div className="group-msg-code-chips">
                  {codeBlocks.map((block, index) => (
                    <button
                      type="button"
                      key={`${message.id}-code-${index}`}
                      className="group-msg-code-chip"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (member) onOpenLane(member.id);
                      }}
                    >
                      <Icon name="code" size={13} />
                      <span>
                        {block.language ? `${block.language} · ` : ''}
                        {codeLinesLabel(block.lineCount)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              {hasCard && message.toolInvocation ? (
                <button
                  type="button"
                  className="group-msg-card-chip"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenCards();
                  }}
                >
                  <Icon name="cardStack" size={13} />
                  <span>{message.toolInvocation.title || cardLabel}</span>
                </button>
              ) : null}
              {streaming ? <span className="group-msg-streaming-caret" aria-hidden="true" /> : null}
            </>
          )}
        </div>
        {editing ? (
          <div className="group-msg-actions">
            <button
              type="button"
              onClick={() => {
                controller.editMemberMessage(message.id, editDraft);
                setEditDraft(null);
                setActionsOpen(false);
              }}
            >
              {t('group.message.save')}
            </button>
            <button type="button" onClick={() => setEditDraft(null)}>
              {t('group.message.cancel')}
            </button>
          </div>
        ) : actionsOpen ? (
          <div className="group-msg-actions">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(message.content);
                setActionsOpen(false);
              }}
            >
              {t('group.message.copy')}
            </button>
            <button type="button" onClick={() => setEditDraft(message.content)}>
              {t('group.message.edit')}
            </button>
            <button
              type="button"
              className="is-danger"
              onClick={() => {
                controller.deleteMemberMessage(message.id);
                setActionsOpen(false);
              }}
            >
              {t('group.message.delete')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function UserMessage({ message }: { message: ChatMessage }) {
  const liveAttachments = (message.attachments ?? []).filter(
    (attachment) => attachment.assetId && !attachment.clearedAt
  );
  const imageAttachments = liveAttachments.filter((attachment) => attachment.kind === 'image');
  const fileAttachments = liveAttachments.filter((attachment) => attachment.kind === 'file');
  return (
    <div className="group-msg is-user">
      <div className="group-msg-main">
        {imageAttachments.length > 0 ? (
          <div className="group-msg-images">
            {imageAttachments.map((attachment) => (
              <AttachmentImage key={attachment.id} attachment={attachment} />
            ))}
          </div>
        ) : null}
        {fileAttachments.length > 0 ? (
          <div className="group-msg-files">
            {fileAttachments.map((attachment) => (
              <span key={attachment.id} className="group-msg-file-chip">
                <Icon name="fileText" size={13} />
                <span>{attachment.name}</span>
              </span>
            ))}
          </div>
        ) : null}
        {message.content.trim() ? (
          <div className="group-msg-bubble">
            <span className="group-msg-user-text">{message.content}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function GroupTimeline({ controller }: GroupTimelineProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const flowRef = useRef<HTMLDivElement | null>(null);
  const followBottomRef = useRef(true);
  const previousGroupIdRef = useRef<string | null>(null);
  const group = controller.activeGroup;
  const groupId = group?.id ?? null;

  const scrollToBottom = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, []);

  const handleTimelineScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    followBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < GROUP_TIMELINE_BOTTOM_THRESHOLD;
  }, []);

  const memberById = useMemo(
    () => new Map(controller.memberPersonas.map((member) => [member.id, member])),
    [controller.memberPersonas]
  );
  const allPersonaById = useMemo(
    () => new Map(controller.personas.map((persona) => [persona.id, persona])),
    [controller.personas]
  );

  const streamingMessageIds = useMemo(() => {
    const ids = new Set<string>();
    for (const state of controller.memberLiveStates) {
      if (state.streamingMessageId) ids.add(state.streamingMessageId);
    }
    return ids;
  }, [controller.memberLiveStates]);

  const timelineItems = useMemo(() => {
    if (!group) return [];
    const items: Array<{ kind: 'user' | 'member' | 'result'; message: ChatMessage; streaming?: boolean }> = [];
    for (const message of group.messages) {
      if (message.origin === 'tool-runtime') {
        if (streamingMessageIds.has(message.id)) continue;
        // 过程留在私域；只有做成了东西（卡片、图片）才以成品的样子掉进群里
        const invocation = message.toolInvocation;
        const succeeded = invocation && invocation.status !== 'failed' && invocation.status !== 'running';
        const hasImages = messageGeneratedImageAttachments(message).length > 0;
        // MCP 是真实世界的副作用：留一条公开痕迹，别的成员才知道这事已经做过了
        const isMcp = invocation?.kind === 'invokeMcpTool';
        if (message.speakerCollaboratorId && succeeded && (invocation?.cardId || hasImages || isMcp)) {
          items.push({ kind: 'result', message });
        }
        continue;
      }
      if (message.role === 'system') continue;
      if (message.role === 'assistant') {
        const streaming = streamingMessageIds.has(message.id);
        // 还没吐出第一个字：交给"正在输入"的三个点
        if (!message.content.trim()) continue;
        // 开口了就就地实时显示——没有人是隐身的，也就没有"后完成插到前面"
        items.push({ kind: 'member', message, streaming });
        continue;
      }
      if (message.role === 'user' && (message.content.trim() || (message.attachments?.length ?? 0) > 0)) {
        items.push({ kind: 'user', message });
      }
    }
    return items;
  }, [group, streamingMessageIds]);

  // 已经在气泡里说话的成员不再显示打字点
  const speakingMessageIds = useMemo(() => {
    if (!group) return new Set<string>();
    return new Set(
      group.messages
        .filter((message) => streamingMessageIds.has(message.id) && message.content.trim())
        .map((message) => message.id)
    );
  }, [group, streamingMessageIds]);
  const typingStates = controller.memberLiveStates.filter((state) =>
    state.typing && !(state.streamingMessageId && speakingMessageIds.has(state.streamingMessageId)));
  const failedStates = controller.memberLiveStates.filter((state) => state.failed && !state.typing);

  // 谁正在私域里用工具：开口了的成员把状态挂在名字旁，没开口的挂在打字气泡上
  const activityKeyByMemberId = useMemo(() => {
    const map = new Map<string, GroupActivityKey>();
    for (const state of controller.memberLiveStates) {
      if (state.activityKey) map.set(state.member.id, state.activityKey);
    }
    return map;
  }, [controller.memberLiveStates]);

  // 流式文字总长度作为"滚动心跳"，靠近底部时跟随
  const streamTick = useMemo(
    () => timelineItems.reduce(
      (total, item) => (item.kind === 'member' && item.streaming ? total + item.message.content.length : total),
      0
    ),
    [timelineItems]
  );

  useLayoutEffect(() => {
    if (previousGroupIdRef.current === groupId) return;
    previousGroupIdRef.current = groupId;
    followBottomRef.current = true;
    scrollToBottom();
  }, [groupId, scrollToBottom]);

  useLayoutEffect(() => {
    if (!followBottomRef.current) return;
    scrollToBottom();
  }, [groupId, timelineItems.length, typingStates.length, failedStates.length, streamTick, scrollToBottom]);

  useEffect(() => {
    const flow = flowRef.current;
    if (!flow || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (followBottomRef.current) scrollToBottom();
    });
    observer.observe(flow);
    return () => observer.disconnect();
  }, [groupId, scrollToBottom]);

  if (!group) return null;

  return (
    <div className="group-timeline" ref={scrollRef} onScroll={handleTimelineScroll}>
      {timelineItems.length === 0 && typingStates.length === 0 ? (
        <div className="group-timeline-empty">
          <Icon name="navGroup" size={22} />
          <p>{t('group.timeline.empty')}</p>
        </div>
      ) : null}
      <div className="group-timeline-flow" ref={flowRef}>
        {timelineItems.map(({ kind, message, streaming }) => {
          if (kind === 'user') {
            return <UserMessage key={message.id} message={message} />;
          }
          const speaker = message.speakerCollaboratorId
            ? memberById.get(message.speakerCollaboratorId)
              ?? allPersonaById.get(message.speakerCollaboratorId)
              ?? null
            : null;
          if (kind === 'result') {
            if (message.toolInvocation?.kind === 'invokeMcpTool') {
              // 外部工具的公开痕迹：谁用了什么，点开去这位成员的私域看过程
              return (
                <div className="group-msg-result is-mcp" key={message.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (message.speakerCollaboratorId) controller.setLaneMemberId(message.speakerCollaboratorId);
                    }}
                  >
                    {speaker ? <GroupAvatar persona={speaker} size={18} /> : null}
                    <Icon name="wand" size={13} />
                    <span>
                      {t('group.timeline.mcpUsed', {
                        tool: message.toolInvocation.toolName || message.toolInvocation.title || t('group.lane.tool')
                      })}
                    </span>
                  </button>
                </div>
              );
            }
            const resultImages = messageGeneratedImageAttachments(message);
            if (resultImages.length > 0) {
              // 图片成品直接以图的样子掉进群里，点开去图片区
              return (
                <div className="group-msg-result is-image" key={message.id}>
                  <button
                    type="button"
                    onClick={() => controller.setActiveTab('images')}
                    aria-label={message.toolInvocation?.title || t('group.tab.images')}
                  >
                    {speaker ? <GroupAvatar persona={speaker} size={18} /> : null}
                    <span className="group-msg-result-images">
                      {resultImages.map((attachment) => (
                        <AttachmentImage key={attachment.id} attachment={attachment} />
                      ))}
                    </span>
                  </button>
                </div>
              );
            }
            return (
              <div className="group-msg-result" key={message.id}>
                <button type="button" onClick={() => controller.setActiveTab('cards')}>
                  {speaker ? <GroupAvatar persona={speaker} size={18} /> : null}
                  <Icon name="cardStack" size={13} />
                  <span>{message.toolInvocation?.title || t('group.timeline.card')}</span>
                </button>
              </div>
            );
          }
          return (
            <MemberMessage
              key={message.id}
              message={message}
              member={speaker}
              fallbackName={t('room.settings.fallbackName')}
              onOpenLane={controller.setLaneMemberId}
              onOpenCards={() => controller.setActiveTab('cards')}
              cardLabel={t('group.timeline.card')}
              codeLinesLabel={(lines) => t('group.timeline.codeLines', { lines })}
              controller={controller}
              streaming={streaming}
              activityHint={
                message.speakerCollaboratorId && activityKeyByMemberId.has(message.speakerCollaboratorId)
                  ? t(activityKeyByMemberId.get(message.speakerCollaboratorId)!)
                  : null
              }
            />
          );
        })}
        {typingStates.map(({ member, activityKey }) => {
          const hint = activityKey ? t(activityKey) : t('group.timeline.typing');
          return (
            <div className="group-msg is-member is-typing" key={`typing-${member.id}`}>
              <button
                type="button"
                className="group-msg-avatar"
                onClick={() => controller.setLaneMemberId(member.id)}
                aria-label={member.name}
              >
                <GroupAvatar persona={member} size={32} />
              </button>
              <div className="group-msg-main">
                <span className="group-msg-name">
                  {member.name}
                  <em className="group-msg-typing-hint">{hint}</em>
                </span>
                <div className="group-msg-bubble is-typing-bubble" aria-label={hint}>
                  <TypingDots />
                  {activityKey ? <span className="group-typing-activity">{t(activityKey)}</span> : null}
                </div>
              </div>
            </div>
          );
        })}
        {failedStates.map(({ member }) => (
          <div className="group-msg-failed" key={`failed-${member.id}`}>
            <span>{t('group.timeline.failed', { name: member.name })}</span>
            <button type="button" onClick={() => void controller.retryMember(member.id)}>
              {t('group.timeline.retry')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
