import {
  STARTER_WORKBENCH_PROJECT_APP_FILE_ID,
  STARTER_WORKBENCH_PROJECT_ID,
  STARTER_WORKBENCH_PROJECT_INDEX_FILE_ID,
  STARTER_WORKBENCH_PROJECT_README_FILE_ID,
  STARTER_WORKBENCH_PROJECT_STYLE_FILE_ID
} from '../content/bundledCollection/starterWorkbenchProject/ids';
import { STARTER_WORKBENCH_PROJECT_APP_JS } from '../content/bundledCollection/starterWorkbenchProject/appJs';
import { STARTER_WORKBENCH_PROJECT_INDEX_HTML } from '../content/bundledCollection/starterWorkbenchProject/indexHtml';
import { STARTER_WORKBENCH_PROJECT_README_MD } from '../content/bundledCollection/starterWorkbenchProject/readmeMd';
import { STARTER_WORKBENCH_PROJECT_STYLES_CSS } from '../content/bundledCollection/starterWorkbenchProject/stylesCss';
import { RETIRED_POLARIS_ASSISTANT_PERSONA_ID } from '../config/persona/personaBuilder';
import { createRoomProject, sortRoomProjects } from '../engines/roomProjects';
import type { ProjectFile, RoomProject } from '../types/domain';
import { createProjectFileEntry, sortProjectFiles } from './collectionStoreProjectFiles';

export { STARTER_WORKBENCH_PROJECT_ID } from '../content/bundledCollection/starterWorkbenchProject/ids';

type StarterProjectBundle = {
  project: RoomProject;
  files: ProjectFile[];
};

function refreshKnownStarterWorkbenchProject(project: RoomProject, bundledProject: RoomProject, now: number) {
  const isKnownStarter =
    project.id === bundledProject.id
    && project.source === 'chat-generated'
    && (project.ownerCollaboratorId === 'pharos' || project.ownerCollaboratorId === RETIRED_POLARIS_ASSISTANT_PERSONA_ID)
    && ['掌心小手机', 'Pharos 的手机', bundledProject.title].includes(project.title);

  if (!isKnownStarter) return project;

  return {
    ...project,
    title: bundledProject.title,
    slug: bundledProject.slug,
    ownerCollaboratorId: bundledProject.ownerCollaboratorId,
    coverNote: bundledProject.coverNote,
    tags: bundledProject.tags,
    updatedAt: now
  };
}

function isKnownStarterWorkbenchRevision(file: ProjectFile) {
  if (file.updatedAt === file.createdAt) return true;

  switch (file.id) {
    case STARTER_WORKBENCH_PROJECT_INDEX_FILE_ID:
      return file.content.includes('<title>Polaris 小工作台</title>')
        || file.content.includes('Pharos 的手机')
        || file.content.includes('掌心小手机')
        || file.content.includes('POCKET DESKTOP')
        || file.content.includes('data-open-app=')
        || file.content.includes('也都留着继续长大的接口')
        || file.content.includes('<script src="./app.js" defer></script>');
    case STARTER_WORKBENCH_PROJECT_STYLE_FILE_ID:
      return file.content.includes('.workbench-shell')
        || file.content.includes('.phone-shell')
        || file.content.includes('.theme-chatlog')
        || file.content.includes('.terminal-body')
        || file.content.includes('.signal-field')
        || file.content.includes('.fox-wrap')
        || file.content.includes('.todo-wrap')
        || file.content.includes('.settings-card')
        || file.content.includes('.notes-wrap')
        || file.content.includes('.chat-bubble.pharos');
    case STARTER_WORKBENCH_PROJECT_APP_FILE_ID:
      return file.content.includes('polaris-starter-workbench-state')
        || file.content.includes('polaris-pocket-phone-state')
        || file.content.includes('给后来的 AI')
        || file.content.includes('续搭说明')
        || file.content.includes('const chatThreads = [')
        || file.content.includes('const terminalEntries = [')
        || file.content.includes("id: 'terminal'")
        || file.content.includes("id: 'chatlog'")
        || file.content.includes("id: 'signal'")
        || file.content.includes("id: 'memo'")
        || file.content.includes("id: 'diary'")
        || file.content.includes("id: 'fox'")
        || file.content.includes('memo-detail-back')
        || file.content.includes('todo-compose');
    case STARTER_WORKBENCH_PROJECT_README_FILE_ID:
      return file.content.includes('# Polaris 小工作台')
        || file.content.includes('# Pharos 的手机')
        || file.content.includes('这是一台可以继续长大的小手机')
        || file.content.includes('全屏手机系统容器');
    default:
      return false;
  }
}

export function createStarterWorkbenchProjectBundle(now = Date.now()): StarterProjectBundle {
  const project = createRoomProject({
    id: STARTER_WORKBENCH_PROJECT_ID,
    title: 'Polaris 小工作台',
    slug: 'polaris-workbench',
    ownerCollaboratorId: 'pharos',
    entryFileId: STARTER_WORKBENCH_PROJECT_INDEX_FILE_ID,
    fileIds: [
      STARTER_WORKBENCH_PROJECT_INDEX_FILE_ID,
      STARTER_WORKBENCH_PROJECT_STYLE_FILE_ID,
      STARTER_WORKBENCH_PROJECT_APP_FILE_ID,
      STARTER_WORKBENCH_PROJECT_README_FILE_ID
    ],
    coverNote: 'Pharos 房间的默认工作区：便签、任务、摘录和 Markdown 预览，用来认识多文件项目怎么继续改。',
    tags: ['工作区', 'Pharos', 'starter'],
    source: 'chat-generated',
    createdAt: now,
    updatedAt: now
  });

  const commonFileSeed = {
    projectId: project.id,
    ownerCollaboratorId: 'pharos',
    source: 'chat-generated' as const,
    createdAt: now,
    updatedAt: now
  };

  const files = [
    createProjectFileEntry({
      ...commonFileSeed,
      id: STARTER_WORKBENCH_PROJECT_INDEX_FILE_ID,
      filePath: 'index.html',
      fileRole: 'entry',
      language: 'html',
      content: STARTER_WORKBENCH_PROJECT_INDEX_HTML
    }),
    createProjectFileEntry({
      ...commonFileSeed,
      id: STARTER_WORKBENCH_PROJECT_STYLE_FILE_ID,
      filePath: 'styles.css',
      fileRole: 'style',
      language: 'css',
      content: STARTER_WORKBENCH_PROJECT_STYLES_CSS
    }),
    createProjectFileEntry({
      ...commonFileSeed,
      id: STARTER_WORKBENCH_PROJECT_APP_FILE_ID,
      filePath: 'app.js',
      fileRole: 'logic',
      language: 'javascript',
      content: STARTER_WORKBENCH_PROJECT_APP_JS
    }),
    createProjectFileEntry({
      ...commonFileSeed,
      id: STARTER_WORKBENCH_PROJECT_README_FILE_ID,
      filePath: 'README.md',
      fileRole: 'note',
      language: 'markdown',
      content: STARTER_WORKBENCH_PROJECT_README_MD
    })
  ];

  return { project, files };
}

export function includeDefaultCollectionProjects(
  projects: RoomProject[],
  projectFiles: ProjectFile[],
  now = Date.now()
) {
  const bundle = createStarterWorkbenchProjectBundle(now);
  const existingProject = projects.find((project) => project.id === bundle.project.id);
  const bundledFilesById = new Map(bundle.files.map((file) => [file.id, file] as const));
  const existingFileIds = new Set(projectFiles.map((file) => file.id));
  const refreshedProjectFiles = projectFiles.map((file) => {
    const bundledFile = bundledFilesById.get(file.id);
    const isUntouchedBundledFile = Boolean(bundledFile)
      && file.projectId === bundle.project.id
      && file.source === 'chat-generated'
      && (file.ownerCollaboratorId === 'pharos' || file.ownerCollaboratorId === RETIRED_POLARIS_ASSISTANT_PERSONA_ID)
      && isKnownStarterWorkbenchRevision(file);

    if (!bundledFile || !isUntouchedBundledFile) {
      return file;
    }

    return {
      ...bundledFile,
      createdAt: file.createdAt,
      updatedAt: now
    };
  });
  const missingBundledFiles = bundle.files.filter((file) => !existingFileIds.has(file.id));

  return {
    roomProjects: existingProject
      ? sortRoomProjects(projects.map((project) => refreshKnownStarterWorkbenchProject(project, bundle.project, now)))
      : sortRoomProjects([bundle.project, ...projects]),
    projectFiles: missingBundledFiles.length > 0
      ? sortProjectFiles([...missingBundledFiles, ...refreshedProjectFiles])
      : sortProjectFiles(refreshedProjectFiles)
  };
}
