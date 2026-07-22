import type { AvatarDisplaySize, AvatarIconId, AvatarShape, PersonaAttachmentId, PersonaBaseId, PersonaCuriosityId, PersonaDisagreementId, PersonaExpressionId, PersonaGeneratedPromptMode, PersonaHumorId, PersonaInitiativeId, PersonaMemoryStyleId, PersonaRelationshipId, PersonaSelfDisclosureId, PersonaSilenceId, PersonaTagSelection } from './primitives';

export interface PersonaDeepDefinition {
  identityHint: string;
  missionHint: string;
  conflictPriority: string;
  conflictReason: string;
  avoidBecoming: string;
  correctiveAction: string;
  vulnerableFirst: string;
  vulnerableThen: string;
  hardBoundary: string;
  hardBoundaryAction: string;
}

export interface PersonaMemorySettings {
  inheritGlobal: boolean;
  crossConversationRecallEnabled: boolean;
  semanticRecall?: PersonaSemanticRecallSettings;
  vectorIndex?: PersonaVectorIndexSettings;
  conversationSummaries: PersonaConversationSummary[];
  conversationSummarySuppressions?: PersonaConversationSummarySuppression[];
  excludeFromGlobal?: boolean;
  excludedGlobalIds: string[];
  personalMemories: string[];
  referenceDocs: PersonaMemoryReferenceDoc[];
}

export interface PersonaSemanticRecallSettings {
  recentTailConversationCount?: number;
  recentTailUserMessageCount?: number;
  voiceAnchorCount?: number;
}

export type PersonaVectorIndexStatus =
  | 'idle'
  | 'indexing'
  | 'paused'
  | 'needs_rebuild'
  | 'failed';

export interface PersonaVectorIndexSettings {
  enabled: boolean;
  providerId?: string;
  modelOverride?: string;
  dimensions?: number | null;
  status?: PersonaVectorIndexStatus;
  indexedChunkCount?: number;
  totalChunkCount?: number;
  lastIndexedAt?: number;
  lastError?: string;
}

export type PersonaConversationSummaryKind =
  | 'relational_profile'
  | 'recent_topic';

export interface PersonaConversationSummary {
  id: string;
  kind: PersonaConversationSummaryKind;
  title: string;
  content: string;
  sequence: number;
  sourceConversationIds: string[];
  sourceMessageIds: string[];
  sourceCharCount: number;
  subjectCollaboratorId?: string;
  subjectCollaboratorName?: string;
  userLabel?: string;
  generator: 'small_model' | 'manual';
  generatedAt: number;
  updatedAt: number;
  expiresAt?: number;
}

export interface PersonaConversationSummarySuppression {
  id: string;
  sourceConversationIds: string[];
  sourceMessageIds: string[];
  sourceCharCount: number;
  reason: 'user_deleted' | 'user_cleared';
  suppressedAt: number;
}

export interface ConversationSummaryModelSettings {
  enabled: boolean;
  autoUpdateEnabled?: boolean;
  providerId?: string;
  modelOverride?: string;
  targetSourceChars?: number;
  skipProcessedSources?: boolean;
  lastUpdatedAt?: number;
}

export interface MemoryVectorRetrievalSettings {
  enabled: boolean;
  baseUrl?: string;
  path?: string;
  apiKey?: string;
  model?: string;
  dimensions?: number | null;
  lastUpdatedAt?: number;
}

export type ImageGenerationSize =
  | '1024x1024'
  | '1024x1536'
  | '1536x1024'
  | 'auto';

export interface ImageGenerationSettings {
  enabled: boolean;
  providerId?: string;
  modelOverride?: string;
  size?: ImageGenerationSize;
  lastUpdatedAt?: number;
}

export interface ImageUnderstandingSettings {
  enabled: boolean;
  providerId?: string;
  modelOverride?: string;
  lastUpdatedAt?: number;
}

export type VoiceGenerationFormat =
  | 'mp3'
  | 'opus'
  | 'aac'
  | 'flac'
  | 'wav'
  | 'pcm';

export type VoiceGenerationProviderType =
  | 'openai-compatible'
  | 'minimax'
  | 'elevenlabs'
  | 'fishaudio';

export type VoiceGenerationCustomVoiceSource =
  | 'manual'
  | 'minimax-system'
  | 'minimax-clone'
  | 'minimax-generation';

export interface VoiceGenerationCustomVoice {
  id: string;
  providerType: VoiceGenerationProviderType;
  label: string;
  voice: string;
  source?: VoiceGenerationCustomVoiceSource;
  createdAt?: number;
  updatedAt?: number;
}

export interface VoiceGenerationSettings {
  enabled: boolean;
  providerType?: VoiceGenerationProviderType;
  baseUrl?: string;
  path?: string;
  apiKey?: string;
  model?: string;
  /**
   * Legacy provider-list route fields. New voice playback config is stored
   * directly on this object so speech does not imply chat-provider support.
   */
  providerId?: string;
  modelOverride?: string;
  voice?: string;
  customVoices?: VoiceGenerationCustomVoice[];
  format?: VoiceGenerationFormat;
  lastUpdatedAt?: number;
}

export type PersonaMemoryReferenceDocSource =
  | 'user'
  | 'collaborator'
  | 'conversation'
  | 'workspace'
  | 'upload';

export interface PersonaMemoryReferenceDoc {
  id: string;
  title: string;
  summary: string;
  content: string;
  charCount?: number;
  contentLoaded?: boolean;
  source: PersonaMemoryReferenceDocSource;
  updatedAt: number;
}

export interface PersonaAdvancedSettings {
  providerId?: string;
  modelOverride: string;
  temperature: string;
  topP: string;
  maxTokens: string;
  thinkingBudget: string;
  contextMessageLimit: string;
  showThinking: boolean;
  streaming: boolean;
  customHeaders: string;
  customBody: string;
  regexRules: string;
  regexTriggers?: string;
  snippets: string[];
}

export interface PersonaMcpSettings {
  inheritGlobal: boolean;
  serverIds: string[];
}

export interface Persona {
  id: string;
  systemRole: 'default' | null;
  name: string;
  description: string;
  assistantAvatarAssetId: string | null;
  assistantAvatarIconId: AvatarIconId | null;
  assistantAvatarShape: AvatarShape;
  assistantAvatarSize: AvatarDisplaySize;
  userAvatarAssetId: string | null;
  userAvatarIconId: AvatarIconId | null;
  userAvatarShape: AvatarShape;
  userAvatarSize: AvatarDisplaySize;
  userName: string;
  purpose: string;
  compiledPrompt: string;
  builderManaged: boolean;
  generatedPromptMode: PersonaGeneratedPromptMode;
  messageTemplate: string;
  systemTimeContextEnabled: boolean;
  baseId: PersonaBaseId;
  relationship: PersonaRelationshipId;
  expression: PersonaExpressionId;
  tags: PersonaTagSelection;
  initiative: PersonaInitiativeId;
  memoryStyle: PersonaMemoryStyleId;
  silence: PersonaSilenceId;
  disagreement: PersonaDisagreementId;
  humor: PersonaHumorId;
  attachment: PersonaAttachmentId;
  curiosity: PersonaCuriosityId;
  selfDisclosure: PersonaSelfDisclosureId;
  deepDefinition: PersonaDeepDefinition;
  memory: PersonaMemorySettings;
  advanced: PersonaAdvancedSettings;
  mcp: PersonaMcpSettings;
  pinnedAt?: number | null;
  version: number;
}
