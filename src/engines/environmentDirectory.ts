import type {
  CollectionShelf,
  CodeCard,
  Conversation,
  ImageAssetCard,
  McpServerConfig,
  PersonaMemoryReferenceDoc,
  ProjectFile,
  ProviderProfile,
  RoomProject,
  WebSearchConfig,
  WorkspaceReferenceDoc,
  World
} from '../types/domain';
import type { DesktopLocalHostState } from '../desktop/localHost';
import type { ToolResult } from './toolResult';

export type EnvironmentDirectoryAction =
  | {
      kind: 'listEnvironmentNodes';
      parentNodeId?: string;
      depth?: number;
      targetLabel?: string;
    }
  | {
      kind: 'inspectEnvironmentNode';
      nodeId: string;
      detailLevel?: 'summary' | 'expanded';
      targetLabel?: string;
    }
  | {
      kind: 'searchEnvironmentNodes';
      query: string;
      scopeNodeId?: string;
      targetLabel?: string;
    };

export type EnvironmentDirectorySnapshot = {
  activeWorld: World;
  collectionShelf: CollectionShelf;
  activeConversation?: Pick<Conversation, 'id' | 'collaboratorId' | 'activeProjectId'> & { title?: string } | null;
  activeCollaboratorName?: string | null;
  activeCardId?: string | null;
  cards: Array<Pick<CodeCard, 'id' | 'title' | 'language' | 'kind' | 'tags'>>;
  imageCards: Array<Pick<ImageAssetCard, 'id' | 'title' | 'assetId' | 'tags' | 'source'>>;
  roomProjects: Array<Pick<RoomProject, 'id' | 'title' | 'slug' | 'entryFileId'>>;
  projectFiles: Array<Pick<ProjectFile, 'id' | 'projectId' | 'filePath' | 'language' | 'fileRole' | 'updatedAt'>>;
  workspaceReferenceDocs: Array<Pick<WorkspaceReferenceDoc, 'id' | 'projectId' | 'title' | 'summary' | 'source'>>;
  memoryDocs: Array<Pick<PersonaMemoryReferenceDoc, 'id' | 'title' | 'summary' | 'updatedAt'>>;
  providers: Array<Pick<ProviderProfile, 'id' | 'name' | 'protocol' | 'model'>>;
  activeProviderId?: string | null;
  mcpServers: Array<Pick<McpServerConfig, 'id' | 'name' | 'isActive' | 'tools'>>;
  webSearch: WebSearchConfig;
  desktopLocalHost?: DesktopLocalHostState | null;
  attachmentCount: number;
  archiveAttachmentCount: number;
  imageAttachmentCount: number;
  calendarAvailable?: boolean;
  calendarWriteAvailable?: boolean;
  imageGenerationAvailable?: boolean;
  memorySearchAvailable?: boolean;
};

type EnvironmentNodeKind =
  | 'root'
  | 'scene'
  | 'directory'
  | 'settings'
  | 'workspace'
  | 'room-card'
  | 'file'
  | 'tool-lane'
  | 'external';

type EnvironmentNodeAction = {
  label: string;
  toolName?: string;
  target?: string;
  note?: string;
};

export type EnvironmentNode = {
  id: string;
  parentId?: string;
  kind: EnvironmentNodeKind;
  title: string;
  summary: string;
  status?: string;
  keywords: string[];
  childIds: string[];
  actions: EnvironmentNodeAction[];
  evidence: string[];
};

type DirectoryIndex = {
  nodes: EnvironmentNode[];
  byId: Map<string, EnvironmentNode>;
};

const ROOT_NODE_ID = 'environment';

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function addNode(nodes: EnvironmentNode[], node: Omit<EnvironmentNode, 'keywords'> & { keywords?: string[] }) {
  nodes.push({
    ...node,
    keywords: [
      node.id,
      node.title,
      node.summary,
      node.status ?? '',
      ...(node.keywords ?? [])
    ].map(normalizeText).filter(Boolean)
  });
}

function activeProvider(snapshot: EnvironmentDirectorySnapshot) {
  return snapshot.providers.find((provider) => provider.id === snapshot.activeProviderId) ?? snapshot.providers[0] ?? null;
}

function isWebSearchConfigured(config: WebSearchConfig) {
  if (config.provider === 'bingLocal') return true;
  if (config.provider === 'custom') return Boolean(config.customEndpoint.trim());
  return Boolean(config.apiKey.trim());
}

function projectTitle(snapshot: EnvironmentDirectorySnapshot, projectId?: string | null) {
  return snapshot.roomProjects.find((project) => project.id === projectId)?.title ?? projectId ?? '当前工作区';
}

function buildDirectory(snapshot: EnvironmentDirectorySnapshot): DirectoryIndex {
  const nodes: EnvironmentNode[] = [];
  const activeProjectId = snapshot.activeConversation?.activeProjectId ?? null;
  const activeProject = activeProjectId
    ? snapshot.roomProjects.find((project) => project.id === activeProjectId) ?? null
    : null;
  const activeCard = snapshot.cards.find((card) => card.id === snapshot.activeCardId) ?? null;
  const currentProvider = activeProvider(snapshot);
  const activeMcpServers = snapshot.mcpServers.filter((server) => server.isActive);
  const webSearchConfigured = isWebSearchConfigured(snapshot.webSearch);
  const desktopState = snapshot.desktopLocalHost;

  addNode(nodes, {
    id: ROOT_NODE_ID,
    kind: 'root',
    title: '当前环境',
    summary: 'Polaris 给模型看的环境目录；它只负责取景和定位，真实修改继续使用对应工具。',
    status: `${snapshot.activeWorld} / ${snapshot.collectionShelf}`,
    childIds: [
      'environment/current-scene',
      'environment/settings',
      'environment/room',
      'environment/workspace',
      'environment/attachments',
      'environment/desktop',
      'environment/mcp',
      'environment/memory',
      'environment/knowledge'
    ],
    actions: [
      { label: '列出下一层目录', toolName: 'listEnvironmentNodes', target: ROOT_NODE_ID },
      { label: '搜索环境目录', toolName: 'searchEnvironmentNodes' }
    ],
    evidence: [
      '节点是目录索引，不是写入口。',
      '修改设置、文件、本机、MCP、记忆时继续使用各自真实工具。'
    ],
    keywords: ['native mode', 'environment', 'directory', 'node']
  });

  addNode(nodes, {
    id: 'environment/current-scene',
    parentId: ROOT_NODE_ID,
    kind: 'scene',
    title: '当前现场',
    summary: '用户此刻所在的世界、活动对话、协作者和前台卡片。',
    status: snapshot.activeConversation?.title ?? '没有活动对话标题',
    childIds: [],
    actions: [],
    evidence: [
      `activeWorld=${snapshot.activeWorld}`,
      `collectionShelf=${snapshot.collectionShelf}`,
      `conversation=${snapshot.activeConversation?.title ?? 'none'}`,
      `collaborator=${snapshot.activeCollaboratorName ?? snapshot.activeConversation?.collaboratorId ?? 'none'}`
    ],
    keywords: ['scene', 'ui', 'current', 'conversation', 'collaborator']
  });

  addNode(nodes, {
    id: 'environment/settings',
    parentId: ROOT_NODE_ID,
    kind: 'settings',
    title: '设置目录',
    summary: '运行时设置、工具开关、provider、MCP、生成、联网和系统资料入口。',
    status: currentProvider ? `当前 provider：${currentProvider.name}` : '没有 provider',
    childIds: [
      'environment/settings/provider',
      'environment/settings/tools',
      'environment/settings/mcp',
      'environment/settings/memory',
      'environment/settings/generation',
      'environment/settings/web',
      'environment/settings/personal-data'
    ],
    actions: [
      { label: '读取 Polaris 产品知识里的设置说明', toolName: 'readPolarisKnowledge', target: 'settings' }
    ],
    evidence: [
      `providerCount=${snapshot.providers.length}`,
      `mcpActiveServers=${activeMcpServers.length}`,
      `webSearchConfigured=${webSearchConfigured ? 'true' : 'false'}`
    ],
    keywords: ['settings', 'provider', 'tools', 'mcp', 'web', 'generation']
  });

  addNode(nodes, {
    id: 'environment/settings/provider',
    parentId: 'environment/settings',
    kind: 'settings',
    title: 'Provider 设置',
    summary: '模型供应商、协议、模型名和连接设置。',
    status: currentProvider ? `${currentProvider.name} · ${currentProvider.protocol} · ${currentProvider.model}` : '没有活动 provider',
    childIds: [],
    actions: [
      { label: '读取 provider 相关产品说明', toolName: 'readPolarisKnowledge', target: 'provider' }
    ],
    evidence: snapshot.providers.map((provider) =>
      `${provider.id} · ${provider.name} · ${provider.protocol} · ${provider.model}`
    ),
    keywords: ['provider', 'model', 'api', 'key', 'endpoint']
  });

  addNode(nodes, {
    id: 'environment/settings/tools',
    parentId: 'environment/settings',
    kind: 'settings',
    title: '工具箱设置',
    summary: '用户控制哪些能力进入模型可见工具目录。',
    status: '可见性由用户开关和应用状态共同决定',
    childIds: [],
    actions: [
      { label: '查看当前环境可展开目录', toolName: 'listEnvironmentNodes', target: ROOT_NODE_ID }
    ],
    evidence: [
      '用户开关决定这类能力要不要给模型。',
      '应用状态决定工具当前能不能用。',
      '词表只能辅助详细规则，不能决定工具有无。'
    ],
    keywords: ['toolbox', 'tools', 'visibility', 'native tools']
  });

  addNode(nodes, {
    id: 'environment/settings/mcp',
    parentId: 'environment/settings',
    kind: 'settings',
    title: 'MCP 设置',
    summary: '已登记 MCP server 和它们暴露的外部工具。',
    status: `${activeMcpServers.length} 个启用 server`,
    childIds: activeMcpServers.map((server) => `environment/mcp/server/${server.id}`),
    actions: [
      { label: '查看 MCP 目录', toolName: 'listEnvironmentNodes', target: 'environment/mcp' }
    ],
    evidence: activeMcpServers.map((server) => `${server.id} · ${server.name} · tools=${server.tools?.length ?? 0}`),
    keywords: ['mcp', 'server', 'external tools']
  });

  addNode(nodes, {
    id: 'environment/settings/memory',
    parentId: 'environment/settings',
    kind: 'settings',
    title: '记忆设置',
    summary: '长期资料、主动回忆和语义检索入口。',
    status: `${snapshot.memoryDocs.length} 份长期资料 · 搜索${snapshot.memorySearchAvailable ? '可用' : '不可用'}`,
    childIds: [],
    actions: [
      { label: '搜索记忆', toolName: 'searchMemory' },
      { label: '读取长期资料', toolName: 'readMemoryDoc' }
    ],
    evidence: snapshot.memoryDocs.map((doc) => `${doc.id} · ${doc.title} · ${doc.summary}`),
    keywords: ['memory', 'recall', 'long term', 'reference docs']
  });

  addNode(nodes, {
    id: 'environment/settings/generation',
    parentId: 'environment/settings',
    kind: 'settings',
    title: '生成能力设置',
    summary: '图片生成、图片理解、语音等非文本能力入口。',
    status: `图片生成${snapshot.imageGenerationAvailable ? '可用' : '不可用'}`,
    childIds: [],
    actions: [
      { label: '生成图片', toolName: 'generateImage' }
    ],
    evidence: [`imageGenerationAvailable=${snapshot.imageGenerationAvailable ? 'true' : 'false'}`],
    keywords: ['image generation', 'voice', 'ocr', 'non-text provider']
  });

  addNode(nodes, {
    id: 'environment/settings/web',
    parentId: 'environment/settings',
    kind: 'settings',
    title: '联网设置',
    summary: '联网搜索和网页读取入口。',
    status: webSearchConfigured ? `搜索服务：${snapshot.webSearch.provider}` : '搜索服务未配置',
    childIds: [],
    actions: [
      { label: '联网搜索', toolName: 'webSearch' },
      { label: '读取网页', toolName: 'readWebPage' }
    ],
    evidence: [`webSearchProvider=${snapshot.webSearch.provider}`],
    keywords: ['web', 'search', 'read page', 'browser']
  });

  addNode(nodes, {
    id: 'environment/settings/personal-data',
    parentId: 'environment/settings',
    kind: 'settings',
    title: '系统资料设置',
    summary: '设备日历等用户主动授权的系统资料入口。',
    status: `日历读取${snapshot.calendarAvailable ? '可用' : '不可用'} · 写入${snapshot.calendarWriteAvailable ? '可用' : '不可用'}`,
    childIds: [],
    actions: [
      { label: '读取可写日历', toolName: 'listCalendars' },
      { label: '读取日历事件', toolName: 'readCalendarEvents' },
      { label: '创建日历事件', toolName: 'createCalendarEvent' }
    ],
    evidence: [
      `calendarAvailable=${snapshot.calendarAvailable ? 'true' : 'false'}`,
      `calendarWriteAvailable=${snapshot.calendarWriteAvailable ? 'true' : 'false'}`
    ],
    keywords: ['calendar', 'personal data', 'system data']
  });

  addNode(nodes, {
    id: 'environment/room',
    parentId: ROOT_NODE_ID,
    kind: 'directory',
    title: '房间卡目录',
    summary: '当前协作者可见的房间卡、工具卡和图片素材。',
    status: `${snapshot.cards.length} 张房间卡 · ${snapshot.imageCards.length} 个图片素材`,
    childIds: [
      ...snapshot.cards.map((card) => `environment/room/card/${card.id}`),
      ...snapshot.imageCards.map((card) => `environment/room/image/${card.id}`)
    ],
    actions: [
      { label: '列房间卡', toolName: 'listCodeCards' },
      { label: '读取房间卡', toolName: 'readCodeCard' }
    ],
    evidence: activeCard ? [`activeCard=${activeCard.id} · ${activeCard.title}`] : ['当前没有活动房间卡。'],
    keywords: ['room', 'card', 'collection', 'image assets']
  });

  snapshot.cards.forEach((card) => {
    addNode(nodes, {
      id: `environment/room/card/${card.id}`,
      parentId: 'environment/room',
      kind: 'room-card',
      title: card.title,
      summary: `${card.kind ?? 'card'} · ${card.language || 'text'} · tags=${card.tags.join(', ') || 'none'}`,
      status: card.id === activeCard?.id ? '活动房间' : undefined,
      childIds: [],
      actions: [
        { label: '读取房间全文', toolName: 'readCodeCard', target: card.id },
        { label: '修改房间', toolName: 'patchCodeCard', target: card.id }
      ],
      evidence: [`cardId=${card.id}`],
      keywords: ['card', card.title, card.language, ...card.tags]
    });
  });

  snapshot.imageCards.forEach((card) => {
    addNode(nodes, {
      id: `environment/room/image/${card.id}`,
      parentId: 'environment/room',
      kind: 'room-card',
      title: card.title,
      summary: `图片素材 · assetId=${card.assetId} · ${card.source}`,
      childIds: [],
      actions: [
        { label: '检查图片素材', toolName: 'inspectImageAsset', target: card.id },
        { label: '提取图片配色', toolName: 'extractImagePalette', target: card.id }
      ],
      evidence: [`imageCardId=${card.id}`, `assetId=${card.assetId}`],
      keywords: ['image', 'asset', card.title, ...card.tags]
    });
  });

  addNode(nodes, {
    id: 'environment/workspace',
    parentId: ROOT_NODE_ID,
    kind: 'workspace',
    title: '工作区目录',
    summary: '当前对话绑定的工作区、项目文件、参考资料和预览状态。',
    status: activeProject ? `当前工作区：${activeProject.title}` : '当前对话没有绑定工作区',
    childIds: activeProjectId
      ? [
          `environment/workspace/project/${activeProjectId}`,
          ...snapshot.projectFiles
            .filter((file) => file.projectId === activeProjectId)
            .map((file) => `environment/workspace/file/${file.id}`),
          ...snapshot.workspaceReferenceDocs
            .filter((doc) => doc.projectId === activeProjectId)
            .map((doc) => `environment/workspace/reference/${doc.id}`)
        ]
      : snapshot.roomProjects.map((project) => `environment/workspace/project/${project.id}`),
    actions: [
      { label: '列工作区文件', toolName: 'listProjectFiles' },
      { label: '搜索工作区文件', toolName: 'searchProjectFiles' },
      { label: '搜索可读上下文', toolName: 'searchReadableContext' }
    ],
    evidence: [
      `activeProjectId=${activeProjectId ?? 'none'}`,
      `projectCount=${snapshot.roomProjects.length}`,
      `projectFileCount=${snapshot.projectFiles.length}`,
      `referenceDocCount=${snapshot.workspaceReferenceDocs.length}`
    ],
    keywords: ['workspace', 'project', 'files', 'references', 'preview']
  });

  snapshot.roomProjects.forEach((project) => {
    const files = snapshot.projectFiles.filter((file) => file.projectId === project.id);
    addNode(nodes, {
      id: `environment/workspace/project/${project.id}`,
      parentId: 'environment/workspace',
      kind: 'workspace',
      title: project.title,
      summary: `${files.length} 个文件 · slug=${project.slug || 'none'}`,
      status: project.id === activeProjectId ? '当前绑定工作区' : undefined,
      childIds: files.map((file) => `environment/workspace/file/${file.id}`),
      actions: [
        { label: '列文件', toolName: 'listProjectFiles', target: project.id },
        { label: '检查预览', toolName: 'checkProjectPreview', target: project.id }
      ],
      evidence: [`projectId=${project.id}`, `entryFileId=${project.entryFileId ?? 'none'}`],
      keywords: ['workspace', 'project', project.title, project.slug ?? '']
    });
  });

  snapshot.projectFiles.forEach((file) => {
    addNode(nodes, {
      id: `environment/workspace/file/${file.id}`,
      parentId: `environment/workspace/project/${file.projectId}`,
      kind: 'file',
      title: file.filePath,
      summary: `${projectTitle(snapshot, file.projectId)} · ${file.language || 'text'} · ${file.fileRole ?? 'file'}`,
      childIds: [],
      actions: [
        { label: '读取全文', toolName: 'readProjectFile', target: file.filePath },
        { label: '读取局部上下文', toolName: 'readProjectFileContext', target: file.filePath },
        { label: '局部替换', toolName: 'editProjectFileText', target: file.filePath }
      ],
      evidence: [`fileId=${file.id}`, `projectId=${file.projectId}`, `updatedAt=${file.updatedAt}`],
      keywords: ['file', file.filePath, file.language, file.fileRole ?? '']
    });
  });

  snapshot.workspaceReferenceDocs.forEach((doc) => {
    addNode(nodes, {
      id: `environment/workspace/reference/${doc.id}`,
      parentId: `environment/workspace/project/${doc.projectId}`,
      kind: 'file',
      title: doc.title,
    summary: doc.summary || `${doc.source} 参考资料`,
      childIds: [],
      actions: [
        { label: '读取参考资料', toolName: 'readWorkspaceReference', target: doc.id },
        { label: '转为工作区文件', toolName: 'promoteWorkspaceReferenceToProjectFile', target: doc.id }
      ],
      evidence: [`docId=${doc.id}`, `projectId=${doc.projectId}`, `source=${doc.source}`],
      keywords: ['reference', 'doc', doc.title, doc.summary]
    });
  });

  addNode(nodes, {
    id: 'environment/attachments',
    parentId: ROOT_NODE_ID,
    kind: 'directory',
    title: '附件目录',
    summary: '当前对话可读附件、压缩包和图片附件。',
    status: `${snapshot.attachmentCount} 个附件`,
    childIds: [],
    actions: [
      { label: '检查附件', toolName: 'inspectAttachments' },
      { label: '读取附件文本', toolName: 'readAttachmentText' },
      { label: '查看压缩包', toolName: 'inspectArchiveEntries' }
    ],
    evidence: [
      `attachmentCount=${snapshot.attachmentCount}`,
      `imageAttachmentCount=${snapshot.imageAttachmentCount}`,
      `archiveAttachmentCount=${snapshot.archiveAttachmentCount}`
    ],
    keywords: ['attachment', 'file', 'image', 'zip', 'archive']
  });

  addNode(nodes, {
    id: 'environment/desktop',
    parentId: ROOT_NODE_ID,
    kind: 'external',
    title: '本机环境',
    summary: 'Mac 桌面宿主授权的本机文件夹、终端和长命令会话。',
    status: desktopState?.available
      ? `${desktopState.platform} · ${desktopState.trustedRoots.length} 个授权根目录`
      : '本机环境不可用或未授权',
    childIds: desktopState?.trustedRoots.map((root) => `environment/desktop/root/${root.id}`) ?? [],
    actions: [
      { label: '列本机工作区', toolName: 'listDesktopWorkspaces' },
      { label: '列本机目录', toolName: 'listDesktopFiles' },
      { label: '运行本机命令', toolName: 'runDesktopCommand' }
    ],
    evidence: desktopState?.trustedRoots.length
      ? desktopState.trustedRoots.map((root) => `${root.id} · ${root.label} · ${root.path}`)
      : ['当前没有可用本机授权根目录。'],
    keywords: ['desktop', 'local', 'terminal', 'command', 'files']
  });

  desktopState?.trustedRoots.forEach((root) => {
    addNode(nodes, {
      id: `environment/desktop/root/${root.id}`,
      parentId: 'environment/desktop',
      kind: 'external',
      title: root.label,
      summary: root.path,
      status: `permission=${desktopState.permissionMode}`,
      childIds: [],
      actions: [
        { label: '列目录', toolName: 'listDesktopFiles', target: root.id },
        { label: '搜索文件', toolName: 'searchDesktopFiles', target: root.id },
        { label: '运行命令', toolName: 'runDesktopCommand', target: root.id }
      ],
      evidence: [`rootId=${root.id}`, `path=${root.path}`],
      keywords: ['desktop root', root.label, root.path]
    });
  });

  addNode(nodes, {
    id: 'environment/mcp',
    parentId: ROOT_NODE_ID,
    kind: 'tool-lane',
    title: 'MCP 工具目录',
    summary: '已启用 MCP server 暴露的外部工具。',
    status: `${activeMcpServers.length} 个启用 server`,
    childIds: activeMcpServers.map((server) => `environment/mcp/server/${server.id}`),
    actions: [
      { label: '调用 MCP 工具', toolName: 'invokeMcpTool' }
    ],
    evidence: activeMcpServers.length
      ? activeMcpServers.map((server) => `${server.id} · ${server.name} · tools=${server.tools?.length ?? 0}`)
      : ['当前没有启用的 MCP server。'],
    keywords: ['mcp', 'external tool', 'server']
  });

  activeMcpServers.forEach((server) => {
    addNode(nodes, {
      id: `environment/mcp/server/${server.id}`,
      parentId: 'environment/mcp',
      kind: 'tool-lane',
      title: server.name,
      summary: `${server.tools?.length ?? 0} 个工具`,
      childIds: [],
      actions: [
        { label: '调用 MCP 工具', toolName: 'invokeMcpTool', target: server.id }
      ],
      evidence: (server.tools ?? []).map((tool) => `${tool.name} · ${tool.description ?? ''}`.trim()),
      keywords: ['mcp', 'server', server.name, ...(server.tools ?? []).map((tool) => tool.name)]
    });
  });

  addNode(nodes, {
    id: 'environment/memory',
    parentId: ROOT_NODE_ID,
    kind: 'tool-lane',
    title: '记忆与长期资料',
    summary: '当前协作者长期资料、主动回忆和原文锚点。',
    status: `${snapshot.memoryDocs.length} 份长期资料`,
    childIds: snapshot.memoryDocs.map((doc) => `environment/memory/doc/${doc.id}`),
    actions: [
      { label: '搜索记忆', toolName: 'searchMemory' },
      { label: '读取长期资料', toolName: 'readMemoryDoc' },
      { label: '打开记忆原文', toolName: 'openMemorySource' }
    ],
    evidence: [`memorySearchAvailable=${snapshot.memorySearchAvailable ? 'true' : 'false'}`],
    keywords: ['memory', 'recall', 'reference docs']
  });

  snapshot.memoryDocs.forEach((doc) => {
    addNode(nodes, {
      id: `environment/memory/doc/${doc.id}`,
      parentId: 'environment/memory',
      kind: 'file',
      title: doc.title,
      summary: doc.summary || '长期资料',
      childIds: [],
      actions: [
        { label: '读取长期资料全文', toolName: 'readMemoryDoc', target: doc.id },
        { label: '更新长期资料', toolName: 'writeMemoryDoc', target: doc.id }
      ],
      evidence: [`docId=${doc.id}`, `updatedAt=${doc.updatedAt}`],
      keywords: ['memory doc', doc.title, doc.summary]
    });
  });

  addNode(nodes, {
    id: 'environment/knowledge',
    parentId: ROOT_NODE_ID,
    kind: 'tool-lane',
    title: '产品知识',
    summary: 'Polaris 内置说明文档和使用知识。',
    status: '按主题读取',
    childIds: [],
    actions: [
      { label: '读取产品知识', toolName: 'readPolarisKnowledge' }
    ],
    evidence: ['适合不知道某个 Polaris 功能如何使用时读取。'],
    keywords: ['knowledge', 'docs', 'manual', 'guide']
  });

  const byId = new Map(nodes.map((node) => [node.id, node]));
  return { nodes, byId };
}

function childrenOf(index: DirectoryIndex, parentNodeId: string, depth: number): EnvironmentNode[] {
  const parent = index.byId.get(parentNodeId);
  if (!parent) return [];
  const result: EnvironmentNode[] = [];
  const visit = (node: EnvironmentNode, currentDepth: number) => {
    if (currentDepth > depth) return;
    result.push(node);
    if (currentDepth === depth) return;
    node.childIds.forEach((childId) => {
      const child = index.byId.get(childId);
      if (child) visit(child, currentDepth + 1);
    });
  };
  parent.childIds.forEach((childId) => {
    const child = index.byId.get(childId);
    if (child) visit(child, 1);
  });
  return result;
}

function actionLabel(action: EnvironmentNodeAction) {
  return [
    action.label,
    action.toolName ? `tool=${action.toolName}` : null,
    action.target ? `target=${action.target}` : null,
    action.note
  ].filter(Boolean).join(' · ');
}

function formatNodeLine(node: EnvironmentNode) {
  return [
    `- ${node.id} · ${node.title}`,
    `  kind=${node.kind}${node.status ? ` · status=${node.status}` : ''}`,
    `  ${node.summary}`,
    node.childIds.length ? `  children=${node.childIds.length}` : null,
    node.actions.length ? `  actions=${node.actions.map(actionLabel).join(' | ')}` : null
  ].filter(Boolean).join('\n');
}

function formatNodeExpanded(node: EnvironmentNode) {
  return [
    formatNodeLine(node),
    node.evidence.length ? `  evidence:\n${node.evidence.map((line) => `  - ${line}`).join('\n')}` : null
  ].filter(Boolean).join('\n');
}

function resolveDepth(value: number | undefined) {
  return Number.isFinite(value) && value !== undefined && value > 1 ? Math.floor(value) : 1;
}

export function executeEnvironmentDirectoryAction(
  snapshot: EnvironmentDirectorySnapshot,
  action: EnvironmentDirectoryAction
): ToolResult<{ summary: string; detailText: string }> {
  const index = buildDirectory(snapshot);

  if (action.kind === 'inspectEnvironmentNode') {
    const node = index.byId.get(action.nodeId);
    if (!node) {
      return { ok: false, error: `没有找到环境节点：${action.nodeId}` };
    }
    const children = node.childIds
      .map((childId) => index.byId.get(childId))
      .filter((child): child is EnvironmentNode => Boolean(child));
    const detailText = [
      formatNodeExpanded(node),
      children.length ? `\nchildren:\n${children.map(formatNodeLine).join('\n')}` : null,
      '\n边界：这个结果只是环境取景；需要真实修改时，继续调用 actions 里对应的工具。'
    ].filter(Boolean).join('\n');
    return {
      ok: true,
      summary: `已检查环境节点 · ${node.title}`,
      detailText
    };
  }

  if (action.kind === 'searchEnvironmentNodes') {
    const query = normalizeText(action.query);
    if (!query) {
      return { ok: false, error: '搜索环境目录缺少 query。' };
    }
    const scopePrefix = action.scopeNodeId?.trim();
    const terms = query.split(/\s+/).filter(Boolean);
    const matches = index.nodes
      .filter((node) => !scopePrefix || node.id === scopePrefix || node.id.startsWith(`${scopePrefix}/`))
      .map((node) => {
        const haystack = node.keywords.join(' ');
        const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
        return { node, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.node.id.localeCompare(right.node.id));
    if (!matches.length) {
      return {
        ok: true,
        summary: `环境目录没有匹配 · ${action.query}`,
        detailText: '没有找到匹配节点。可以先 listEnvironmentNodes parentNodeId="environment" 看顶层目录。'
      };
    }
    return {
      ok: true,
      summary: `已搜索环境目录 · ${matches.length} 个匹配`,
      detailText: [
        `query=${action.query}`,
        action.scopeNodeId ? `scopeNodeId=${action.scopeNodeId}` : null,
        '',
        matches.map((entry) => formatNodeLine(entry.node)).join('\n')
      ].filter((line) => line !== null).join('\n')
    };
  }

  const parentNodeId = action.parentNodeId?.trim() || ROOT_NODE_ID;
  const parent = index.byId.get(parentNodeId);
  if (!parent) {
    return { ok: false, error: `没有找到环境父节点：${parentNodeId}` };
  }
  const nodes = childrenOf(index, parentNodeId, resolveDepth(action.depth));
  return {
    ok: true,
    summary: `已列出环境目录 · ${parent.title} · ${nodes.length} 项`,
    detailText: [
      `parentNodeId=${parentNodeId}`,
      `depth=${resolveDepth(action.depth)}`,
      '',
      nodes.length ? nodes.map(formatNodeLine).join('\n') : '这个节点没有子项。',
      '',
      '边界：节点是取景索引，不是写入口；看见目标后用对应真实工具继续。'
    ].join('\n')
  };
}
