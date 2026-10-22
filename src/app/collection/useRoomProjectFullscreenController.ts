import { useI18n } from '../../i18n';
import {
  getDesktopLocalHostBridge,
  type DesktopLocalCommandResult,
  type DesktopLocalCommandSession
} from '../../desktop/localHost';
import { useRuntimeStore } from '../../stores/runtimeStore';
import { useState, useRef, useEffect } from 'react';
import { type ResolvedRoomProjectFile } from '../../engines/roomProjects';
import { type WorkspaceReferenceDoc, type RoomProject, type Conversation, type Persona } from '../../types/domain';
import { readWorkspaceReferenceDocContent } from '../../stores/workspaceReferenceDocContentPersistence';
import { useRoomProjectImportController } from './useRoomProjectImportController';
import { buildRoomProjectFullscreenPresentation } from './roomProjectFullscreenPresentation';

export type RoomProjectFullscreenInput = {
  project: RoomProject;
  files: ResolvedRoomProjectFile[];
  referenceDocs: WorkspaceReferenceDoc[];
  conversations: Conversation[];
  personas: Persona[];
  activeConversationId: string | null;
  desktopLocalBusy: boolean;
  desktopLocalStatus: string | null;
  desktopLocalStatusTone: 'neutral' | 'warning';
  desktopCommand: string;
  desktopCommandArgs: string;
  desktopCommandBusy: boolean;
  desktopCommandResult: { projectId: string; result: DesktopLocalCommandResult | null; error: string | null } | null;
  desktopCommandSessions: Array<DesktopLocalCommandSession & { projectId?: string }>;
  onClose: () => void;
  onOpenFile: (fileId: string) => void;
  onCreateProjectFile: (args: {
    projectId: string;
    filePath: string;
    content?: string;
    language?: string;
    openEditor?: boolean;
  }) => string | null;
  onCreateWorkspaceReference: (args: {
    projectId: string;
    title: string;
    summary?: string;
    content?: string;
  }) => string | null;
  onImportWorkspaceReference: (args: {
    projectId: string;
    title: string;
    summary: string;
    content: string;
  }) => string | null;
  onUpdateWorkspaceReference: (
    docId: string,
    patch: Partial<Pick<WorkspaceReferenceDoc, 'title' | 'summary' | 'content'>>
  ) => void;
  onDeleteWorkspaceReference: (docId: string) => void;
  onCreateProjectChat: () => void;
  onOpenProjectChat: (conversationId: string) => void;
  onDeleteProjectChat: (conversationId: string, title: string) => void;
  onRenameProject: (projectId: string, title: string) => boolean;
  onSetProjectPreviewStateAccess: (projectId: string, assistantReadEnabled: boolean) => boolean;
  onRunProject: (projectId: string) => void;
  onDesktopCommandChange: (value: string) => void;
  onDesktopCommandArgsChange: (value: string) => void;
  onRunDesktopProjectCommand: (projectId: string) => void;
  onStopDesktopProjectCommand: (sessionId: string) => void;
  onInspectProjectChanges: (projectId: string) => void;
  onSyncProjectFromDisk: (projectId: string) => void;
  onSyncProjectToDisk: (projectId: string) => void;
  onOpenDesktopLocalSettings: () => void;
};
export type RoomProjectCompactView = 'conversations' | 'files' | 'references';

/** Own fullscreen interaction state and workspace actions; store mutations remain injected. */
export function useRoomProjectFullscreenController(
  {
    project,
    files,
    referenceDocs,
    conversations,
    personas,
    activeConversationId,
    desktopLocalBusy,
    desktopLocalStatus,
    desktopLocalStatusTone,
    desktopCommand,
    desktopCommandArgs,
    desktopCommandBusy,
    desktopCommandResult,
    desktopCommandSessions,
    onClose,
    onOpenFile,
    onCreateProjectFile,
    onCreateWorkspaceReference,
    onImportWorkspaceReference,
    onUpdateWorkspaceReference,
    onDeleteWorkspaceReference,
    onCreateProjectChat,
    onOpenProjectChat,
    onDeleteProjectChat,
    onRenameProject,
    onSetProjectPreviewStateAccess,
    onRunProject,
    onDesktopCommandChange,
    onDesktopCommandArgsChange,
    onRunDesktopProjectCommand,
    onStopDesktopProjectCommand,
    onInspectProjectChanges,
    onSyncProjectFromDisk,
    onSyncProjectToDisk,
    onOpenDesktopLocalSettings
  }: RoomProjectFullscreenInput,
  isWideLayout: boolean
) {
  const { t, language } = useI18n();

  const desktopLocalAvailable = Boolean(getDesktopLocalHostBridge());

  const companionConnections = useRuntimeStore((state) => state.companionConnections);

  const previewStateReadEnabled = project.previewStateAccess?.assistantReadEnabled === true;

  const [titleDraft, setTitleDraft] = useState(project.title);

  const [titleEditing, setTitleEditing] = useState(false);

  const [createMenuOpen, setCreateMenuOpen] = useState(false);

  const [referenceMenuOpen, setReferenceMenuOpen] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);

  const [compactView, setCompactView] = useState<RoomProjectCompactView>('files');

  const titleInputRef = useRef<HTMLInputElement | null>(null);

  const createMenuRef = useRef<HTMLDivElement | null>(null);

  const referenceMenuRef = useRef<HTMLDivElement | null>(null);

  const createMenuTriggerRef = useRef<HTMLButtonElement | null>(null);

  const referenceMenuTriggerRef = useRef<HTMLButtonElement | null>(null);

  const imports = useRoomProjectImportController({
    project,
    onCreateProjectFile,
    onImportWorkspaceReference,
    t,
    setCreateMenuOpen,
    setReferenceMenuOpen,
    setCompactView
  });
  const {
    importingFiles,
    importingReferences,
    dropActive,
    dropBusy,
    dropSummary,
    setDropSummary,
    handleImportFiles,
    handleImportReferences,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop
  } = imports;

  useEffect(() => {
    setTitleDraft(project.title);
    setTitleEditing(false);
    setSettingsOpen(false);
  }, [project.id, project.title]);

  useEffect(() => {
    if (!titleEditing) return;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [titleEditing]);

  useEffect(() => {
    if (!createMenuOpen && !referenceMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (createMenuRef.current?.contains(target)) return;
      if (referenceMenuRef.current?.contains(target)) return;
      if (createMenuTriggerRef.current?.contains(target)) return;
      if (referenceMenuTriggerRef.current?.contains(target)) return;
      setCreateMenuOpen(false);
      setReferenceMenuOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [createMenuOpen, referenceMenuOpen]);

  useEffect(() => {
    if (!settingsOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [settingsOpen]);

  if (typeof document === 'undefined') return null;

  const presentation = buildRoomProjectFullscreenPresentation({
    importingFiles,
    t,
    importingReferences,
    files,
    conversations,
    referenceDocs,
    previewStateReadEnabled,
    project,
    companionConnections,
    desktopLocalAvailable,
    language,
    desktopCommandResult,
    desktopCommandSessions
  });

  const nextPinnedReferenceTitle = (file: ResolvedRoomProjectFile) => {
    const baseTitle = file.path.trim() || file.title.trim() || t('collection.workspace.projectFileFallback');
    const existingTitles = new Set(referenceDocs.map((doc) => doc.title.trim()).filter(Boolean));
    if (!existingTitles.has(baseTitle)) return baseTitle;
    for (let index = 2; index < 1000; index += 1) {
      const candidate = t('collection.workspace.referenceTitleVariant', { title: baseTitle, index });
      if (!existingTitles.has(candidate)) return candidate;
    }
    return t('collection.workspace.referenceTitleVariant', { title: baseTitle, index: Date.now() });
  };

  const commitTitle = () => {
    const trimmedTitle = titleDraft.trim();
    if (!trimmedTitle) {
      setTitleDraft(project.title);
      setTitleEditing(false);
      return;
    }
    onRenameProject(project.id, trimmedTitle);
    setTitleEditing(false);
  };

  const nextProjectFilePath = () => {
    const existingPaths = new Set(files.map((file) => file.path));
    if (!existingPaths.has('index.html')) return 'index.html';
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `new-file-${index}.txt`;
      if (!existingPaths.has(candidate)) return candidate;
    }
    return `new-file-${Date.now()}.txt`;
  };

  const handleCreateFile = () => {
    setCreateMenuOpen(false);
    onCreateProjectFile({
      projectId: project.id,
      filePath: nextProjectFilePath(),
      openEditor: true
    });
  };

  const handleCreateReference = () => {
    setReferenceMenuOpen(false);
    const title = window
      .prompt(
        t('collection.workspace.referenceTitlePrompt'),
        t('collection.workspace.referenceDefaultTitle', { count: referenceDocs.length + 1 })
      )
      ?.trim();
    if (!title) return;
    const content = window.prompt(t('collection.workspace.referenceBodyPrompt'), '') ?? '';
    onCreateWorkspaceReference({
      projectId: project.id,
      title,
      content,
      summary: content.trim().replace(/\s+/g, ' ').slice(0, 96)
    });
  };

  const toggleFileCreateMenu = () => {
    setReferenceMenuOpen(false);
    setCreateMenuOpen((current) => !current);
  };

  const toggleReferenceCreateMenu = () => {
    setCreateMenuOpen(false);
    setReferenceMenuOpen((current) => !current);
  };

  const handlePinFileAsReference = (file: ResolvedRoomProjectFile) => {
    const title = nextPinnedReferenceTitle(file);
    onCreateWorkspaceReference({
      projectId: project.id,
      title,
      summary: t('collection.workspace.pinnedReferenceSummary', { path: file.path }),
      content: file.content
    });
  };

  const handleEditReference = async (doc: WorkspaceReferenceDoc) => {
    const title = window.prompt(t('collection.workspace.referenceTitlePrompt'), doc.title)?.trim();
    if (!title) return;
    const summary = window.prompt(t('collection.workspace.referenceSummaryPrompt'), doc.summary)?.trim() ?? doc.summary;
    let currentContent = '';
    try {
      currentContent = await readWorkspaceReferenceDocContent(doc);
    } catch {
      setDropSummary(t('collection.workspace.referenceBodyMissing'));
      return;
    }
    const content = window.prompt(t('collection.workspace.referenceBodyEditPrompt'), currentContent) ?? currentContent;
    onUpdateWorkspaceReference(doc.id, { title, summary, content });
  };

  const handleDeleteReference = (doc: WorkspaceReferenceDoc) => {
    if (!window.confirm(t('collection.workspace.deleteReferenceConfirm', { title: doc.title }))) return;
    onDeleteWorkspaceReference(doc.id);
  };
  return {
    dropActive,
    compactView,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    onClose,
    t,
    titleEditing,
    titleInputRef,
    titleDraft,
    setTitleDraft,
    commitTitle,
    project,
    setTitleEditing,
    setSettingsOpen,
    conversations,
    files,
    referenceDocs,
    setCompactView,
    dropSummary,
    onCreateProjectChat,
    personas,
    activeConversationId,
    onOpenProjectChat,
    onDeleteProjectChat,
    createMenuTriggerRef,
    createMenuOpen,
    toggleFileCreateMenu,
    setCreateMenuOpen,
    createMenuRef,
    handleCreateFile,
    importingFiles,
    handleImportFiles,
    onOpenFile,
    handlePinFileAsReference,
    referenceMenuTriggerRef,
    referenceMenuOpen,
    toggleReferenceCreateMenu,
    setReferenceMenuOpen,
    referenceMenuRef,
    handleCreateReference,
    importingReferences,
    handleImportReferences,
    handleEditReference,
    handleDeleteReference,
    onRunProject,
    dropBusy,
    desktopLocalAvailable,
    onOpenDesktopLocalSettings,
    desktopLocalBusy,
    onInspectProjectChanges,
    onSyncProjectFromDisk,
    onSyncProjectToDisk,
    desktopLocalStatus,
    desktopLocalStatusTone,
    onRunDesktopProjectCommand,
    onStopDesktopProjectCommand,
    desktopCommandBusy,
    desktopCommand,
    onDesktopCommandChange,
    desktopCommandArgs,
    onDesktopCommandArgsChange,
    desktopCommandResult,
    previewStateReadEnabled,
    onSetProjectPreviewStateAccess,
    settingsOpen,
    isWideLayout,
    ...presentation
  };
}

export type RoomProjectFullscreenModel = NonNullable<ReturnType<typeof useRoomProjectFullscreenController>>;
