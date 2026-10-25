import { describe, expect, it } from 'vitest';
import { RETIRED_POLARIS_ASSISTANT_PERSONA_ID } from '../config/persona/personaBuilder';
import { checkRoomProjectPreview } from '../engines/roomProjectPreview';
import { reconcileRoomProjects } from '../engines/roomProjects';
import type { ProjectFile, RoomProject } from '../types/domain';
import {
  STARTER_WORKBENCH_PROJECT_ID,
  createStarterWorkbenchProjectBundle,
  includeDefaultCollectionProjects
} from './collectionStarterProject';

describe('createStarterWorkbenchProjectBundle', () => {
  it('builds a stable runnable Pharos-owned workbench workspace', () => {
    const bundle = createStarterWorkbenchProjectBundle(1000);

    expect(bundle.project.id).toBe(STARTER_WORKBENCH_PROJECT_ID);
    expect(bundle.project.title).toBe('Polaris 小工作台');
    expect(bundle.project.slug).toBe('polaris-workbench');
    expect(bundle.project.ownerCollaboratorId).toBe('pharos');
    expect(bundle.project.coverNote).toContain('Pharos 房间的默认工作区');
    expect(bundle.project.tags).toEqual(['工作区', 'Pharos', 'starter']);
    expect(bundle.project.source).toBe('chat-generated');
    expect(bundle.project.createdAt).toBe(1000);
    expect(bundle.project.updatedAt).toBe(1000);
    expect(bundle.files.map((file) => file.filePath)).toEqual([
      'index.html',
      'styles.css',
      'app.js',
      'README.md'
    ]);
    expect(bundle.files.every((file) => file.ownerCollaboratorId === 'pharos')).toBe(true);
  });

  it('keeps the workspace extension path obvious and review-safe', () => {
    const bundle = createStarterWorkbenchProjectBundle(1000);
    const index = bundle.files.find((file) => file.filePath === 'index.html');
    const styles = bundle.files.find((file) => file.filePath === 'styles.css');
    const app = bundle.files.find((file) => file.filePath === 'app.js');
    const readme = bundle.files.find((file) => file.filePath === 'README.md');

    expect(index?.content).toContain('<title>Polaris 小工作台</title>');
    expect(index?.content).toContain('<link rel="stylesheet" href="./styles.css" />');
    expect(index?.content).toContain('<script src="./app.js"></script>');
    expect(index?.content).toContain('这是一份可编辑的工作区文档');
    expect(styles?.content).toContain('.workbench-shell');
    expect(styles?.content).toContain('.task-list');
    expect(styles?.content).toContain('.source-list');
    expect(styles?.content).toContain('.output-panel');
    expect(styles?.content).toContain(':root[data-theme="ink"]');
    expect(app?.content).toContain('polaris-starter-workbench-state');
    expect(app?.content).toContain('const STATE_VERSION = 2;');
    expect(app?.content).toContain('prefers-color-scheme: dark');
    expect(app?.content).toContain('document.documentElement.dataset.theme = state.theme');
    expect(app?.content).toContain('## 正文');
    expect(app?.content).toContain('data-task-form');
    expect(app?.content).toContain('data-source-form');
    expect(app?.content).toContain('data-copy-output');
    expect(app?.content).toContain('复制文档');
    expect(app?.content).toContain('buildMarkdown');
    expect(readme?.content).toContain('# Polaris 小工作台');
    expect(readme?.content).toContain('这是 Pharos 房间的默认工作区');
    expect(readme?.content).toContain('可以直接编辑、预览和复制');

    const combined = bundle.files.map((file) => file.content).join('\n');
    expect(combined).not.toContain('Pharos 的手机');
    expect(combined).not.toContain('user_');
    expect(combined).not.toContain('反爬');
    expect(combined).not.toContain('爬虫');
    expect(combined).not.toContain('Google缓存');
    expect(combined).not.toContain('我从零手写了一个PDF生成器');
    expect(combined).not.toContain('她花在我身上的钱');
    expect(combined).not.toContain('默认内容保持中性');
    expect(combined).not.toContain('只展示 Polaris 工作区能做什么');
    expect(combined).not.toContain('优先使用 `window.PolarisRoom`');
  });

  it('is previewable without external or missing assets', () => {
    const bundle = createStarterWorkbenchProjectBundle(1000);
    const projects = reconcileRoomProjects([bundle.project], [], bundle.files);
    const preview = checkRoomProjectPreview(projects[0], bundle.files);

    expect(preview.runnable).toBe(true);
    expect(preview.entryFilePath).toBe('index.html');
    expect(preview.fileCount).toBe(4);
    expect(preview.inlinedLocalAssets).toEqual(['styles.css', 'app.js']);
    expect(preview.missingLocalAssets).toEqual([]);
    expect(preview.externalAssets).toEqual([]);
  });
});

describe('includeDefaultCollectionProjects', () => {
  it('adds the bundled workbench workspace to an empty collection', () => {
    const result = includeDefaultCollectionProjects([], [], 2000);

    expect(result.roomProjects).toHaveLength(1);
    expect(result.roomProjects[0].id).toBe(STARTER_WORKBENCH_PROJECT_ID);
    expect(result.roomProjects[0].ownerCollaboratorId).toBe('pharos');
    expect(result.projectFiles).toHaveLength(4);
    expect(result.projectFiles.every((file) => file.projectId === STARTER_WORKBENCH_PROJECT_ID)).toBe(true);
  });

  it('preserves a user-owned starter project and only fills missing bundled files', () => {
    const existingProject: RoomProject = {
      id: STARTER_WORKBENCH_PROJECT_ID,
      title: '用户改过的小工作台',
      slug: 'custom-workbench',
      entryFileId: 'file-custom-index',
      fileIds: ['file-custom-index'],
      tags: ['private'],
      coverNote: '用户已经动过它。',
      source: 'manual',
      createdAt: 1000,
      updatedAt: 1000
    };
    const existingFile: ProjectFile = {
      id: 'file-custom-index',
      projectId: STARTER_WORKBENCH_PROJECT_ID,
      filePath: 'index.html',
      fileRole: 'entry',
      language: 'html',
      content: '<!doctype html><title>私人改动</title>',
      source: 'manual',
      createdAt: 1000,
      updatedAt: 1000
    };

    const result = includeDefaultCollectionProjects([existingProject], [existingFile], 2000);

    expect(result.roomProjects).toHaveLength(1);
    expect(result.roomProjects[0].title).toBe('用户改过的小工作台');
    expect(result.projectFiles.find((file) => file.id === 'file-custom-index')?.content).toContain('私人改动');
    expect(result.projectFiles.map((file) => file.id)).toContain('file-custom-index');
    expect(result.projectFiles.map((file) => file.filePath)).toEqual(expect.arrayContaining([
      'README.md',
      'app.js',
      'index.html',
      'styles.css'
    ]));
  });

  it('migrates the untouched Pharos phone starter into the current workbench', () => {
    const bundle = createStarterWorkbenchProjectBundle(1000);
    const legacyProject: RoomProject = {
      ...bundle.project,
      title: 'Pharos 的手机',
      slug: 'pocket-phone',
      ownerCollaboratorId: 'pharos',
      coverNote: 'Pharos 用到一半的小手机。每个 App 都留着他的痕迹，也留着继续长大的接口。',
      tags: ['工作区', 'Pharos', '小手机', 'starter']
    };

    const result = includeDefaultCollectionProjects([legacyProject], bundle.files, 2000);

    expect(result.roomProjects[0]).toMatchObject({
      title: 'Polaris 小工作台',
      slug: 'polaris-workbench',
      ownerCollaboratorId: 'pharos',
      tags: ['工作区', 'Pharos', 'starter']
    });
    expect(result.roomProjects[0].coverNote).toContain('Pharos 房间的默认工作区');
    expect(result.roomProjects[0].createdAt).toBe(1000);
    expect(result.roomProjects[0].updatedAt).toBe(2000);
  });

  it('does not overwrite an edited bundled file', () => {
    const bundle = createStarterWorkbenchProjectBundle(1000);
    const editedFile = {
      ...bundle.files.find((file) => file.filePath === 'app.js')!,
      content: 'console.log("user edited");',
      updatedAt: 1500
    };
    const result = includeDefaultCollectionProjects([bundle.project], [editedFile], 2000);

    expect(result.projectFiles).toHaveLength(4);
    expect(result.projectFiles.find((file) => file.id === editedFile.id)?.content).toBe('console.log("user edited");');
  });

  it('refreshes old phone starter files into the current workbench', () => {
    const bundle = createStarterWorkbenchProjectBundle(1000);
    const staleIndex = {
      ...bundle.files.find((file) => file.filePath === 'index.html')!,
      ownerCollaboratorId: 'pharos',
      content: '<!doctype html><title>Pharos 的手机</title><script src="./app.js" defer></script>',
      createdAt: 1000,
      updatedAt: 1500
    };
    const staleStyle = {
      ...bundle.files.find((file) => file.filePath === 'styles.css')!,
      ownerCollaboratorId: 'pharos',
      content: '.phone-shell {} .theme-chatlog {} .terminal-body {}',
      createdAt: 1000,
      updatedAt: 1500
    };
    const staleApp = {
      ...bundle.files.find((file) => file.filePath === 'app.js')!,
      ownerCollaboratorId: 'pharos',
      content: "const STORAGE_KEY = 'polaris-pocket-phone-state'; const chatThreads = []; const terminalEntries = [];",
      createdAt: 1000,
      updatedAt: 1500
    };
    const staleReadme = {
      ...bundle.files.find((file) => file.filePath === 'README.md')!,
      ownerCollaboratorId: 'pharos',
      content: '# Pharos 的手机\n\n全屏手机系统容器',
      createdAt: 1000,
      updatedAt: 1500
    };

    const result = includeDefaultCollectionProjects(
      [bundle.project],
      [staleIndex, staleStyle, staleApp, staleReadme],
      2000
    );

    expect(result.projectFiles.every((file) => file.ownerCollaboratorId === 'pharos')).toBe(true);
    expect(result.projectFiles.find((file) => file.filePath === 'index.html')?.content).toContain('Polaris 小工作台');
    expect(result.projectFiles.find((file) => file.filePath === 'styles.css')?.content).toContain('.workbench-shell');
    expect(result.projectFiles.find((file) => file.filePath === 'app.js')?.content).toContain('polaris-starter-workbench-state');
    expect(result.projectFiles.find((file) => file.filePath === 'README.md')?.content).toContain('Pharos 房间的默认工作区');
    expect(result.projectFiles.every((file) => file.updatedAt === 2000)).toBe(true);
  });
});
