import { describe, expect, it } from 'vitest';
import { resolveAssistantToolRequestTools } from './assistantToolProtocolRequestTools';
import { CARD_TOOL_DEFINITION_MAP } from './toolRegistryCards';
import {
  findPolarisToolDefinition,
  findPolarisToolManifestEntry,
  resolveAvailablePolarisToolNames
} from './toolRegistry';
import { isPolarisToolExposedAsNative } from './toolRegistry';
import { isParsedAssistantActionVisible } from './toolVisibility';
import type { AssistantToolContext } from './assistantToolProtocolTypes';

type CardRegistryName = keyof typeof CARD_TOOL_DEFINITION_MAP;

function workspaceSnapshot(options?: { previewStateAccess?: boolean }) {
  return {
    id: 'workspace-mini-phone',
    title: 'Mini Phone',
    slug: 'mini-phone',
    tags: [],
    source: 'chat-generated' as const,
    fileCount: 1,
    files: [],
    entryFileId: 'file-1',
    entryFilePath: 'index.html',
    ...(options?.previewStateAccess ? {
      previewStateAccess: {
        assistantReadEnabled: true
      }
    } : {})
  };
}

function baseContext(): AssistantToolContext {
  return {
    taskMode: 'active',
    themeToolMode: 'stable',
    themeContextMode: 'none',
    toolEnforcementMode: 'normal',
    themePreviewActive: false,
    enabledToolGroups: {
      room: true,
      project: true,
      theme: false,
      attachment: false,
      generation: false,
      archive: false,
      web: false,
      memory: false
    },
    activeCard: null,
    visibleCards: []
  };
}

function nativeRequestNames(context: AssistantToolContext) {
  return resolveAssistantToolRequestTools(context).tools.map((tool) => tool.function.name);
}

function cardToolNamesByGroup(group: 'card' | 'project' | 'cross-boundary') {
  return (Object.entries(CARD_TOOL_DEFINITION_MAP) as Array<[CardRegistryName, typeof CARD_TOOL_DEFINITION_MAP[CardRegistryName]]>)
    .filter(([, tool]) => tool.group === group)
    .map(([name]) => name);
}

describe('CARD_TOOL_DEFINITION_MAP', () => {
  it('keeps every card/workspace tool wired through registry, manifest, and schema names', () => {
    for (const [name, definition] of Object.entries(CARD_TOOL_DEFINITION_MAP)) {
      expect(definition.name).toBe(name);
      expect(definition.schema.name).toBe(name);
      expect(definition.brief.trim().length).toBeGreaterThan(0);
      expect(findPolarisToolDefinition(name)).toBe(definition);
      expect(definition.rules.length).toBeGreaterThan(0);

      const manifest = findPolarisToolManifestEntry(name);
      expect(manifest, `${name} is missing from the composed tool manifest`).toBeDefined();
      expect(manifest?.definition).toBe(definition);
      expect(manifest?.group).toBe(definition.group);
      expect(manifest?.executorPlugin).toBe('collection');
      expect(manifest?.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('exposes room-card native tools only outside active workspace and project native tools only inside it', () => {
    const roomContext = baseContext();
    const workspaceContext: AssistantToolContext = {
      ...baseContext(),
      activeProject: workspaceSnapshot()
    };
    const roomNativeNames = nativeRequestNames(roomContext);
    const workspaceNativeNames = nativeRequestNames(workspaceContext);

    const cardNativeNames = Object.values(CARD_TOOL_DEFINITION_MAP)
      .filter((tool) => tool.group === 'card' && isPolarisToolExposedAsNative(tool))
      .map((tool) => tool.name);
    const previewStateToolName = 'readWorkspacePreviewState';
    const projectNativeNames = Object.values(CARD_TOOL_DEFINITION_MAP)
      .filter((tool) => tool.group === 'project' && isPolarisToolExposedAsNative(tool))
      .filter((tool) => tool.name !== previewStateToolName)
      .map((tool) => tool.name);
    const crossBoundaryNames = cardToolNamesByGroup('cross-boundary');

    for (const name of cardNativeNames) {
      expect(roomNativeNames, `${name} should be native-visible in room context`).toContain(name);
      expect(workspaceNativeNames, `${name} should not be native-visible in workspace context`).not.toContain(name);
    }
    for (const name of projectNativeNames) {
      expect(roomNativeNames, `${name} should not be native-visible outside workspace`).not.toContain(name);
      expect(workspaceNativeNames, `${name} should be native-visible in workspace context`).toContain(name);
    }
    expect(roomNativeNames).not.toContain(previewStateToolName);
    expect(workspaceNativeNames).not.toContain(previewStateToolName);
    expect(nativeRequestNames({
      ...workspaceContext,
      activeProject: workspaceSnapshot({ previewStateAccess: true })
    })).toContain(previewStateToolName);
    for (const name of crossBoundaryNames) {
      expect(roomNativeNames, `${name} must stay out of ordinary native request tools`).not.toContain(name);
      expect(workspaceNativeNames, `${name} must stay out of workspace native request tools`).not.toContain(name);
    }
  });

  it('keeps project draft writes internal to the parsed protocol while workspace-native tools stay in request schemas', () => {
    const context: AssistantToolContext = {
      ...baseContext(),
      activeProject: workspaceSnapshot()
    };
    const nativeNames = nativeRequestNames(context);
    const availableNames = resolveAvailablePolarisToolNames(context);

    expect(CARD_TOOL_DEFINITION_MAP.writeProjectFiles.exposeAsNative).toBe(false);
    expect(nativeNames).not.toContain('writeProjectFiles');
    expect(availableNames.has('writeProjectFiles')).toBe(true);
    expect(isParsedAssistantActionVisible({
      actionKind: 'writeProjectFiles',
      tool: CARD_TOOL_DEFINITION_MAP.writeProjectFiles,
      context: {
        activeProject: workspaceSnapshot(),
        enabledToolGroups: context.enabledToolGroups,
        themeToolMode: context.themeToolMode,
        toolEnforcementScope: context.toolEnforcementScope
      }
    })).toBe(true);

    expect(nativeNames).toContain('createProjectFile');
    expect(nativeNames).toContain('appendProjectFile');
    expect(nativeNames).toContain('replaceProjectFileLines');
    expect(nativeNames).toContain('editProjectFileText');
    expect(nativeNames).toContain('readProjectFile');
  });

  it('keeps model-driven workspace boundary actions unavailable through parsed fallback', () => {
    const context: AssistantToolContext = baseContext();

    for (const name of cardToolNamesByGroup('cross-boundary')) {
      expect(isParsedAssistantActionVisible({
        actionKind: name,
        tool: CARD_TOOL_DEFINITION_MAP[name],
        context: {
          activeProject: workspaceSnapshot(),
          enabledToolGroups: context.enabledToolGroups,
          themeToolMode: context.themeToolMode,
          toolEnforcementScope: context.toolEnforcementScope
        }
      }), `${name} must require an explicit user-approved product path`).toBe(false);
    }
  });
});
