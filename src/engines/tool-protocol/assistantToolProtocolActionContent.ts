import { asObject, normalizeStringArray } from './assistantToolProtocolShared';
import type { ParseActionResult } from './assistantToolProtocolActionShared';
import type { AssistantToolActionParseContext } from './assistantToolProtocolActionContext';
import { parseProjectDiagnosticToolAction } from './assistantToolProtocolActionProjectDiagnostics';
import { parseProjectFileToolAction } from './assistantToolProtocolActionProjectFiles';
import { parseRoomProjectToolAction } from './assistantToolProtocolActionRoomProjects';
import { parseWorkspaceReferenceToolAction } from './assistantToolProtocolActionWorkspaceReferences';
import {
  normalizeMemoryItems,
  normalizeOptionalString,
  normalizePositiveInt
} from './assistantToolProtocolActionShared';

function normalizeOptionalCssText(value: unknown) {
  return typeof value === 'string' ? value.trim() : undefined;
}

function normalizeOptionalBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

function normalizeOptionalPositiveNumber(value: unknown) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : undefined;
}

function normalizeCodeCardKind(value: unknown) {
  return value === 'tool' || value === 'room-rule' || value === 'card'
    ? value
    : undefined;
}

function normalizeStartTaskCapability(value: unknown) {
  switch (value) {
    case 'theme':
    case 'room':
    case 'workspace':
    case 'desktop':
    case 'app':
    case 'code':
    case 'mcp':
    case 'general':
      return value;
    default:
      return undefined;
  }
}

function normalizeConversationMode(value: unknown) {
  return value === 'follow-latest' ? 'follow-latest' : 'fixed';
}

function normalizeMemorySearchMode(value: unknown) {
  return value === 'summary' || value === 'source' || value === 'auto' ? value : undefined;
}

function normalizeDesktopCommandSequenceSteps(value: unknown) {
  if (!Array.isArray(value)) return null;
  const steps = value.flatMap((entry) => {
    const step = asObject(entry);
    const command = normalizeOptionalString(step?.command);
    if (!step || !command) return [];
    return [{
      label: normalizeOptionalString(step.label),
      command,
      args: normalizeStringArray(step.args),
      cwdPath: normalizeOptionalString(step.cwdPath) ?? normalizeOptionalString(step.cwd)
    }];
  });
  return steps.length === value.length ? steps : null;
}

function normalizeProactiveSchedule(action: Record<string, unknown>, options: { required: boolean }) {
  const nestedSchedule = asObject(action.schedule);
  const time = normalizeOptionalString(action.time) ?? normalizeOptionalString(nestedSchedule?.time);
  const everyMinutes =
    normalizePositiveInt(action.everyMinutes)
    ?? normalizePositiveInt(action.every_minutes)
    ?? normalizePositiveInt(nestedSchedule?.everyMinutes)
    ?? normalizePositiveInt(nestedSchedule?.every_minutes);
  const scheduleKind = typeof action.scheduleKind === 'string'
    ? action.scheduleKind
    : typeof action.schedule_kind === 'string'
      ? action.schedule_kind
      : typeof nestedSchedule?.kind === 'string'
        ? nestedSchedule.kind
        : time
          ? 'daily'
          : everyMinutes
            ? 'interval'
            : '';

  if (!scheduleKind && !options.required) {
    return { ok: true as const, schedule: undefined };
  }

  if (scheduleKind === 'interval') {
    if (!everyMinutes) return { ok: false as const, issue: '主动消息 interval 规则缺少 everyMinutes。' };
    return {
      ok: true as const,
      schedule: {
        kind: 'interval' as const,
        everyMinutes
      }
    };
  }

  if (scheduleKind === 'daily') {
    if (!time) return { ok: false as const, issue: '主动消息 daily 规则缺少 time。' };
    return {
      ok: true as const,
      schedule: {
        kind: 'daily' as const,
        time
      }
    };
  }

  return { ok: false as const, issue: options.required ? '主动消息规则缺少 scheduleKind。' : '主动消息规则的 scheduleKind 只能是 daily 或 interval。' };
}

export function parseContentToolAction(
  action: Record<string, unknown>,
  context?: AssistantToolActionParseContext
): ParseActionResult | null {
  const projectFileResult = parseProjectFileToolAction(action, context);
  if (projectFileResult) return projectFileResult;
  const roomProjectResult = parseRoomProjectToolAction(action);
  if (roomProjectResult) return roomProjectResult;
  const workspaceReferenceResult = parseWorkspaceReferenceToolAction(action, context);
  if (workspaceReferenceResult) return workspaceReferenceResult;
  const projectDiagnosticResult = parseProjectDiagnosticToolAction(action);
  if (projectDiagnosticResult) return projectDiagnosticResult;

  switch (action.kind) {
    case 'listCodeCards': {
      return { action: {
        kind: 'listCodeCards',
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'createCodeCard': {
      const card = asObject(action.card);
      if (!card || typeof card.code !== 'string' || !card.code.trim()) {
        return { action: null, issue: '新建卡片时缺少 code 内容。' };
      }
      return { action: {
        kind: 'createCodeCard',
        card: {
          kind: normalizeCodeCardKind(card.kind),
          title: normalizeOptionalString(card.title),
          cardNote: normalizeOptionalString(card.cardNote),
          language: normalizeOptionalString(card.language),
          code: card.code,
          cardFaceCss: normalizeOptionalCssText(card.cardFaceCss),
          tags: normalizeStringArray(card.tags)
        },
        targetLabel: normalizeOptionalString(action.targetLabel),
        openInCollection: normalizeOptionalBoolean(action.openInCollection) ?? true
      } };
    }
    case 'patchCodeCard': {
      const patch = asObject(action.patch);
      if (!patch) return { action: null, issue: '房间 patch 缺少内容。' };
      return { action: {
        kind: 'patchCodeCard',
        target: normalizeOptionalString(action.target),
        targetLabel: normalizeOptionalString(action.targetLabel),
        patch: {
          kind: normalizeCodeCardKind(patch.kind),
          title: normalizeOptionalString(patch.title),
          cardNote: normalizeOptionalString(patch.cardNote),
          language: normalizeOptionalString(patch.language),
          code: normalizeOptionalString(patch.code),
          cardFaceCss: normalizeOptionalCssText(patch.cardFaceCss),
          tags: normalizeStringArray(patch.tags)
        },
        openInCollection: normalizeOptionalBoolean(action.openInCollection) ?? true
      } };
    }
    case 'appendCodeCard': {
      const code = typeof action.code === 'string' ? action.code : '';
      if (!code) return { action: null, issue: '追加房间内容时缺少 code。' };
      return { action: {
        kind: 'appendCodeCard',
        target: normalizeOptionalString(action.target),
        targetLabel: normalizeOptionalString(action.targetLabel),
        code,
        openInCollection: normalizeOptionalBoolean(action.openInCollection)
      } };
    }
    case 'editCodeCardText': {
      const oldString = typeof action.oldString === 'string' ? action.oldString : '';
      const newString = typeof action.newString === 'string' ? action.newString : '';
      if (!oldString) return { action: null, issue: '局部替换时缺少 oldString。' };
      return { action: {
        kind: 'editCodeCardText',
        target: normalizeOptionalString(action.target),
        targetLabel: normalizeOptionalString(action.targetLabel),
        oldString,
        newString,
        openInCollection: normalizeOptionalBoolean(action.openInCollection)
      } };
    }
    case 'readCodeCard': {
      return { action: {
        kind: 'readCodeCard',
        target: normalizeOptionalString(action.target),
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'writeMemory': {
      const memory = normalizeMemoryItems(action);
      if (!memory.length) return { action: null, issue: '记忆列表是空的，无法写入。' };
      return { action: {
        kind: 'writeMemory',
        memory,
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'writeMemoryDoc': {
      const title = normalizeOptionalString(action.title);
      const content = normalizeOptionalString(action.content);
      if (!title) return { action: null, issue: '写入长期资料时缺少 title。' };
      if (!content) return { action: null, issue: '写入长期资料时缺少 content。' };
      return { action: {
        kind: 'writeMemoryDoc',
        docId: normalizeOptionalString(action.docId) ?? normalizeOptionalString(action.target),
        title,
        summary: normalizeOptionalString(action.summary),
        content,
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'readMemoryDoc': {
      const docId = normalizeOptionalString(action.docId) ?? normalizeOptionalString(action.target);
      if (!docId) return { action: null, issue: '缺少要读取的长期资料 docId。' };
      return { action: {
        kind: 'readMemoryDoc',
        docId,
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'searchMemory': {
      const query = normalizeOptionalString(action.query) ?? normalizeOptionalString(action.target);
      if (!query) return { action: null, issue: '搜索记忆时缺少 query。' };
      return { action: {
        kind: 'searchMemory',
        query,
        mode: normalizeMemorySearchMode(action.mode),
        maxResults: normalizePositiveInt(action.maxResults),
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'openMemorySource': {
      const sourceConversationId =
        normalizeOptionalString(action.sourceConversationId)
        ?? normalizeOptionalString(action.conversationId)
        ?? normalizeOptionalString(action.target);
      if (!sourceConversationId) return { action: null, issue: '打开记忆原文时缺少 sourceConversationId。' };
      return { action: {
        kind: 'openMemorySource',
        sourceConversationId,
        sourceMessageIds: normalizeStringArray(action.sourceMessageIds).length
          ? normalizeStringArray(action.sourceMessageIds)
          : normalizeStringArray(action.messageIds),
        maxChars: normalizePositiveInt(action.maxChars),
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'readPolarisKnowledge': {
      return { action: {
        kind: 'readPolarisKnowledge',
        topic: normalizeOptionalString(action.topic) ?? normalizeOptionalString(action.target),
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'listEnvironmentNodes': {
      return { action: {
        kind: 'listEnvironmentNodes',
        parentNodeId: normalizeOptionalString(action.parentNodeId) ?? normalizeOptionalString(action.target),
        depth: normalizePositiveInt(action.depth),
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'inspectEnvironmentNode': {
      const nodeId = normalizeOptionalString(action.nodeId) ?? normalizeOptionalString(action.target);
      if (!nodeId) return { action: null, issue: '检查环境节点时缺少 nodeId。' };
      const detailLevel = action.detailLevel === 'expanded' ? 'expanded' : action.detailLevel === 'summary' ? 'summary' : undefined;
      return { action: {
        kind: 'inspectEnvironmentNode',
        nodeId,
        detailLevel,
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'searchEnvironmentNodes': {
      const query = normalizeOptionalString(action.query) ?? normalizeOptionalString(action.target);
      if (!query) return { action: null, issue: '搜索环境目录时缺少 query。' };
      return { action: {
        kind: 'searchEnvironmentNodes',
        query,
        scopeNodeId: normalizeOptionalString(action.scopeNodeId),
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'startTask': {
      return { action: {
        kind: 'startTask',
        capability: normalizeStartTaskCapability(action.capability),
        title: normalizeOptionalString(action.title),
        stage: normalizeOptionalString(action.stage),
        steps: normalizeStringArray(action.steps).slice(0, 3),
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'completeTask': {
      return { action: {
        kind: 'completeTask',
        stage: normalizeOptionalString(action.stage),
        summary: normalizeOptionalString(action.summary),
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'wait': {
      return { action: {
        kind: 'wait',
        seconds:
          normalizeOptionalPositiveNumber(action.seconds)
          ?? normalizeOptionalPositiveNumber(action.durationSeconds)
          ?? normalizeOptionalPositiveNumber(action.delaySeconds),
        reason:
          normalizeOptionalString(action.reason)
          ?? normalizeOptionalString(action.purpose)
          ?? normalizeOptionalString(action.target),
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'createProactiveMessageRule': {
      const prompt = normalizeOptionalString(action.prompt) ?? normalizeOptionalString(action.content);
      if (!prompt) return { action: null, issue: '主动消息规则缺少 prompt。' };
      const schedule = normalizeProactiveSchedule(action, { required: true });
      if (!schedule.ok) return { action: null, issue: schedule.issue };
      if (!schedule.schedule) return { action: null, issue: '主动消息规则缺少 scheduleKind。' };
      return { action: {
        kind: 'createProactiveMessageRule',
        name: normalizeOptionalString(action.name) ?? normalizeOptionalString(action.title),
        prompt,
        schedule: schedule.schedule,
        conversationMode: normalizeConversationMode(action.conversationMode),
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'listProactiveMessageRules': {
      return { action: {
        kind: 'listProactiveMessageRules',
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'updateProactiveMessageRule': {
      const ruleId = normalizeOptionalString(action.ruleId) ?? normalizeOptionalString(action.rule_id) ?? normalizeOptionalString(action.target);
      if (!ruleId) return { action: null, issue: '修改主动消息规则缺少 ruleId。' };
      const schedule = normalizeProactiveSchedule(action, { required: false });
      if (!schedule.ok) return { action: null, issue: schedule.issue };
      const name = normalizeOptionalString(action.name) ?? normalizeOptionalString(action.title);
      const prompt = normalizeOptionalString(action.prompt) ?? normalizeOptionalString(action.content);
      const conversationMode = action.conversationMode === 'follow-latest' || action.conversationMode === 'fixed'
        ? action.conversationMode
        : undefined;
      if (!name && !prompt && !schedule.schedule && !conversationMode) {
        return { action: null, issue: '修改主动消息规则时没有提供要修改的字段。' };
      }
      return { action: {
        kind: 'updateProactiveMessageRule',
        ruleId,
        name,
        prompt,
        schedule: schedule.schedule,
        conversationMode,
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'deleteProactiveMessageRule': {
      const ruleId = normalizeOptionalString(action.ruleId) ?? normalizeOptionalString(action.rule_id) ?? normalizeOptionalString(action.target);
      if (!ruleId) return { action: null, issue: '取消主动消息规则缺少 ruleId。' };
      return { action: {
        kind: 'deleteProactiveMessageRule',
        ruleId,
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'webSearch': {
      const query =
        typeof action.query === 'string'
          ? action.query.trim()
          : typeof action.q === 'string'
            ? action.q.trim()
            : '';
      if (!query) return { action: null, issue: '联网搜索动作缺少 query。' };
      return { action: {
        kind: 'webSearch',
        query,
        maxResults: normalizePositiveInt(action.maxResults),
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'readWebPage': {
      const url =
        typeof action.url === 'string'
          ? action.url.trim()
          : typeof action.target === 'string'
            ? action.target.trim()
            : '';
      if (!url) return { action: null, issue: '网页读取动作缺少 url。' };
      return { action: {
        kind: 'readWebPage',
        url,
        maxChars: normalizePositiveInt(action.maxChars),
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'listCalendars': {
      return { action: {
        kind: 'listCalendars',
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'readCalendarEvents': {
      return { action: {
        kind: 'readCalendarEvents',
        startDate: normalizeOptionalString(action.startDate),
        endDate: normalizeOptionalString(action.endDate),
        query: normalizeOptionalString(action.query),
        maxEvents: normalizePositiveInt(action.maxEvents),
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'createCalendarEvent': {
      const title = normalizeOptionalString(action.title);
      const startDate = normalizeOptionalString(action.startDate);
      if (!title) return { action: null, issue: '创建日程缺少 title。' };
      if (!startDate) return { action: null, issue: '创建日程缺少 startDate。' };
      return { action: {
        kind: 'createCalendarEvent',
        title,
        startDate,
        endDate: normalizeOptionalString(action.endDate),
        allDay: normalizeOptionalBoolean(action.allDay),
        location: typeof action.location === 'string' ? action.location.trim() : undefined,
        notes: typeof action.notes === 'string' ? action.notes.trim() : undefined,
        calendarId: normalizeOptionalString(action.calendarId),
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'updateCalendarEvent': {
      const eventId = normalizeOptionalString(action.eventId) ?? normalizeOptionalString(action.id);
      if (!eventId) return { action: null, issue: '修改日程缺少 eventId。' };
      return { action: {
        kind: 'updateCalendarEvent',
        eventId,
        title: normalizeOptionalString(action.title),
        startDate: normalizeOptionalString(action.startDate),
        endDate: normalizeOptionalString(action.endDate),
        allDay: normalizeOptionalBoolean(action.allDay),
        location: typeof action.location === 'string' ? action.location.trim() : undefined,
        notes: typeof action.notes === 'string' ? action.notes.trim() : undefined,
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'deleteCalendarEvent': {
      const eventId = normalizeOptionalString(action.eventId) ?? normalizeOptionalString(action.id);
      if (!eventId) return { action: null, issue: '删除日程缺少 eventId。' };
      return { action: {
        kind: 'deleteCalendarEvent',
        eventId,
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'createQrCode': {
      const text =
        typeof action.text === 'string'
          ? action.text.trim()
          : typeof action.content === 'string'
            ? action.content.trim()
            : typeof action.url === 'string'
              ? action.url.trim()
              : '';
      if (!text) return { action: null, issue: '二维码动作缺少 text 内容。' };
      return { action: {
        kind: 'createQrCode',
        text,
        fileName: normalizeOptionalString(action.fileName),
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'runCode': {
      const code =
        typeof action.code === 'string'
          ? action.code.trim()
          : '';
      if (!code) return { action: null, issue: '代码执行动作缺少 code 内容。' };
      return { action: {
        kind: 'runCode',
        code,
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'listDesktopWorkspaces': {
      return { action: {
        kind: 'listDesktopWorkspaces',
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'listDesktopFiles': {
      return { action: {
        kind: 'listDesktopFiles',
        rootId: normalizeOptionalString(action.rootId),
        path: normalizeOptionalString(action.path) ?? normalizeOptionalString(action.directory),
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'readDesktopFile': {
      const filePath = normalizeOptionalString(action.filePath) ?? normalizeOptionalString(action.path);
      if (!filePath) return { action: null, issue: '读取本机文件时缺少 filePath。' };
      return { action: {
        kind: 'readDesktopFile',
        rootId: normalizeOptionalString(action.rootId),
        filePath,
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'searchDesktopFiles': {
      const query = typeof action.query === 'string' ? action.query.trim() : '';
      if (!query) return { action: null, issue: '搜索本机文件时缺少 query。' };
      return { action: {
        kind: 'searchDesktopFiles',
        rootId: normalizeOptionalString(action.rootId),
        path: normalizeOptionalString(action.path) ?? normalizeOptionalString(action.directory),
        query,
        maxResults: normalizePositiveInt(action.maxResults),
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'readDesktopFileContext': {
      const filePath = normalizeOptionalString(action.filePath) ?? normalizeOptionalString(action.path);
      if (!filePath) return { action: null, issue: '读取本机文件上下文时缺少 filePath。' };
      return { action: {
        kind: 'readDesktopFileContext',
        rootId: normalizeOptionalString(action.rootId),
        filePath,
        query: normalizeOptionalString(action.query),
        lineNumber: normalizePositiveInt(action.lineNumber),
        before: normalizePositiveInt(action.before),
        after: normalizePositiveInt(action.after),
        occurrence: normalizePositiveInt(action.occurrence),
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'writeDesktopFile': {
      const filePath = normalizeOptionalString(action.filePath) ?? normalizeOptionalString(action.path);
      if (!filePath) return { action: null, issue: '写入本机文件时缺少 filePath。' };
      if (typeof action.content !== 'string') return { action: null, issue: '写入本机文件时缺少 content。' };
      return { action: {
        kind: 'writeDesktopFile',
        rootId: normalizeOptionalString(action.rootId),
        filePath,
        content: action.content,
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'editDesktopFileText': {
      const filePath = normalizeOptionalString(action.filePath) ?? normalizeOptionalString(action.path);
      if (!filePath) return { action: null, issue: '局部替换本机文件时缺少 filePath。' };
      if (typeof action.oldString !== 'string') return { action: null, issue: '局部替换本机文件时缺少 oldString。' };
      if (typeof action.newString !== 'string') return { action: null, issue: '局部替换本机文件时缺少 newString。' };
      return { action: {
        kind: 'editDesktopFileText',
        rootId: normalizeOptionalString(action.rootId),
        filePath,
        oldString: action.oldString,
        newString: action.newString,
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'replaceDesktopFileLines': {
      const filePath = normalizeOptionalString(action.filePath) ?? normalizeOptionalString(action.path);
      if (!filePath) return { action: null, issue: '按行替换本机文件时缺少 filePath。' };
      if (typeof action.code !== 'string') return { action: null, issue: '按行替换本机文件时缺少 code。' };
      const startLine = normalizePositiveInt(action.startLine);
      const endLine = normalizePositiveInt(action.endLine);
      if (!startLine) return { action: null, issue: '按行替换本机文件时缺少 startLine。' };
      if (endLine && endLine < startLine) return { action: null, issue: '按行替换本机文件时 endLine 不能小于 startLine。' };
      return { action: {
        kind: 'replaceDesktopFileLines',
        rootId: normalizeOptionalString(action.rootId),
        filePath,
        startLine,
        endLine,
        code: action.code,
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'createDesktopDirectory': {
      const directoryPath = normalizeOptionalString(action.path) ?? normalizeOptionalString(action.filePath);
      if (!directoryPath) return { action: null, issue: '创建本机文件夹时缺少 path。' };
      return { action: {
        kind: 'createDesktopDirectory',
        rootId: normalizeOptionalString(action.rootId),
        path: directoryPath,
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'deleteDesktopPath': {
      const targetPath = normalizeOptionalString(action.path) ?? normalizeOptionalString(action.filePath);
      if (!targetPath) return { action: null, issue: '删除本机路径时缺少 path。' };
      return { action: {
        kind: 'deleteDesktopPath',
        rootId: normalizeOptionalString(action.rootId),
        path: targetPath,
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'moveDesktopPath': {
      const fromPath = normalizeOptionalString(action.fromPath);
      const toPath = normalizeOptionalString(action.toPath);
      if (!fromPath || !toPath) return { action: null, issue: '移动本机路径时必须提供 fromPath 和 toPath。' };
      return { action: {
        kind: 'moveDesktopPath',
        rootId: normalizeOptionalString(action.rootId),
        fromPath,
        toPath,
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'runDesktopCommand': {
      const command = normalizeOptionalString(action.command);
      if (!command) return { action: null, issue: '运行本机命令时缺少 command。' };
      return { action: {
        kind: 'runDesktopCommand',
        rootId: normalizeOptionalString(action.rootId),
        command,
        args: normalizeStringArray(action.args),
        cwdPath: normalizeOptionalString(action.cwdPath) ?? normalizeOptionalString(action.cwd),
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'runDesktopCommandSequence': {
      const steps = normalizeDesktopCommandSequenceSteps(action.steps ?? action.commands);
      if (!steps?.length) return { action: null, issue: '运行本机命令流程时缺少 steps。' };
      return { action: {
        kind: 'runDesktopCommandSequence',
        rootId: normalizeOptionalString(action.rootId),
        steps,
        continueOnError: normalizeOptionalBoolean(action.continueOnError) ?? false,
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'startDesktopCommand': {
      const command = normalizeOptionalString(action.command);
      if (!command) return { action: null, issue: '启动本机终端会话时缺少 command。' };
      return { action: {
        kind: 'startDesktopCommand',
        rootId: normalizeOptionalString(action.rootId),
        command,
        args: normalizeStringArray(action.args),
        cwdPath: normalizeOptionalString(action.cwdPath) ?? normalizeOptionalString(action.cwd),
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'listDesktopCommandSessions': {
      return { action: {
        kind: 'listDesktopCommandSessions',
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'stopDesktopCommand': {
      const sessionId = normalizeOptionalString(action.sessionId);
      if (!sessionId) return { action: null, issue: '停止本机终端会话时缺少 sessionId。' };
      return { action: {
        kind: 'stopDesktopCommand',
        sessionId,
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'syncDesktopWorkspaceFromDisk': {
      return { action: {
        kind: 'syncDesktopWorkspaceFromDisk',
        projectId: normalizeOptionalString(action.projectId),
        rootId: normalizeOptionalString(action.rootId),
        allowOverwrite: normalizeOptionalBoolean(action.allowOverwrite) ?? false,
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    case 'syncDesktopWorkspaceToDisk': {
      return { action: {
        kind: 'syncDesktopWorkspaceToDisk',
        projectId: normalizeOptionalString(action.projectId),
        rootId: normalizeOptionalString(action.rootId),
        allowOverwrite: normalizeOptionalBoolean(action.allowOverwrite) ?? false,
        targetLabel: normalizeOptionalString(action.targetLabel)
      } };
    }
    default:
      return null;
  }
}
