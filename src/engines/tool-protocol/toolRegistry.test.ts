import { describe, expect, it } from 'vitest';
import {
  findPolarisToolManifestEntry,
  findPolarisToolDefinition,
  POLARIS_TOOL_MANIFEST_BY_NAME,
  POLARIS_TOOL_REGISTRY_BY_NAME,
  resolveAvailablePolarisTools,
  type ToolResolutionSource
} from './toolRegistry';
import { TOOL_INVOCATION_KINDS } from '../../types/toolInvocationKinds';
import { POLARIS_TOOL_EXECUTOR_BY_ACTION_KIND } from './toolManifest';

describe('toolRegistry', () => {
  it('materializes one complete manifest receipt for invocation, replay, and executor consumers', () => {
    expect(Object.keys(POLARIS_TOOL_MANIFEST_BY_NAME)).toEqual(TOOL_INVOCATION_KINDS);
    for (const name of TOOL_INVOCATION_KINDS) {
      const entry = POLARIS_TOOL_MANIFEST_BY_NAME[name];
      expect(entry.name).toBe(name);
      expect(entry.label.trim().length).toBeGreaterThan(0);
      if (name in POLARIS_TOOL_EXECUTOR_BY_ACTION_KIND) {
        expect(entry.executorPlugin).toBeDefined();
      }
    }
  });

  it('keeps canonical tool kinds addressable by registry name', () => {
    expect(findPolarisToolDefinition('runCode')).toEqual(POLARIS_TOOL_REGISTRY_BY_NAME.runCode);
    expect(POLARIS_TOOL_REGISTRY_BY_NAME.runCode.schema.name).toBe('runCode');
    expect(POLARIS_TOOL_REGISTRY_BY_NAME.startTask.schema.name).toBe('startTask');
    expect(POLARIS_TOOL_REGISTRY_BY_NAME.completeTask.schema.name).toBe('completeTask');
    expect(POLARIS_TOOL_REGISTRY_BY_NAME.wait.schema.name).toBe('wait');
    expect(POLARIS_TOOL_REGISTRY_BY_NAME.readPolarisKnowledge.schema.name).toBe('readPolarisKnowledge');
    expect(POLARIS_TOOL_REGISTRY_BY_NAME.saveArchiveEntryAsCodeCard.schema.name).toBe('saveArchiveEntryAsCodeCard');
  });

  it('resolves manifest metadata from the same entrypoint used by replay and executor dispatch', () => {
    expect(findPolarisToolManifestEntry('runCode')).toMatchObject({
      name: 'runCode',
      label: '执行代码',
      group: 'card',
      executorPlugin: 'utility',
      resultReplayMode: 'detail-excerpt',
      definition: POLARIS_TOOL_REGISTRY_BY_NAME.runCode
    });
    expect(findPolarisToolManifestEntry('invokeMcpTool')).toMatchObject({
      name: 'invokeMcpTool',
      label: '调用 MCP 工具',
      executorPlugin: 'mcp',
      resultReplayMode: 'full-detail'
    });
    expect(findPolarisToolManifestEntry('readPolarisKnowledge')).toMatchObject({
      name: 'readPolarisKnowledge',
      label: '读取 Polaris 产品知识',
      group: 'knowledge',
      executorPlugin: 'utility',
      resultReplayMode: 'full-detail',
      definition: POLARIS_TOOL_REGISTRY_BY_NAME.readPolarisKnowledge
    });
    expect(findPolarisToolManifestEntry('wait')).toMatchObject({
      name: 'wait',
      label: '等待轮询',
      group: 'task',
      executorPlugin: 'utility',
      resultReplayMode: 'detail-excerpt',
      definition: POLARIS_TOOL_REGISTRY_BY_NAME.wait
    });
  });

  it('exposes ordinary room tools in seed chat without requiring task activation', () => {
    const tools = resolveAvailablePolarisTools({
      taskMode: 'seed',
      activeCard: null,
      activeProject: null,
      roomContextMode: 'available',
      runtimeFeedback: {},
      enabledToolGroups: {
        room: true,
        project: true,
        attachment: true,
        generation: false,
        archive: true,
        web: true,
        memory: true
      }
    });

    expect(tools.some((tool) => tool.name === 'readProjectFile')).toBe(false);
    expect(tools.some((tool) => tool.name === 'editProjectFileText')).toBe(false);
    expect(tools.some((tool) => tool.name === 'createCodeCard')).toBe(true);
    expect(tools.some((tool) => tool.name === 'patchCodeCard')).toBe(true);
    expect(tools.some((tool) => tool.name === 'startTask')).toBe(true);
    expect(tools.some((tool) => tool.name === 'wait')).toBe(true);
    expect(tools.some((tool) => tool.name === 'completeTask')).toBe(false);
    expect(tools.some((tool) => tool.name === 'inspectAttachments')).toBe(false);
  });

  it('opens the full tool shelf for a seed task that is already inside a work context', () => {
    const tools = resolveAvailablePolarisTools({
      taskMode: 'seed',
      activeProject: {
        id: 'project-1',
        title: 'Mini Phone',
        entryFilePath: 'index.html',
        files: []
      },
      activeCard: null,
      roomContextMode: 'active',
      runtimeFeedback: {},
      enabledToolGroups: {
        room: true,
        project: true,
        attachment: true,
        archive: true,
        web: true,
        memory: true
      }
    } as never);

    expect(tools.some((tool) => tool.name === 'readProjectFile')).toBe(true);
    expect(tools.some((tool) => tool.name === 'replaceProjectFileLines')).toBe(true);
    expect(tools.some((tool) => tool.name === 'editProjectFileText')).toBe(true);
  });

  it('keeps workspace file tools available from workspace context even when project is not user-toggleable', () => {
    const tools = resolveAvailablePolarisTools({
      taskMode: 'active',
      activeProject: {
        id: 'project-1',
        title: 'Mini Phone',
        entryFilePath: 'index.html',
        files: []
      },
      activeCard: null,
      roomContextMode: 'active',
      runtimeFeedback: {},
      enabledToolGroups: {
        room: true,
        project: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    } as never);

    expect(tools.some((tool) => tool.name === 'startTask')).toBe(false);
    expect(tools.some((tool) => tool.name === 'wait')).toBe(true);
    expect(tools.some((tool) => tool.name === 'createProjectFile')).toBe(true);
    expect(tools.some((tool) => tool.name === 'writeProjectFiles')).toBe(true);
    expect(tools.some((tool) => tool.name === 'readProjectFile')).toBe(true);
  });

  it('hides app theme tools inside a workspace context', () => {
    const tools = resolveAvailablePolarisTools({
      taskMode: 'active',
      themeToolMode: 'creative',
      activeProject: {
        id: 'project-1',
        title: 'Mini Phone',
        entryFilePath: 'index.html',
        files: []
      },
      activeCard: null,
      roomContextMode: 'active',
      runtimeFeedback: {},
      enabledToolGroups: {
        room: true,
        project: true,
        theme: true,
        attachment: true,
        archive: true,
        web: true,
        memory: true
      }
    } as never);

    expect(tools.some((tool) => tool.name === 'patchRawCss')).toBe(false);
    expect(tools.some((tool) => tool.name === 'applyPreset')).toBe(false);
    expect(tools.some((tool) => tool.name === 'readProjectFile')).toBe(true);
    expect(tools.some((tool) => tool.name === 'replaceProjectFileLines')).toBe(true);
    expect(tools.some((tool) => tool.name === 'editProjectFileText')).toBe(true);
  });

  it('resolves visibility from a narrow tool resolution source', () => {
    const source: ToolResolutionSource = {
      taskMode: 'active',
      themeToolMode: 'stable',
      activeProject: null,
      activeCard: null,
      roomContextMode: 'available',
      runtimeFeedback: {},
      visibleCards: [],
      mcpTools: [],
      enabledToolGroups: {
        room: false,
        project: false,
        theme: true,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    };

    const tools = resolveAvailablePolarisTools(source);

    expect(tools.some((tool) => tool.name === 'applyThemeCoordinates')).toBe(true);
    expect(tools.some((tool) => tool.name === 'createCodeCard')).toBe(false);
    expect(tools.some((tool) => tool.name === 'readProjectFile')).toBe(false);
  });
});
