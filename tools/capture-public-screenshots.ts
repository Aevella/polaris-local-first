import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';

const host = '127.0.0.1';
const port = Number(process.env.DOCS_SCREENSHOT_PORT ?? 4197);
const baseUrl = `http://${host}:${port}`;
const outputDir = 'docs/assets/screenshots';

const server = spawn('npm', ['run', 'dev', '--', '--host', host, '--port', String(port)], {
  cwd: process.cwd(),
  stdio: 'pipe'
});

let serverLogs = '';
server.stdout.on('data', (chunk) => {
  serverLogs += String(chunk);
});
server.stderr.on('data', (chunk) => {
  serverLogs += String(chunk);
});

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true
});

try {
  await mkdir(outputDir, { recursive: true });
  await waitForServer();

  const desktopContext = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce'
  });
  const desktopPage = await desktopContext.newPage();

  await desktopPage.goto(`${baseUrl}/?debugQa=1`, { waitUntil: 'domcontentloaded' });
  await desktopPage.waitForSelector('.app-shell', { timeout: 20_000 });
  await desktopPage.waitForFunction(() => Boolean(window.__polarisDev), undefined, { timeout: 20_000 });
  await seedPublicShowcase(desktopPage);

  await captureChat(desktopPage);
  await captureCards(desktopPage);
  await captureWorkspace(desktopPage);
  await desktopContext.close();

  const mobileContext = await browser.newContext({
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    reducedMotion: 'reduce'
  });
  const mobilePage = await mobileContext.newPage();

  await mobilePage.goto(`${baseUrl}/?debugQa=1`, { waitUntil: 'domcontentloaded' });
  await mobilePage.waitForSelector('.app-shell', { timeout: 20_000 });
  await mobilePage.waitForFunction(() => Boolean(window.__polarisDev), undefined, { timeout: 20_000 });
  await seedPublicShowcase(mobilePage);
  await setDarkAppearance(mobilePage);

  await captureMobileDarkChat(mobilePage);
  await captureMobileDarkWorkspace(mobilePage);
  await mobileContext.close();

  console.log(`Public screenshots written to ${outputDir}`);
} catch (error) {
  const logTail = serverLogs.slice(-4_000);
  if (logTail) console.error(logTail);
  throw error;
} finally {
  await browser.close();
  stopServer(server);
}

async function seedPublicShowcase(page: Page) {
  await page.evaluate(String.raw`(async () => {
    const [chatModule, collectionModule, personaModule, spaceModule, personaBuilderModule] = await Promise.all([
      import('/src/stores/chatStore.ts'),
      import('/src/stores/collectionStore.ts'),
      import('/src/stores/personaStore.ts'),
      import('/src/stores/spaceStore.ts'),
      import('/src/config/persona/personaBuilder.ts')
    ]);

    const { useChatStore } = chatModule;
    const { useCollectionStore } = collectionModule;
    const { usePersonaStore } = personaModule;
    const { useSpaceStore } = spaceModule;
    const { createPersonaTemplate } = personaBuilderModule;
    const now = Date.now();
    const collaboratorId = 'showcase-atlas';
    const projectId = 'showcase-knowledge-atlas';
    const secondaryProjectId = 'showcase-launch-notes';

    const collaborator = createPersonaTemplate({
      id: collaboratorId,
      name: 'Atlas',
      description: 'Research and product collaborator',
      purpose: 'Turn scattered evidence into clear, durable work.',
      generatedPromptMode: 'vnext',
      baseId: 'executor',
      relationship: 'partner',
      expression: 'natural',
      assistantAvatarIconId: 'sparkles',
      pinnedAt: now
    });

    const conversations = [
      {
        id: 'showcase-conversation-main',
        title: 'Knowledge Atlas · research flow',
        collaboratorId,
        activeProjectId: projectId,
        messages: [
          {
            id: 'showcase-message-user-1',
            role: 'user',
            origin: 'user-input',
            content: 'Turn the interview notes into a research map we can keep extending. Preserve the source trail, and make the first useful view easy to scan.',
            timestamp: now - 64_000
          },
          {
            id: 'showcase-message-assistant-1',
            role: 'assistant',
            origin: 'assistant-reply',
            assistantName: 'Atlas',
            speakerCollaboratorId: collaboratorId,
            model: 'Polaris',
            content: 'I grouped the evidence around three durable questions: **what users are trying to continue**, **where context gets lost**, and **which artifacts deserve a stable home**.\n\nI am carrying the source notes into the workspace instead of flattening them into a one-off summary.',
            timestamp: now - 51_000
          },
          {
            id: 'showcase-message-tool-1',
            role: 'system',
            origin: 'tool-runtime',
            content: 'Workspace files updated.',
            timestamp: now - 39_000,
            toolInvocation: {
              id: 'showcase-tool-1',
              kind: 'writeProjectFiles',
              status: 'executed',
              title: 'Workspace files updated',
              summary: 'Added the research map, source index, and synthesis notes to Knowledge Atlas.',
              originMessageId: 'showcase-message-assistant-1',
              projectFilePaths: ['README.md', 'research/source-index.md', 'research/synthesis.md']
            }
          },
          {
            id: 'showcase-message-assistant-2',
            role: 'assistant',
            origin: 'assistant-reply',
            assistantName: 'Atlas',
            speakerCollaboratorId: collaboratorId,
            model: 'Polaris',
            content: 'The workspace now has a readable front door and a traceable evidence layer. Next I would connect each product claim to the exact interview fragment that supports it, so future work can challenge the synthesis without losing the source.',
            timestamp: now - 28_000
          }
        ],
        pinnedAt: now - 10_000,
        updatedAt: now - 28_000,
        draft: ''
      },
      {
        id: 'showcase-conversation-provider',
        title: 'Provider evaluation',
        collaboratorId,
        activeProjectId: null,
        messages: [
          {
            id: 'showcase-message-provider',
            role: 'user',
            origin: 'user-input',
            content: 'Compare the current provider options by protocol and actual capabilities.',
            timestamp: now - 3_600_000
          }
        ],
        pinnedAt: null,
        updatedAt: now - 3_600_000,
        draft: ''
      },
      {
        id: 'showcase-conversation-release',
        title: 'Release readiness',
        collaboratorId,
        activeProjectId: secondaryProjectId,
        messages: [
          {
            id: 'showcase-message-release',
            role: 'assistant',
            origin: 'assistant-reply',
            assistantName: 'Atlas',
            speakerCollaboratorId: collaboratorId,
            content: 'The source gates are green; distribution status is tracked separately for each channel.',
            timestamp: now - 7_200_000
          }
        ],
        pinnedAt: null,
        updatedAt: now - 7_200_000,
        draft: ''
      }
    ];

    const cards = [
      {
        id: 'showcase-card-research',
        title: 'Research brief',
        cardNote: 'The product questions, current evidence, and unresolved tensions in one durable brief.',
        language: 'markdown',
        code: '# Research brief\n\n## Questions\n- What must survive between sessions?\n- Which artifacts need explicit ownership?\n- What evidence should the model see next?',
        cardFaceCss: '& { background: linear-gradient(145deg, rgba(229,244,236,.96), rgba(251,252,246,.88)); border: 1px solid rgba(91,130,111,.20); } &::after { content: "RESEARCH"; position: absolute; right: 18px; top: 18px; font: 600 11px/1 ui-monospace; letter-spacing: .18em; color: rgba(57,95,77,.28); }',
        tags: ['research', 'brief'],
        ownerCollaboratorId: collaboratorId,
        source: 'chat-generated',
        createdAt: now - 86_400_000,
        updatedAt: now - 26_000,
        pinnedAt: now - 26_000,
        originConversationId: 'showcase-conversation-main',
        originMessageId: 'showcase-message-assistant-2'
      },
      {
        id: 'showcase-card-contract',
        title: 'Context contract',
        cardNote: 'A compact contract for scene, identity, tools, evidence, and room boundaries.',
        language: 'typescript',
        code: 'export type ContextContract = {\n  scene: Scene;\n  collaborators: Identity[];\n  evidence: ToolEvidence[];\n  room: WorkspaceBoundary;\n};',
        cardFaceCss: '& { background: linear-gradient(145deg, rgba(234,232,251,.97), rgba(250,247,255,.88)); border: 1px solid rgba(107,91,151,.18); } &::after { content: "CONTRACT"; position: absolute; right: 18px; top: 18px; font: 600 11px/1 ui-monospace; letter-spacing: .18em; color: rgba(87,71,132,.28); }',
        tags: ['architecture', 'context'],
        ownerCollaboratorId: collaboratorId,
        source: 'chat-generated',
        createdAt: now - 72_000_000,
        updatedAt: now - 41_000,
        pinnedAt: null,
        originConversationId: 'showcase-conversation-main',
        originMessageId: 'showcase-message-assistant-1'
      },
      {
        id: 'showcase-card-release',
        title: 'Release checklist',
        cardNote: 'Source, device, distribution, and live-health proof kept as separate facts.',
        language: 'markdown',
        code: '## Release proof\n- [x] Source gates\n- [x] Build artifact\n- [ ] Distribution upload\n- [ ] Live health',
        cardFaceCss: '& { background: linear-gradient(145deg, rgba(255,235,223,.96), rgba(255,251,245,.88)); border: 1px solid rgba(164,105,77,.16); } &::after { content: "RELEASE"; position: absolute; right: 18px; top: 18px; font: 600 11px/1 ui-monospace; letter-spacing: .18em; color: rgba(142,83,58,.25); }',
        tags: ['release', 'verification'],
        ownerCollaboratorId: collaboratorId,
        source: 'manual',
        createdAt: now - 48_000_000,
        updatedAt: now - 55_000,
        pinnedAt: null
      },
      {
        id: 'showcase-card-localdata',
        title: 'LocalData map',
        cardNote: 'Facts live in LocalData; stores remain projections; large binaries keep their own owner.',
        language: 'text',
        code: 'LocalData facts\n  ├─ conversations\n  ├─ collaborators\n  ├─ workspace files\n  └─ runtime settings\n\nBlob storage\n  └─ large binary assets',
        cardFaceCss: '& { background: linear-gradient(145deg, rgba(226,238,252,.97), rgba(247,251,255,.9)); border: 1px solid rgba(73,112,153,.17); } &::after { content: "LOCALDATA"; position: absolute; right: 18px; top: 18px; font: 600 11px/1 ui-monospace; letter-spacing: .16em; color: rgba(62,99,140,.26); }',
        tags: ['local-first', 'data'],
        ownerCollaboratorId: collaboratorId,
        source: 'manual',
        createdAt: now - 36_000_000,
        updatedAt: now - 68_000,
        pinnedAt: null
      }
    ];

    const projectFiles = [
      ['showcase-file-readme', projectId, 'README.md', 'note', 'markdown', '# Knowledge Atlas\n\nA durable map from source evidence to product decisions.'],
      ['showcase-file-map', projectId, 'src/research-map.ts', 'logic', 'typescript', 'export const researchMap = { themes: ["continuity", "ownership", "evidence"] };'],
      ['showcase-file-index', projectId, 'research/source-index.md', 'note', 'markdown', '# Source index\n\nEach claim links back to an interview fragment.'],
      ['showcase-file-synthesis', projectId, 'research/synthesis.md', 'note', 'markdown', '# Synthesis\n\nContinuity breaks when tools, artifacts, and model context lose a shared owner.'],
      ['showcase-file-view', projectId, 'src/atlas-view.tsx', 'entry', 'tsx', 'export function AtlasView() { return <main>Knowledge Atlas</main>; }'],
      ['showcase-launch-readme', secondaryProjectId, 'README.md', 'entry', 'markdown', '# Launch Notes'],
      ['showcase-launch-checks', secondaryProjectId, 'release/checks.md', 'note', 'markdown', '# Channel checks'],
      ['showcase-launch-log', secondaryProjectId, 'release/status.json', 'data', 'json', '{"source":"passed","distribution":"pending"}']
    ].map(([id, projectIdValue, filePath, fileRole, language, content], index) => ({
      id,
      projectId: projectIdValue,
      filePath,
      fileRole,
      language,
      content,
      ownerCollaboratorId: collaboratorId,
      source: 'chat-generated',
      createdAt: now - 82_000_000 + index * 1_000,
      updatedAt: now - 24_000 + index * 1_000
    }));

    const projects = [
      {
        id: projectId,
        title: 'Knowledge Atlas',
        slug: 'knowledge-atlas',
        ownerCollaboratorId: collaboratorId,
        entryFileId: 'showcase-file-view',
        fileIds: projectFiles.filter((file) => file.projectId === projectId).map((file) => file.id),
        tags: ['research', 'local-first', 'product'],
        coverNote: 'A living research workspace that keeps source evidence, synthesis, and product decisions together.',
        coverStyle: 'background: radial-gradient(circle at 20% 20%, rgba(218,238,228,.96), transparent 48%), linear-gradient(145deg, #f6f4ea, #e7eef5);',
        source: 'chat-generated',
        createdAt: now - 86_400_000,
        updatedAt: now - 18_000,
        pinnedAt: now - 18_000
      },
      {
        id: secondaryProjectId,
        title: 'Launch Notes',
        slug: 'launch-notes',
        ownerCollaboratorId: collaboratorId,
        entryFileId: 'showcase-launch-readme',
        fileIds: projectFiles.filter((file) => file.projectId === secondaryProjectId).map((file) => file.id),
        tags: ['release', 'evidence'],
        coverNote: 'Channel-specific release evidence, checks, and decisions.',
        coverStyle: 'background: radial-gradient(circle at 80% 18%, rgba(248,218,207,.9), transparent 44%), linear-gradient(145deg, #fff9f2, #eee8f7);',
        source: 'chat-generated',
        createdAt: now - 72_000_000,
        updatedAt: now - 52_000,
        pinnedAt: null
      }
    ];

    const references = [
      {
        id: 'showcase-reference-interviews',
        projectId,
        title: 'Interview source index',
        summary: 'Traceable source notes for the current research synthesis.',
        content: '',
        charCount: 3_840,
        contentLoaded: false,
        ownerCollaboratorId: collaboratorId,
        source: 'conversation',
        createdAt: now - 86_000_000,
        updatedAt: now - 21_000
      }
    ];

    usePersonaStore.setState({
      personas: [collaborator],
      activeCollaboratorId: collaboratorId,
      seededDefaultPersonaIds: [],
      hydrated: true
    });

    useChatStore.setState((state) => ({
      ...state,
      conversations,
      activeConversationId: conversations[0].id,
      conversationBodyStatuses: Object.fromEntries(conversations.map((conversation) => [
        conversation.id,
        { state: 'loaded', updatedAt: now }
      ])),
      loadedMessageConversationIds: conversations.map((conversation) => conversation.id),
      loadingMessageConversationIds: [],
      inputDraft: '',
      hydrated: true
    }));

    useCollectionStore.setState((state) => ({
      ...state,
      cards,
      projectFiles,
      workspaceReferenceDocs: references,
      roomProjects: projects,
      imageCards: [],
      deletedBundledCardIds: [],
      hydrated: true
    }));

    const space = useSpaceStore.getState();
    space.setAppLanguage('en-US');
    space.setFrontstageCollaboratorId(collaboratorId);
    space.setCollectionProjectId(null);
    space.setActiveCard(null);
    space.setWorld('chat');
  })()`);

  await page.waitForSelector('.app-shell.chat', { timeout: 20_000 });
  await page.waitForSelector('.chat-flow', { timeout: 20_000 });
  await page.waitForTimeout(250);
}

async function captureChat(page: Page) {
  await page.evaluate(String.raw`(async () => {
    const { useSpaceStore } = await import('/src/stores/spaceStore.ts');
    useSpaceStore.getState().setWorld('chat');
  })()`);
  await page.waitForSelector('.app-shell.chat', { timeout: 20_000 });
  await page.locator('.chat-flow').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await settle(page);
  await page.screenshot({
    path: `${outputDir}/polaris-chat-workspace.png`,
    type: 'png'
  });
}

async function captureCards(page: Page) {
  await page.evaluate(String.raw`(async () => {
    const { useSpaceStore } = await import('/src/stores/spaceStore.ts');
    const space = useSpaceStore.getState();
    space.setCollectionProjectId(null);
    space.setCollectionShelf('code');
    space.setWorld('collection');
  })()`);
  await page.waitForSelector('.app-shell.collection', { timeout: 20_000 });
  await page.waitForSelector('[data-shelf-page="code"]', { timeout: 20_000 });
  await settle(page);
  await page.screenshot({
    path: `${outputDir}/polaris-collection-cards.png`,
    type: 'png'
  });
}

async function captureWorkspace(page: Page) {
  await page.evaluate(String.raw`(async () => {
    const { useSpaceStore } = await import('/src/stores/spaceStore.ts');
    const space = useSpaceStore.getState();
    space.setCollectionShelf('project');
    space.setCollectionProjectId('showcase-knowledge-atlas');
    space.setWorld('collection');
  })()`);
  await page.waitForSelector('.app-shell.collection', { timeout: 20_000 });
  await page.waitForSelector('.room-project-fullscreen', { timeout: 20_000 });
  await settle(page);
  await page.screenshot({
    path: `${outputDir}/polaris-project-workspace.png`,
    type: 'png'
  });
}

async function setDarkAppearance(page: Page) {
  await page.evaluate(String.raw`(async () => {
    const { useSpaceStore } = await import('/src/stores/spaceStore.ts');
    useSpaceStore.getState().setDisplayPreferences({ appearance: 'dark' });
  })()`);
  await page.waitForFunction(
    () => document.documentElement.dataset.polarisAppearance === 'dark',
    undefined,
    { timeout: 20_000 }
  );
}

async function captureMobileDarkChat(page: Page) {
  await page.evaluate(String.raw`(async () => {
    const { useSpaceStore } = await import('/src/stores/spaceStore.ts');
    const space = useSpaceStore.getState();
    space.setCollectionProjectId(null);
    space.setWorld('chat');
  })()`);
  await page.waitForSelector('.app-shell.chat', { timeout: 20_000 });
  await page.locator('.chat-flow').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await settle(page);
  await page.screenshot({
    path: `${outputDir}/polaris-mobile-dark-chat.png`,
    type: 'png'
  });
}

async function captureMobileDarkWorkspace(page: Page) {
  await page.evaluate(String.raw`(async () => {
    const { useSpaceStore } = await import('/src/stores/spaceStore.ts');
    const space = useSpaceStore.getState();
    space.setCollectionShelf('project');
    space.setCollectionProjectId('showcase-knowledge-atlas');
    space.setWorld('collection');
  })()`);
  await page.waitForSelector('.app-shell.collection', { timeout: 20_000 });
  await page.waitForSelector('.room-project-fullscreen', { timeout: 20_000 });
  await settle(page);
  await page.screenshot({
    path: `${outputDir}/polaris-mobile-dark-workspace.png`,
    type: 'png'
  });
}

async function settle(page: Page) {
  await page.waitForTimeout(350);
}

async function waitForServer(retries = 80) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Screenshot server did not become ready: ${baseUrl}`);
}

function stopServer(child: ChildProcessWithoutNullStreams) {
  if (!child.killed) child.kill('SIGTERM');
}
