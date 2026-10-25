import { describe, expect, it } from 'vitest';
import {
  formatProductDocAsMarkdown,
  formatProductDocIndexAsMarkdown,
  getProductDoc,
  getProductDocs,
  readProductDocByTopic
} from './productDocs';

describe('productDocs', () => {
  it('includes a theme beautification selector guide with avatar image boundaries', () => {
    const markdown = formatProductDocAsMarkdown(getProductDoc('ai-guide'));

    expect(markdown).toContain('## 如果你想找主题美化选区');
    expect(markdown).toContain('chat-user-avatar-frame');
    expect(markdown).toContain('主题 CSS 只能改头像外框');
    expect(markdown).toContain('不能把图片内容改成另一个颜色');
  });

  it('teaches recent user-facing confusion points in the product guide', () => {
    const userGuide = formatProductDocAsMarkdown(getProductDoc('user-guide'));
    const aiGuide = formatProductDocAsMarkdown(getProductDoc('ai-guide'));
    const backupGuide = formatProductDocAsMarkdown(getProductDoc('backup-migration'));

    expect(userGuide).toContain('Web 和 Android 新装只会内置 Pharos / 灯塔');
    expect(userGuide).toContain('对话式头像布局');
    expect(userGuide).toContain('MCP 是 Polaris 应用内连接外部工具服务的入口');
    expect(userGuide).toContain('平台和版本怎么说');
    expect(userGuide).toContain('工作区预览运行在独立 iframe 里');

    expect(aiGuide).toContain('## 用户困惑高发点');
    expect(aiGuide).toContain('warning 不是整次上传失败');
    expect(aiGuide).toContain('结构化备份包是可见 store 状态和资产索引的快照');
    expect(aiGuide).toContain('room-state:project:<projectId>');
    expect(aiGuide).toContain('window.PolarisRoom undefined');
    expect(aiGuide).toContain('## 工作区预览持久化写法');
    expect(aiGuide).toContain("const STORAGE_KEY = 'inspiration-workspace-state-v1';");
    expect(aiGuide).toContain('不要只写 `state.notes.push(nextNote); render();`');

    expect(backupGuide).toContain('不是底层 LocalData repository 的原始转储');
  });

  it('builds a compact chapter index before reading the full AI guide', () => {
    const doc = getProductDoc('ai-guide');
    const markdown = formatProductDocAsMarkdown(doc);
    const index = formatProductDocIndexAsMarkdown(doc);

    expect(index).toContain('# Polaris 产品知识章节索引');
    expect(index).toContain('先按用户问题选择一个章节');
    expect(index).toContain('1. 文档定位');
    expect(index).toContain('主动消息');
    expect(index.length).toBeLessThan(markdown.length);
  });

  it('returns the chapter index by default and requires an explicit full read', () => {
    const doc = getProductDoc('ai-guide');

    expect(readProductDocByTopic(doc)).toMatchObject({
      summary: '已读取 Polaris 产品知识章节索引'
    });
    expect(readProductDocByTopic(doc).detailText).toContain('# Polaris 产品知识章节索引');

    expect(readProductDocByTopic(doc, '全文')).toMatchObject({
      summary: '已读取 Polaris 产品知识全文'
    });
    expect(readProductDocByTopic(doc, '全文').detailText).toContain('## 核心对象和状态边界');
  });

  it('returns a section for a matching topic and falls back to the index when unmatched', () => {
    const doc = getProductDoc('ai-guide');
    const matched = readProductDocByTopic(doc, '主题美化选区');
    const unmatched = readProductDocByTopic(doc, '不存在的小章节');

    expect(matched.summary).toContain('如果你想找主题美化选区');
    expect(matched.detailText).toContain('chat-user-avatar-frame');
    expect(matched.detailText).not.toContain('## 请求和供应商原理');

    const persistence = readProductDocByTopic(doc, '持久化写法');
    expect(persistence.summary).toContain('工作区预览持久化写法');
    expect(persistence.detailText).toContain('loadState');
    expect(persistence.detailText).toContain('saveState');

    expect(unmatched.summary).toBe('未找到“不存在的小章节”的精确章节，已返回 Polaris 产品知识章节索引');
    expect(unmatched.detailText).toContain('# Polaris 产品知识章节索引');
  });

  it('provides localized product docs for English UI without changing the default Chinese docs', () => {
    const englishDocs = getProductDocs('en-US');
    const userGuide = getProductDoc('user-guide', 'en-US');
    const backupGuide = getProductDoc('backup-migration', 'en-US');
    const privacy = getProductDoc('privacy', 'en-US');
    const userGuideMarkdown = formatProductDocAsMarkdown(userGuide, 'en-US');
    const backupGuideMarkdown = formatProductDocAsMarkdown(backupGuide, 'en-US');
    const markdown = formatProductDocAsMarkdown(privacy, 'en-US');

    expect(englishDocs.find((doc) => doc.id === 'user-guide')?.title).toBe('Polaris User Guide');
    expect(userGuideMarkdown).toContain('## What Polaris is');
    expect(userGuideMarkdown).toContain('Polaris is an AI workspace that brings chats, collaborators, rooms, workspaces, tools, and local materials together.');
    expect(userGuideMarkdown).toContain('## Toolbox');
    expect(backupGuideMarkdown).toContain('## What a backup contains');
    expect(backupGuideMarkdown).toContain('Restoring a backup overwrites the current local data with the backup contents.');
    expect(privacy.title).toBe('Privacy Policy');
    expect(markdown).toContain('Updated 2026-05-30');
    expect(markdown).toContain('## Local data storage');
    expect(markdown).toContain('Polaris does not upload the local chat database to official Polaris servers by default.');
    expect(getProductDoc('privacy').title).toBe('隐私政策');
  });

  it('can localize product knowledge chapter-by-chapter including tool and safety references', () => {
    const aiGuide = getProductDoc('ai-guide', 'en-US');
    const markdown = formatProductDocAsMarkdown(aiGuide, 'en-US');
    const matched = readProductDocByTopic(aiGuide, 'provider mechanics', 'en-US');
    const mcp = readProductDocByTopic(aiGuide, 'MCP mechanics', 'en-US');
    const workspace = readProductDocByTopic(aiGuide, 'project files, and references', 'en-US');
    const persistence = readProductDocByTopic(aiGuide, 'preview state', 'en-US');
    const proactive = readProductDocByTopic(aiGuide, 'Proactive message rules', 'en-US');
    const attachments = readProductDocByTopic(aiGuide, 'local assets', 'en-US');
    const backup = readProductDocByTopic(aiGuide, 'cross-device migration', 'en-US');
    const selectors = readProductDocByTopic(aiGuide, 'theme beautification selectors', 'en-US');
    const safety = readProductDocByTopic(aiGuide, 'Safe editing zones', 'en-US');

    expect(markdown).toContain('## Document purpose');
    expect(markdown).toContain('Polaris state is split across several long-lived objects');
    expect(markdown).toContain('## Safety and privacy boundaries');
    expect(markdown).not.toContain('## 备份和跨设备');
    expect(matched.summary).toContain('Requests and provider mechanics');
    expect(matched.detailText).toContain('The most important provider fields are base URL, path, protocol, model, and API key.');
    expect(mcp.summary).toContain('MCP mechanics and troubleshooting');
    expect(mcp.detailText).toContain('MCP tool results may contain text, image, audio, resource, or structuredContent.');
    expect(workspace.summary).toContain('Workspaces, project files, and references');
    expect(workspace.detailText).toContain('Ordinary chat and workspace chat are different contexts.');
    expect(persistence.summary).toContain('How to persist workspace preview state');
    expect(persistence.detailText).toContain("const STORAGE_KEY = 'inspiration-workspace-state-v1';");
    expect(proactive.summary).toContain('Proactive message rules');
    expect(proactive.detailText).toContain('origin=trigger-runtime');
    expect(attachments.summary).toContain('Attachments, images, and local assets');
    expect(attachments.detailText).toContain('polaris-asset://assetId is the internal Polaris asset protocol');
    expect(backup.summary).toContain('Backups and cross-device migration');
    expect(backup.detailText).toContain('A full backup is closer to moving house than editing on multiple devices at once.');
    expect(selectors.summary).toContain('When choosing theme beautification selectors');
    expect(selectors.detailText).toContain('theme CSS can only change the avatar frame');
    expect(safety.summary).toContain('Safe editing zones and common intent mapping');
    expect(safety.detailText).toContain('“can call” is not the same as “should call.”');
  });
});
