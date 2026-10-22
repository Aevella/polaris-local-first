import type { useI18n } from '../../i18n';
import type { RoomProjectFullscreenInput, RoomProjectCompactView } from './useRoomProjectFullscreenController';
import { useState, useRef, type DragEvent } from 'react';
import { normalizeCodeLanguage, inferCodeLanguage } from '../../engines/codeCardEngine';
import { importMemoryReferenceDocFromFile } from '../../engines/memoryReferenceDocImport';
import { classifyWorkspaceImportFile } from '../../engines/workspaceImportClassification';

/** Own file/reference import progress, drag lifetime and completion feedback. */
export function useRoomProjectImportController({
  project,
  onCreateProjectFile,
  onImportWorkspaceReference,
  t,
  setCreateMenuOpen,
  setReferenceMenuOpen,
  setCompactView
}: Pick<RoomProjectFullscreenInput, 'project' | 'onCreateProjectFile' | 'onImportWorkspaceReference'> & {
  t: ReturnType<typeof useI18n>['t'];
  setCreateMenuOpen: (open: boolean) => void;
  setReferenceMenuOpen: (open: boolean) => void;
  setCompactView: (view: RoomProjectCompactView) => void;
}) {
  const [importingFiles, setImportingFiles] = useState(false);

  const [importingReferences, setImportingReferences] = useState(false);

  const [dropActive, setDropActive] = useState(false);

  const [dropBusy, setDropBusy] = useState(false);

  const [dropSummary, setDropSummary] = useState<string | null>(null);

  const dragDepthRef = useRef(0);

  const handleImportFiles = async (nextFiles: FileList | File[]) => {
    const selectedFiles = Array.from(nextFiles);
    setCreateMenuOpen(false);
    if (selectedFiles.length === 0) return;

    try {
      setImportingFiles(true);
      await Promise.all(
        selectedFiles.map(async (file, index) => {
          const content = await file.text();
          const inferredLanguage = normalizeCodeLanguage(inferCodeLanguage(content, file.name.split('.').pop()));
          onCreateProjectFile({
            projectId: project.id,
            filePath: file.name,
            content,
            language: inferredLanguage,
            openEditor: selectedFiles.length === 1 && index === 0
          });
        })
      );
    } finally {
      setImportingFiles(false);
    }
  };

  const handleImportReferences = async (nextFiles: FileList | File[]) => {
    const selectedFiles = Array.from(nextFiles);
    setReferenceMenuOpen(false);
    if (selectedFiles.length === 0) return;

    try {
      setImportingReferences(true);
      await Promise.all(
        selectedFiles.map(async (file) => {
          const draft = await importMemoryReferenceDocFromFile(file);
          onImportWorkspaceReference({
            projectId: project.id,
            title: draft.title,
            summary: draft.summary,
            content: draft.content
          });
        })
      );
    } catch (error) {
      window.alert(error instanceof Error ? error.message : t('collection.workspace.referenceImportFailed'));
    } finally {
      setImportingReferences(false);
    }
  };

  const resetDropState = () => {
    dragDepthRef.current = 0;
    setDropActive(false);
  };

  const isFileDrag = (event: DragEvent<HTMLDivElement>) => Array.from(event.dataTransfer.types).includes('Files');

  const importDroppedWorkspaceFiles = async (droppedFiles: File[]) => {
    if (droppedFiles.length === 0) return;

    setDropBusy(true);
    setDropSummary(null);
    const result = {
      projectFiles: 0,
      references: 0,
      skipped: 0,
      failed: 0
    };

    for (const file of droppedFiles) {
      const destination = classifyWorkspaceImportFile(file);
      try {
        if (destination === 'project-file') {
          const content = await file.text();
          const inferredLanguage = normalizeCodeLanguage(inferCodeLanguage(content, file.name.split('.').pop()));
          const createdId = onCreateProjectFile({
            projectId: project.id,
            filePath: file.name,
            content,
            language: inferredLanguage,
            openEditor: droppedFiles.length === 1
          });
          if (createdId) result.projectFiles += 1;
          continue;
        }

        if (destination === 'reference-doc') {
          const draft = await importMemoryReferenceDocFromFile(file);
          const createdId = onImportWorkspaceReference({
            projectId: project.id,
            title: draft.title,
            summary: draft.summary,
            content: draft.content
          });
          if (createdId) result.references += 1;
          continue;
        }

        result.skipped += 1;
      } catch {
        result.failed += 1;
      }
    }

    setDropBusy(false);
    if (result.projectFiles > 0) {
      setCompactView('files');
    } else if (result.references > 0) {
      setCompactView('references');
    }

    const importedParts = [
      result.projectFiles > 0 ? t('collection.workspace.dropProjectFileCount', { count: result.projectFiles }) : '',
      result.references > 0 ? t('collection.workspace.dropReferenceCount', { count: result.references }) : ''
    ].filter(Boolean);
    const skippedParts = [
      result.skipped > 0 ? t('collection.workspace.dropSkippedCount', { count: result.skipped }) : '',
      result.failed > 0 ? t('collection.workspace.dropFailedCount', { count: result.failed }) : ''
    ].filter(Boolean);

    setDropSummary(
      [
        importedParts.length
          ? t('collection.workspace.dropImportedSummary', {
              items: importedParts.join(t('collection.workspace.listSeparator'))
            })
          : t('collection.workspace.dropNoImportableFiles'),
        skippedParts.join(t('collection.workspace.clauseSeparator'))
      ]
        .filter(Boolean)
        .join(t('collection.workspace.clauseSeparator'))
    );
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDropActive(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDropActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    const nextFiles = Array.from(event.dataTransfer.files);
    resetDropState();
    void importDroppedWorkspaceFiles(nextFiles);
  };
  return {
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
  };
}
