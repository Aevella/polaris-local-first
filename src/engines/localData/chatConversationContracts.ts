import type { ChatMessage, Conversation } from '../../types/domain';
import { extractPolarisAssetIds } from '../assetReferences';

export class LocalDataProjectionContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalDataProjectionContractError';
  }
}

export type ConversationProjectionRole = 'durable' | 'derived' | 'transient';

export const CONVERSATION_FIELD_CLASSIFICATION = {
  id: 'durable',
  title: 'durable',
  kind: 'durable',
  collaboratorId: 'durable',
  group: 'durable',
  groupRoomId: 'durable',
  activeProjectId: 'durable',
  reasoningStrength: 'durable',
  requestContext: 'durable',
  windowPreferences: 'durable',
  messages: 'durable',
  toolLedger: 'derived',
  workspaceLedger: 'durable',
  task: 'durable',
  draft: 'durable',
  pinnedAt: 'durable',
  updatedAt: 'durable'
} as const satisfies Record<keyof Conversation, ConversationProjectionRole>;

type ConversationFieldsWithRole<Role extends ConversationProjectionRole> = {
  [Key in keyof typeof CONVERSATION_FIELD_CLASSIFICATION]:
    typeof CONVERSATION_FIELD_CLASSIFICATION[Key] extends Role ? Key : never;
}[keyof typeof CONVERSATION_FIELD_CLASSIFICATION];

export type ConversationDurableField = ConversationFieldsWithRole<'durable'>;
export type ConversationDerivedField = ConversationFieldsWithRole<'derived'>;
export type ConversationTransientField = ConversationFieldsWithRole<'transient'>;
export type ConversationDurableSnapshot = Pick<Conversation, ConversationDurableField>;

export const CONVERSATION_DURABLE_FIELDS = [
  'id',
  'title',
  'kind',
  'collaboratorId',
  'group',
  'groupRoomId',
  'activeProjectId',
  'reasoningStrength',
  'requestContext',
  'windowPreferences',
  'messages',
  'workspaceLedger',
  'task',
  'draft',
  'pinnedAt',
  'updatedAt'
] as const satisfies readonly ConversationDurableField[];

type MissingDurableFields = Exclude<ConversationDurableField, typeof CONVERSATION_DURABLE_FIELDS[number]>;
type ExtraDurableFields = Exclude<typeof CONVERSATION_DURABLE_FIELDS[number], ConversationDurableField>;
const durableFieldCoverageCheck: Record<MissingDurableFields | ExtraDurableFields, never> = {};
void durableFieldCoverageCheck;

export type CompleteChatConversationLocalDataArgs = {
  conversation: Conversation;
  bodyState: 'complete';
  version: number;
  committedAt: number;
  expectedMessageCount?: number;
  expectedLatestMessageTimestamp?: number;
  missingKeys?: string[];
};

export type NonCompleteChatConversationLocalDataArgs = {
  conversation: Conversation;
  bodyState: 'unloaded' | 'incomplete';
  version: number;
  committedAt: number;
  expectedMessageCount: number;
  expectedLatestMessageTimestamp: number;
  missingKeys?: string[];
};

export type ChatConversationLocalDataArgs =
  | CompleteChatConversationLocalDataArgs
  | NonCompleteChatConversationLocalDataArgs;

export function toConversationDurableSnapshot(conversation: Conversation): ConversationDurableSnapshot {
  return {
    id: conversation.id,
    title: conversation.title,
    kind: conversation.kind,
    collaboratorId: conversation.collaboratorId,
    group: conversation.group,
    groupRoomId: conversation.groupRoomId,
    activeProjectId: conversation.activeProjectId,
    reasoningStrength: conversation.reasoningStrength,
    requestContext: conversation.requestContext,
    windowPreferences: conversation.windowPreferences,
    messages: conversation.messages,
    workspaceLedger: conversation.workspaceLedger,
    task: conversation.task,
    draft: conversation.draft,
    pinnedAt: conversation.pinnedAt,
    updatedAt: conversation.updatedAt
  };
}

export function assertCompleteConversationBody(snapshot: ConversationDurableSnapshot) {
  if (!Array.isArray(snapshot.messages)) {
    throw new LocalDataProjectionContractError('Complete conversation projection requires loaded messages.');
  }
}

export function assertNonCompleteConversationMetadata(args: NonCompleteChatConversationLocalDataArgs) {
  if (!Number.isFinite(args.expectedMessageCount) || args.expectedMessageCount < 0) {
    throw new LocalDataProjectionContractError('Non-complete conversation projection requires expectedMessageCount.');
  }
  if (!Number.isFinite(args.expectedLatestMessageTimestamp) || args.expectedLatestMessageTimestamp < 0) {
    throw new LocalDataProjectionContractError(
      'Non-complete conversation projection requires expectedLatestMessageTimestamp.'
    );
  }
}

export function collectChatMessageAssetRefs(message: ChatMessage) {
  const assetIds = new Set<string>();
  collectAssetRefsFromText(message.content, assetIds);
  collectAssetRefsFromText(message.requestContent, assetIds);
  collectAssetRefsFromText(message.thinkingText, assetIds);

  for (const attachment of message.attachments ?? []) {
    if (attachment.assetId.trim()) assetIds.add(attachment.assetId.trim());
  }

  const voiceCacheAssetId = message.voiceCache?.assetId.trim();
  if (voiceCacheAssetId) assetIds.add(voiceCacheAssetId);

  for (const nativeToolCall of message.nativeToolCalls ?? []) {
    collectAssetRefsFromText(nativeToolCall.argumentsText, assetIds);
  }

  if (message.toolInvocation) collectAssetRefsFromStructuredValue(message.toolInvocation, assetIds);
  if (message.cardReference) collectAssetRefsFromStructuredValue(message.cardReference, assetIds);

  return Array.from(assetIds).sort();
}

function collectAssetRefsFromText(value: string | undefined, assetIds: Set<string>) {
  if (!value) return;
  for (const assetId of extractPolarisAssetIds(value)) {
    if (assetId.trim()) assetIds.add(assetId.trim());
  }
}

function collectAssetRefsFromStructuredValue(value: unknown, assetIds: Set<string>, seen = new Set<object>()) {
  if (typeof value === 'string') {
    collectAssetRefsFromText(value, assetIds);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) collectAssetRefsFromStructuredValue(item, assetIds, seen);
    return;
  }

  for (const item of Object.values(value)) {
    collectAssetRefsFromStructuredValue(item, assetIds, seen);
  }
}
