import { describe, expect, it } from 'vitest';
import { buildCapabilityEntries } from './requestPromptCapabilities';

describe('buildCapabilityEntries', () => {
  it('exposes reply rich markup capability in the system prompt', () => {
    const entries = buildCapabilityEntries({
      messages: [],
      toolContext: undefined,
      toolProtocolMode: 'hybrid'
    });

    const markupEntry = entries.find((entry) => entry.name === 'reply_markup_capability');
    expect(markupEntry?.content).toContain('<details><summary>标题</summary>内容</details>');
    expect(markupEntry?.content).toContain('<polaris-card title="标题" kicker="角标" tone="mist|warm|cool|rose|gold">内容</polaris-card>');
    expect(markupEntry?.content).toContain('<span style="...">...</span>');
  });

  it('passes the unlocked experimental runCode sandbox profile into the capability prompt', () => {
    const entries = buildCapabilityEntries({
      messages: [],
      toolContext: {
        activeCard: null,
        visibleCards: [],
        runCodeSandboxProfile: 'experimental',
        enabledToolGroups: {
          generation: true
        }
      },
      toolProtocolMode: 'hybrid'
    });

    expect(entries.some((entry) =>
      entry.content.includes('当前 runCode 沙箱：实验模式。可以联网 fetch / XHR / WebSocket、弹 modal / popup、跑 blob worker，也允许下载')
    )).toBe(true);
    expect(entries.some((entry) => entry.content.includes(`Polaris${'Host'}`))).toBe(false);
  });

  it('splits tool capability into separate prompt parts instead of one monolith', () => {
    const entries = buildCapabilityEntries({
      messages: [],
      toolContext: {
        themeToolMode: 'stable',
        themeContextMode: 'none',
        toolEnforcementMode: 'normal',
        modelTier: 'medium',
        themePreviewActive: false,
        activeCard: null,
        visibleCards: [],
        enabledToolGroups: {
          room: true,
          project: true,
          theme: false,
          attachment: false,
          generation: false,
          archive: false,
          web: false,
          memory: false
        }
      },
      toolProtocolMode: 'hybrid'
    });

    expect(entries.map((entry) => entry.name)).toEqual(expect.arrayContaining([
      'tool_capability',
      'tool_catalog_capability',
      'tool_protocol_capability'
    ]));
    expect(entries.find((entry) => entry.name === 'tool_capability')?.content).toContain('对象边界：');
    expect(entries.find((entry) => entry.name === 'tool_catalog_capability')?.content).toContain('工具目录：');
    expect(entries.find((entry) => entry.name === 'tool_protocol_capability')?.content).toContain('协议 fallback：');
  });

  it('does not expand tool catalog or protocol guidance when every toolbox group is off', () => {
    const entries = buildCapabilityEntries({
      messages: [],
      toolContext: {
        activeCard: null,
        visibleCards: [],
        themeToolMode: 'off',
        enabledToolGroups: {
          environment: false,
          knowledge: false,
          task: false,
          room: false,
          desktop: false,
          theme: false,
          attachment: false,
          generation: false,
          archive: false,
          web: false,
          mcp: false,
          memory: false,
          memoryRecall: false,
          memoryWrite: false,
          proactive: false
        }
      },
      toolProtocolMode: 'hybrid'
    });

    expect(entries.find((entry) => entry.name === 'tool_disabled_capability')).toMatchObject({
      layer: 'capability',
      content: expect.stringContaining('用户目前关闭了所有工具')
    });
    expect(entries.find((entry) => entry.name === 'tool_capability')).toBeUndefined();
    expect(entries.find((entry) => entry.name === 'tool_catalog_capability')).toBeUndefined();
    expect(entries.find((entry) => entry.name === 'tool_protocol_capability')).toBeUndefined();
  });

  it('splits tool context snapshots into dynamic context prompt parts', () => {
    const entries = buildCapabilityEntries({
      messages: [],
      toolContext: {
        activeCard: null,
        visibleCards: [],
        activeProject: {
          id: 'workspace-mini-phone',
          title: 'Mini Phone',
          slug: 'mini-phone',
          tags: [],
          source: 'chat-generated',
          fileCount: 1,
          files: [],
          entryFileId: 'file-1',
          entryFilePath: 'index.html'
        },
        uiSnapshot: {
          activeWorld: 'chat',
          collectionShelf: 'code',
          activeConversationTitle: '测试对话',
          activeCollaboratorName: 'Pharos',
          chatAvatarLayoutEnabled: true
        },
        attachmentSnapshot: {
          latest: [{ id: 'attachment-1', kind: 'image', name: 'screen.png' }],
          available: [{ id: 'attachment-1', kind: 'image', name: 'screen.png' }]
        },
        enabledToolGroups: {
          room: true,
          project: true,
          attachment: true,
          theme: false,
          desktop: true
        },
        desktopLocalHost: {
          available: true,
          platform: 'darwin',
          permissionMode: 'trusted',
          trustedRoots: [{
            id: 'local-root-1',
            label: 'Polaris',
            path: '/Users/example/Desktop/Polaris',
            lastUsedAt: 1
          }]
        }
      },
      toolProtocolMode: 'hybrid'
    });

    expect(entries.find((entry) => entry.name === 'tool_context_capability')).toBeUndefined();
    expect(entries.find((entry) => entry.name === 'ui_context_capability')).toMatchObject({
      layer: 'context'
    });
    expect(entries.find((entry) => entry.name === 'attachment_context_capability')).toMatchObject({
      layer: 'context'
    });
    expect(entries.find((entry) => entry.name === 'desktop_local_context_capability')).toMatchObject({
      layer: 'context'
    });
    expect(entries.find((entry) => entry.name === 'room_context_capability')).toMatchObject({
      layer: 'context'
    });
    const uiContext = entries.find((entry) => entry.name === 'ui_context_capability')?.content;
    expect(uiContext).toContain('当前界面：对话区');
    expect(uiContext).toContain('对话式聊天软件布局');
    expect(uiContext).toContain('普通文字每次换行');
    expect(uiContext).toContain('工具只调用一次');
    expect(entries.find((entry) => entry.name === 'attachment_context_capability')?.content).toContain('最近一条用户附件：');
    expect(entries.find((entry) => entry.name === 'desktop_local_context_capability')?.content).toContain('本机环境：');
    expect(entries.find((entry) => entry.name === 'room_context_capability')?.content).toContain('当前活动工作区：Mini Phone');
  });
});
