import { asObject } from './assistantToolProtocolShared';
import {
  STABLE_THEME_ACTION_KIND_ALIASES,
  STABLE_THEME_KEY_ALIASES
} from './assistantToolProtocolThemeStable';
import {
  SURFACE_TOKEN_ACTION_KIND_ALIASES,
  SURFACE_TOKEN_KEY_ALIASES
} from './assistantToolProtocolThemeSurfaceTokens';

const KEY_ALIASES: Record<string, string> = {
  actions: 'actions',
  action: 'action',
  toolactions: 'toolActions',
  toolaction: 'toolAction',
  items: 'items',
  steps: 'steps',
  commands: 'commands',
  kind: 'kind',
  type: 'kind',
  name: 'kind',
  selector: 'selector',
  css: 'css',
  csstext: 'cssText',
  csslines: 'cssLines',
  presetid: 'presetId',
  ...STABLE_THEME_KEY_ALIASES,
  ...SURFACE_TOKEN_KEY_ALIASES,
  seedcolor: 'seedColor',
  seedhex: 'seedColor',
  seed_colour: 'seedColor',
  target: 'target',
  effect: 'effect',
  material: 'material',
  radius: 'radius',
  density: 'density',
  depth: 'depth',
  targetlabel: 'targetLabel',
  cardfacecss: 'cardFaceCss',
  cardnote: 'cardNote',
  coverstyle: 'coverStyle',
  covercss: 'coverStyle',
  covernote: 'coverNote',
  projectid: 'projectId',
  filepath: 'filePath',
  directorypath: 'path',
  dirpath: 'path',
  frompath: 'fromPath',
  sourcepath: 'fromPath',
  oldpath: 'fromPath',
  topath: 'toPath',
  destinationpath: 'toPath',
  newpath: 'toPath',
  filerole: 'fileRole',
  replacecontent: 'replaceContent',
  projecttitle: 'projectTitle',
  oldstring: 'oldString',
  newstring: 'newString',
  anchorstring: 'anchorString',
  anchor: 'anchorString',
  position: 'position',
  layer: 'layer',
  query: 'query',
  linenumber: 'lineNumber',
  line: 'lineNumber',
  startline: 'startLine',
  endline: 'endLine',
  stopline: 'stopLine',
  before: 'before',
  after: 'after',
  occurrence: 'occurrence',
  settlems: 'settleMs',
  waitms: 'settleMs',
  openincollection: 'openInCollection',
  maxresults: 'maxResults',
  maxchars: 'maxChars',
  filename: 'fileName',
  docid: 'docId',
  title: 'title',
  archivename: 'archiveName',
  excludeentries: 'excludeEntries',
  excludeprefixes: 'excludePrefixes',
  targetlabeltext: 'targetLabel',
  saveas: 'saveAs'
};

const ACTION_KIND_ALIASES: Record<string, string> = {
  ...STABLE_THEME_ACTION_KIND_ALIASES,
  ...SURFACE_TOKEN_ACTION_KIND_ALIASES,
  patchrawcss: 'patchRawCss',
  patchthemecss: 'patchRawCss',
  readthemecss: 'readThemeCss',
  editthemecss: 'editThemeCss',
  appendthemecss: 'appendThemeCss',
  insertthemecss: 'insertThemeCss',
  insertintothemecss: 'insertThemeCss',
  deletethemecss: 'deleteThemeCss',
  removethemecss: 'deleteThemeCss',
  replacethemecss: 'replaceThemeCss',
  inspectthemerender: 'inspectThemeRender',
  applypreset: 'applyPreset',
  applythemepreset: 'applyPreset',
  createcodecard: 'createCodeCard',
  starttask: 'startTask',
  opentask: 'startTask',
  begintask: 'startTask',
  wait: 'wait',
  sleep: 'wait',
  delay: 'wait',
  pollwait: 'wait',
  createprojectfile: 'createProjectFile',
  patchroomproject: 'patchRoomProject',
  patchprojectcover: 'patchRoomProject',
  patchworkspacecover: 'patchRoomProject',
  updateprojectcover: 'patchRoomProject',
  writeprojectfiles: 'writeProjectFiles',
  replaceprojectfiles: 'writeProjectFiles',
  listprojectfiles: 'listProjectFiles',
  lsprojectfiles: 'listProjectFiles',
  searchprojectfiles: 'searchProjectFiles',
  grepworkspace: 'searchProjectFiles',
  grepprojectfiles: 'searchProjectFiles',
  readworkspacepreviewstate: 'readWorkspacePreviewState',
  readprojectpreviewstate: 'readWorkspacePreviewState',
  readpreviewstate: 'readWorkspacePreviewState',
  readroomstate: 'readWorkspacePreviewState',
  listworkspacereferences: 'listWorkspaceReferences',
  listworkspacerefs: 'listWorkspaceReferences',
  searchworkspacereferences: 'searchWorkspaceReferences',
  searchworkspacerefs: 'searchWorkspaceReferences',
  readworkspacereference: 'readWorkspaceReference',
  readworkspaceref: 'readWorkspaceReference',
  promoteworkspacereferencetoprojectfile: 'promoteWorkspaceReferenceToProjectFile',
  promoteworkspacereftoprojectfile: 'promoteWorkspaceReferenceToProjectFile',
  materializeworkspacereference: 'promoteWorkspaceReferenceToProjectFile',
  materializeworkspaceref: 'promoteWorkspaceReferenceToProjectFile',
  materializereference: 'promoteWorkspaceReferenceToProjectFile',
  referencetoprojectfile: 'promoteWorkspaceReferenceToProjectFile',
  reftoprojectfile: 'promoteWorkspaceReferenceToProjectFile',
  pinprojectfileasreference: 'pinProjectFileAsReference',
  pinprojectfileasref: 'pinProjectFileAsReference',
  projectfiletoreference: 'pinProjectFileAsReference',
  projectfiletoref: 'pinProjectFileAsReference',
  pinfileasreference: 'pinProjectFileAsReference',
  searchreadablecontext: 'searchReadableContext',
  findreadablecontext: 'searchReadableContext',
  checkprojectpreview: 'checkProjectPreview',
  runprojectpreview: 'checkProjectPreview',
  inspectprojectruntime: 'inspectProjectRuntime',
  runprojectruntime: 'inspectProjectRuntime',
  inspectruntime: 'inspectProjectRuntime',
  promotecardtoproject: 'promoteCardToProject',
  upgradetoproject: 'promoteCardToProject',
  promotetoworkspace: 'promoteCardToProject',
  listcodecards: 'listCodeCards',
  listroomcards: 'listCodeCards',
  listcards: 'listCodeCards',
  patchcodecard: 'patchCodeCard',
  appendcodecard: 'appendCodeCard',
  appendprojectfile: 'appendProjectFile',
  insertprojectfile: 'insertProjectFile',
  insertintoprojectfile: 'insertProjectFile',
  replaceprojectfilelines: 'replaceProjectFileLines',
  editprojectfilelines: 'replaceProjectFileLines',
  replaceprojectlines: 'replaceProjectFileLines',
  editcodecardtext: 'editCodeCardText',
  editprojectfiletext: 'editProjectFileText',
  deleteprojectfile: 'deleteProjectFile',
  removeprojectfile: 'deleteProjectFile',
  replaceprojectfiletext: 'editProjectFileText',
  replacecodecardtext: 'editCodeCardText',
  readcodecard: 'readCodeCard',
  readprojectfile: 'readProjectFile',
  readprojectfilecontext: 'readProjectFileContext',
  readprojectfilearound: 'readProjectFileContext',
  readprojectcontext: 'readProjectFileContext',
  writememory: 'writeMemory',
  writememorydoc: 'writeMemoryDoc',
  writereferencedoc: 'writeMemoryDoc',
  writelongtermmemorydoc: 'writeMemoryDoc',
  readmemorydoc: 'readMemoryDoc',
  readreferencedoc: 'readMemoryDoc',
  readlongtermmemory: 'readMemoryDoc',
  searchmemory: 'searchMemory',
  findmemory: 'searchMemory',
  searchpastmemory: 'searchMemory',
  openmemorysource: 'openMemorySource',
  readmemorysource: 'openMemorySource',
  openpastconversation: 'openMemorySource',
  readpolarisknowledge: 'readPolarisKnowledge',
  readpolarisguide: 'readPolarisKnowledge',
  inspectattachment: 'inspectAttachment',
  readattachment: 'readAttachment',
  bundleattachment: 'bundleAttachment',
  saveattachment: 'saveAttachment',
  inspectattachments: 'inspectAttachments',
  sendimage: 'sendImageAttachment',
  sendimageattachment: 'sendImageAttachment',
  showimage: 'sendImageAttachment',
  shareimage: 'sendImageAttachment',
  attachimage: 'sendImageAttachment',
  websearch: 'webSearch',
  readwebpage: 'readWebPage',
  listcalendars: 'listCalendars',
  listcalendar: 'listCalendars',
  readcalendarevents: 'readCalendarEvents',
  readcalendar: 'readCalendarEvents',
  createcalendarevent: 'createCalendarEvent',
  createcalendar: 'createCalendarEvent',
  addcalendarevent: 'createCalendarEvent',
  addcalendar: 'createCalendarEvent',
  updatecalendarevent: 'updateCalendarEvent',
  updatecalendar: 'updateCalendarEvent',
  editcalendarevent: 'updateCalendarEvent',
  editcalendar: 'updateCalendarEvent',
  deletecalendarevent: 'deleteCalendarEvent',
  deletecalendar: 'deleteCalendarEvent',
  removecalendarevent: 'deleteCalendarEvent',
  readattachmenttext: 'readAttachmentText',
  bundleattachments: 'bundleAttachments',
  createqrcode: 'createQrCode',
  saveattachmenttocollection: 'saveAttachmentToCollection',
  saveattachmentascodecard: 'saveAttachmentAsCodeCard',
  inspectarchiveentries: 'inspectArchiveEntries',
  readarchiveentrytext: 'readArchiveEntryText',
  bundlearchiveentries: 'bundleArchiveEntries',
  savearchiveentryascodecard: 'saveArchiveEntryAsCodeCard',
  listdesktopworkspaces: 'listDesktopWorkspaces',
  listdesktopworkspace: 'listDesktopWorkspaces',
  listlocalworkspaces: 'listDesktopWorkspaces',
  listdesktopfiles: 'listDesktopFiles',
  lsdesktopfiles: 'listDesktopFiles',
  listlocalfiles: 'listDesktopFiles',
  readdesktopfile: 'readDesktopFile',
  readlocalfile: 'readDesktopFile',
  searchdesktopfiles: 'searchDesktopFiles',
  searchlocalfiles: 'searchDesktopFiles',
  readdesktopfilecontext: 'readDesktopFileContext',
  readlocalfilecontext: 'readDesktopFileContext',
  writedesktopfile: 'writeDesktopFile',
  writelocalfile: 'writeDesktopFile',
  editdesktopfiletext: 'editDesktopFileText',
  patchdesktopfiletext: 'editDesktopFileText',
  editlocalfiletext: 'editDesktopFileText',
  patchlocalfiletext: 'editDesktopFileText',
  replacedesktopfilelines: 'replaceDesktopFileLines',
  replacelocalfilelines: 'replaceDesktopFileLines',
  createdesktopdirectory: 'createDesktopDirectory',
  createdesktopfolder: 'createDesktopDirectory',
  createlocaldirectory: 'createDesktopDirectory',
  createlocalfolder: 'createDesktopDirectory',
  deletedesktoppath: 'deleteDesktopPath',
  deletedesktopfile: 'deleteDesktopPath',
  deletedesktopdirectory: 'deleteDesktopPath',
  deletelocalpath: 'deleteDesktopPath',
  removelocalpath: 'deleteDesktopPath',
  movedesktoppath: 'moveDesktopPath',
  renamedesktoppath: 'moveDesktopPath',
  movelocalpath: 'moveDesktopPath',
  renamelocalpath: 'moveDesktopPath',
  rundesktopcommand: 'runDesktopCommand',
  runlocalcommand: 'runDesktopCommand',
  rundesktopcommandsequence: 'runDesktopCommandSequence',
  runlocalcommandsequence: 'runDesktopCommandSequence',
  rundesktopverification: 'runDesktopCommandSequence',
  runlocalverification: 'runDesktopCommandSequence',
  rundesktopworkflow: 'runDesktopCommandSequence',
  runlocalworkflow: 'runDesktopCommandSequence',
  startdesktopcommand: 'startDesktopCommand',
  startlocalcommand: 'startDesktopCommand',
  listdesktopcommandsessions: 'listDesktopCommandSessions',
  listlocalcommandsessions: 'listDesktopCommandSessions',
  stopdesktopcommand: 'stopDesktopCommand',
  stoplocalcommand: 'stopDesktopCommand'
};

function normalizeAliasKey(key: string) {
  return key
    .trim()
    .replace(/['"]/g, '')
    .replace(/[\s_-]+/g, '_')
    .toLowerCase();
}

function canonicalizeKey(key: string) {
  const normalized = normalizeAliasKey(key);
  return KEY_ALIASES[normalized] ?? KEY_ALIASES[normalized.replace(/_/g, '')] ?? key.trim();
}

function canonicalizeKind(kind: string) {
  const normalized = normalizeAliasKey(kind).replace(/_/g, '');
  return ACTION_KIND_ALIASES[normalized] ?? kind.trim();
}

function findMcpDiscriminator(object: Record<string, unknown>) {
  for (const key of ['kind', 'type', 'name'] as const) {
    const value = object[key];
    if (typeof value === 'string' && value.trim().startsWith('mcp__')) {
      return { key, schemaName: value.trim() };
    }
  }
  return null;
}

export function canonicalizeAssistantToolValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeAssistantToolValue);
  }

  const object = asObject(value);
  if (!object) {
    return value;
  }

  const mcpDiscriminator = findMcpDiscriminator(object);
  if (mcpDiscriminator) {
    const argumentsEntries = Object.entries(object)
      .filter(([key]) => key !== mcpDiscriminator.key)
      .map(([key, entryValue]) => [key.trim(), entryValue] as const);
    return {
      ...Object.fromEntries(argumentsEntries),
      kind: mcpDiscriminator.schemaName
    };
  }

  const hasExplicitKind = typeof object.kind === 'string' || typeof object.type === 'string';
  const entries = Object.entries(object).map(([key, entryValue]) => {
    const nextKey = hasExplicitKind && normalizeAliasKey(key) === 'name' ? 'name' : canonicalizeKey(key);
    const nextValue = canonicalizeAssistantToolValue(entryValue);
    if (nextKey === 'kind' && typeof nextValue === 'string') {
      return [nextKey, canonicalizeKind(nextValue)] as const;
    }
    return [nextKey, nextValue] as const;
  });

  return Object.fromEntries(entries);
}

export function extractCanonicalAssistantToolItems(value: unknown): unknown[] {
  const canonicalValue = canonicalizeAssistantToolValue(value);
  if (Array.isArray(canonicalValue)) {
    return canonicalValue;
  }

  const root = asObject(canonicalValue);
  if (!root) {
    return [canonicalValue];
  }

  if (typeof root.kind === 'string') {
    return [root];
  }

  const candidates = [root.actions, root.action, root.toolActions, root.toolAction, root.items];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate != null) return [candidate];
  }

  return [root];
}
