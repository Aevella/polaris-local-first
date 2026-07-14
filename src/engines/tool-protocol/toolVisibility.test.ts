import { describe, expect, it } from 'vitest';
import { POLARIS_TOOL_REGISTRY_BY_NAME } from './toolRegistry';
import {
  isParsedAssistantActionVisible,
  isPolarisNativeToolVisible,
  resolveToolVisibilityState
} from './toolVisibility';

describe('toolVisibility', () => {
  it('resolves the explicit model-facing visibility state from product context', () => {
    expect(resolveToolVisibilityState()).toMatchObject({
      userContext: 'chat-only',
      taskStage: 'active',
      themeMode: 'stable'
    });
    expect(resolveToolVisibilityState({
      activeCard: {
        id: 'card-1',
        title: 'Room',
        language: 'html',
        code: '<main />',
        tags: [],
        source: 'manual',
        createdAt: 1,
        updatedAt: 1
      }
    }).userContext).toBe('in-room');
    expect(resolveToolVisibilityState({
      runtimeFeedback: {
        pendingWorkspaceProposal: {
          id: 'proposal-1',
          conversationId: 'conversation-1',
          source: 'model-proposed',
          requestedActionKinds: ['createRoomProject'],
          status: 'pending',
          createdAt: 1
        }
      }
    }).userContext).toBe('pending-workspace-proposal');
    expect(resolveToolVisibilityState({
      activeProject: {
        id: 'workspace-1',
        title: 'Workspace',
        slug: 'workspace',
        tags: [],
        source: 'manual',
        fileCount: 0,
        files: []
      }
    }).userContext).toBe('in-workspace');
    expect(resolveToolVisibilityState({
      activeProjectId: 'missing-workspace'
    }).userContext).toBe('chat-only');
    expect(resolveToolVisibilityState({ taskMode: 'seed' }).taskStage).toBe('seed-bare');
  });

  it('keeps task ledger tools scoped while regular tools follow app state', () => {
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.startTask, {
      taskMode: 'seed',
      enabledToolGroups: { task: true, generation: true }
    })).toBe(true);
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.startTask, {
      taskMode: 'seed',
      enabledToolGroups: { task: false, generation: true }
    })).toBe(false);
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.startTask, {
      taskMode: 'active',
      enabledToolGroups: { task: true, generation: true }
    })).toBe(false);
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.completeTask, {
      taskMode: 'seed',
      enabledToolGroups: { task: true, generation: true }
    })).toBe(false);
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.completeTask, {
      taskMode: 'active',
      enabledToolGroups: { task: true, generation: true }
    })).toBe(true);
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.createCodeCard, {
      taskMode: 'seed',
      enabledToolGroups: { room: true }
    })).toBe(true);
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.createCodeCard, {
      taskMode: 'seed',
      activeCard: {
        id: 'card-1',
        title: 'Room',
        language: 'html',
        code: '<main />',
        tags: [],
        source: 'manual',
        createdAt: 1,
        updatedAt: 1
      },
      enabledToolGroups: { room: true }
    })).toBe(true);
  });

  it('hides image generation until its dedicated route is configured', () => {
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.createQrCode, {
      enabledToolGroups: { generation: true }
    })).toBe(true);
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.generateImage, {
      enabledToolGroups: { generation: true }
    })).toBe(false);
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.generateImage, {
      enabledToolGroups: { generation: true },
      imageGenerationAvailable: true
    })).toBe(true);
  });

  it('shows image sending whenever attachment tools are enabled', () => {
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.sendImageAttachment, {
      enabledToolGroups: { attachment: true }
    })).toBe(true);
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.sendImageAttachment, {
      enabledToolGroups: { attachment: true },
      imageAssetSnapshot: {
        available: [{
          id: 'image-card-1',
          assetId: 'asset-image-1',
          title: 'Poster',
          tags: ['参考图'],
          source: 'manual',
          cssUrl: 'url("polaris-asset://asset-image-1")'
        }]
      }
    })).toBe(true);
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.sendImageAttachment, {
      enabledToolGroups: { attachment: true },
      attachmentSnapshot: {
        latest: [],
        available: [{
          id: 'attachment-image-1',
          assetId: 'asset-image-2',
          kind: 'image',
          name: 'photo.png',
          mimeType: 'image/png'
        }]
      }
    })).toBe(true);
  });

  it('shows personal data tools only for enabled and available native capabilities', () => {
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.listCalendars, {
      enabledToolGroups: { personalData: true },
      personalData: {
        calendarAvailable: true,
        calendarWriteAvailable: true
      }
    })).toBe(true);
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.readCalendarEvents, {
      enabledToolGroups: { personalData: true }
    })).toBe(false);
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.readCalendarEvents, {
      enabledToolGroups: { personalData: false },
      personalData: {
        calendarAvailable: true,
        calendarWriteAvailable: true
      }
    })).toBe(false);
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.readCalendarEvents, {
      enabledToolGroups: { personalData: true },
      personalData: {
        calendarAvailable: true,
        calendarWriteAvailable: true
      }
    })).toBe(true);
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.createCalendarEvent, {
      enabledToolGroups: { personalData: true },
      personalData: {
        calendarAvailable: false,
        calendarWriteAvailable: true
      }
    })).toBe(true);
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.updateCalendarEvent, {
      enabledToolGroups: { personalData: true },
      personalData: {
        calendarAvailable: false,
        calendarWriteAvailable: true
      }
    })).toBe(false);
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.updateCalendarEvent, {
      enabledToolGroups: { personalData: true },
      personalData: {
        calendarAvailable: true,
        calendarWriteAvailable: true
      }
    })).toBe(true);
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.deleteCalendarEvent, {
      enabledToolGroups: { personalData: true },
      personalData: {
        calendarAvailable: true,
        calendarWriteAvailable: false
      }
    })).toBe(false);
  });

  it('keeps explicitly opened theme tools visible in seed chat', () => {
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.appendThemeCss, {
      taskMode: 'seed',
      themeToolMode: 'creative',
      enabledToolGroups: { theme: true }
    })).toBe(true);
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.applyThemeCoordinates, {
      taskMode: 'seed',
      themeToolMode: 'stable',
      enabledToolGroups: { theme: true }
    })).toBe(true);
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.appendThemeCss, {
      taskMode: 'seed',
      themeToolMode: 'creative',
      enabledToolGroups: { theme: false }
    })).toBe(false);
  });

  it('separates room tools, workspace tools, and app theme tools by state', () => {
    const activeProject = {
      id: 'workspace-1',
      title: 'Workspace',
      slug: 'workspace',
      tags: [],
      source: 'manual' as const,
      fileCount: 0,
      files: []
    };

    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.createCodeCard, {
      enabledToolGroups: { room: true }
    })).toBe(true);
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.createProjectFile, {
      enabledToolGroups: { project: true }
    })).toBe(false);
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.createCodeCard, {
      activeProject,
      enabledToolGroups: { room: true }
    })).toBe(false);
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.createProjectFile, {
      activeProject,
      enabledToolGroups: { project: true }
    })).toBe(true);
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.createProjectFile, {
      activeProject,
      enabledToolGroups: { project: false }
    })).toBe(true);
    expect(isPolarisNativeToolVisible(POLARIS_TOOL_REGISTRY_BY_NAME.applySurfaceTokens, {
      activeProject,
      themeToolMode: 'stable',
      enabledToolGroups: { theme: true }
    })).toBe(false);
  });

  it('keeps parsed assistant action visibility compatible with the legacy parser boundary', () => {
    expect(isParsedAssistantActionVisible({
      actionKind: 'createRoomProject',
      tool: POLARIS_TOOL_REGISTRY_BY_NAME.createRoomProject,
      context: { enabledToolGroups: { project: true } }
    })).toBe(false);
    expect(isParsedAssistantActionVisible({
      actionKind: 'patchRawCss',
      tool: POLARIS_TOOL_REGISTRY_BY_NAME.patchRawCss,
      context: {
        activeProject: {
          id: 'workspace-1',
          title: 'Workspace',
          slug: 'workspace',
          tags: [],
          source: 'manual',
          fileCount: 0,
          files: []
        },
        themeToolMode: 'creative',
        enabledToolGroups: { theme: true }
      }
    })).toBe(false);
    expect(isParsedAssistantActionVisible({
      actionKind: 'patchCodeCard',
      tool: POLARIS_TOOL_REGISTRY_BY_NAME.patchCodeCard,
      context: { enabledToolGroups: { room: true } }
    })).toBe(true);
    expect(isParsedAssistantActionVisible({
      actionKind: 'readProjectFile',
      tool: POLARIS_TOOL_REGISTRY_BY_NAME.readProjectFile,
      context: {
        activeProjectId: 'workspace-1',
        enabledToolGroups: { project: false }
      }
    })).toBe(true);
  });
});
