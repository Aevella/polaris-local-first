import type { ToolAction, ToolContext, ToolExecutionResult } from './toolExecutorTypes';
import type { ToolExecutorPlugin } from './toolExecutorPlugins';
import { isToolActionKindHandledByPlugin } from './tool-protocol/toolManifest';
import { inferCodeLanguage } from './codeCardLanguage';
import { readProjectFileContext, searchProjectFiles } from './projectFileInspection';
import {
  buildAmbiguousSnippetError,
  buildMissingSnippetError,
  countStringOccurrences,
  resolveProjectFileLineReplacement
} from './toolExecutorCollectionTextEdit';
import {
  formatProjectFileContext,
  formatProjectFileSearch
} from './toolExecutorCollectionProjectFiles';
import type { DesktopLocalCommandSession, DesktopLocalWorkspaceFileSnapshot } from '../desktop/localHost';
import type { DesktopLocalCommandSequenceResult } from '../desktop/localHost';

export type UtilityToolAction = Extract<
  ToolAction,
  {
    kind:
      | 'runCode'
      | 'listDesktopWorkspaces'
      | 'listDesktopFiles'
      | 'readDesktopFile'
      | 'searchDesktopFiles'
      | 'readDesktopFileContext'
      | 'writeDesktopFile'
      | 'editDesktopFileText'
      | 'replaceDesktopFileLines'
      | 'createDesktopDirectory'
      | 'deleteDesktopPath'
      | 'moveDesktopPath'
      | 'runDesktopCommand'
      | 'runDesktopCommandSequence'
      | 'startDesktopCommand'
      | 'listDesktopCommandSessions'
      | 'stopDesktopCommand'
      | 'syncDesktopWorkspaceFromDisk'
      | 'syncDesktopWorkspaceToDisk'
      | 'writeMemory'
      | 'writeMemoryDoc'
      | 'readMemoryDoc'
      | 'searchMemory'
      | 'openMemorySource'
      | 'readPolarisKnowledge'
      | 'listEnvironmentNodes'
      | 'inspectEnvironmentNode'
      | 'searchEnvironmentNodes'
      | 'listCalendars'
      | 'readCalendarEvents'
      | 'createCalendarEvent'
      | 'updateCalendarEvent'
      | 'deleteCalendarEvent'
      | 'startTask'
      | 'completeTask'
      | 'wait'
      | 'createProactiveMessageRule'
      | 'listProactiveMessageRules'
      | 'updateProactiveMessageRule'
      | 'deleteProactiveMessageRule';
  }
>;

export function isUtilityToolAction(action: ToolAction): action is UtilityToolAction {
  return isToolActionKindHandledByPlugin(action.kind, 'utility');
}

function pathMatchesDesktopPrefix(path: string, prefix?: string) {
  const normalizedPrefix = prefix?.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\/+/, '').replace(/\/+$/, '');
  if (!normalizedPrefix) return true;
  return path === normalizedPrefix || path.startsWith(`${normalizedPrefix}/`);
}

function desktopFileLanguage(file: Pick<DesktopLocalWorkspaceFileSnapshot, 'relativePath' | 'content'>) {
  const extension = file.relativePath.split('.').pop();
  return inferCodeLanguage(file.content, extension);
}

function desktopFileSnapshotToResolved(file: DesktopLocalWorkspaceFileSnapshot) {
  return {
    fileId: file.relativePath,
    title: file.relativePath.split('/').pop() || file.relativePath,
    language: desktopFileLanguage(file),
    path: file.relativePath,
    role: undefined,
    isEntry: false,
    content: file.content
  };
}

function formatDesktopCommandSession(session: DesktopLocalCommandSession) {
  const commandLine = `$ ${[session.command, ...session.args].join(' ')}`;
  return [
    `${session.id} · ${session.status} · ${commandLine}`,
    `root=${session.root.label} · cwd=${session.cwdRelativePath || '.'}`,
    session.endedAt
      ? `exit=${session.exitCode ?? session.signal ?? 'unknown'} · ${session.durationMs}ms`
      : `running=${session.durationMs}ms`,
    session.stdout ? `--- stdout ---\n${session.stdout}` : null,
    session.stderr ? `--- stderr ---\n${session.stderr}` : null
  ].filter(Boolean).join('\n');
}

function formatDesktopCommandSequence(result: DesktopLocalCommandSequenceResult) {
  const lines = [
    `root=${result.root.label} · steps=${result.steps.length} · duration=${result.durationMs}ms`,
    result.stoppedAtStep == null ? null : `stoppedAtStep=${result.stoppedAtStep + 1}`,
    result.continueOnError ? 'continueOnError=true' : null
  ].filter(Boolean);

  result.steps.forEach((step) => {
    const commandLine = `$ ${[step.command, ...step.args].join(' ')}`;
    lines.push(
      '',
      `${step.index + 1}. ${step.label ? `${step.label} · ` : ''}${commandLine}`,
      `cwd=${step.cwdRelativePath || '.'}`,
      `exit=${step.exitCode ?? step.signal ?? 0} · ${step.durationMs}ms`
    );
    if (step.stdout) lines.push(`--- stdout ---\n${step.stdout}`);
    if (step.stderr) lines.push(`--- stderr ---\n${step.stderr}`);
  });

  return lines.join('\n');
}

const DEFAULT_WAIT_SECONDS = 3;

function resolveWaitSeconds(seconds?: number) {
  return Number.isFinite(seconds) && seconds !== undefined && seconds > 0
    ? seconds
    : DEFAULT_WAIT_SECONDS;
}

function formatWaitSeconds(seconds: number) {
  return Number.isInteger(seconds)
    ? String(seconds)
    : seconds.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

async function executeUtilityToolAction(
  action: UtilityToolAction,
  ctx: ToolContext
): Promise<ToolExecutionResult> {
  const resolveDesktopRootId = async (rootId?: string) => {
    const host = ctx.desktopLocalHost;
    if (!host) {
      return { ok: false as const, error: '当前不是官网 Mac 桌面宿主，不能访问本机环境。' };
    }
    const state = await host.getState();
    if (!state.available) {
      return { ok: false as const, error: '当前本机环境不可用。' };
    }
    const requestedRootId = rootId?.trim();
    const root = requestedRootId
      ? state.trustedRoots.find((entry) => entry.id === requestedRootId) ?? null
      : state.trustedRoots[0] ?? null;
    if (!root) {
      return { ok: false as const, error: '还没有授权的本机工作区。请先在设置 → 本机环境里选择文件夹。' };
    }
    return { ok: true as const, host, state, root };
  };

  switch (action.kind) {
    case 'writeMemory': {
      const items = action.memory.map((item) => item.trim()).filter(Boolean);
      if (!items.length) {
        return { ok: false, error: '没有可写入的记忆内容。' };
      }
      if (!ctx.appendCollaboratorMemories(items)) {
        return { ok: false, error: '当前没有可写入记忆的协作者。' };
      }
      return { ok: true, memoryCount: items.length };
    }
    case 'writeMemoryDoc': {
      const title = action.title.trim();
      const content = action.content.trim();
      if (!title) {
        return { ok: false, error: '没有可写入的长期资料标题。' };
      }
      if (!content) {
        return { ok: false, error: '没有可写入的长期资料正文。' };
      }
      const result = ctx.writeCollaboratorMemoryDoc({
        docId: action.docId,
        title,
        summary: action.summary,
        content
      });
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      return {
        ok: true,
        summary: `${result.created ? '已写入长期资料' : '已更新长期资料'} · ${result.title}`,
        memoryDocId: result.docId,
        memoryDocTitle: result.title,
        memoryDocCreated: result.created
      };
    }
    case 'readMemoryDoc': {
      let doc = null;
      try {
        doc = await ctx.readCollaboratorMemoryDoc(action.docId);
      } catch {
        return {
          ok: false,
          error: `长期资料目录还在，但正文没有在当前本机数据里找到：${action.docId}`
        };
      }
      if (!doc) {
        return { ok: false, error: `没有找到长期资料：${action.docId}` };
      }
      const detailText = [
        `# ${doc.title}`,
        doc.summary.trim() ? `摘要：${doc.summary.trim()}` : '',
        doc.content.trim() || '（这份长期资料还没有正文。）'
      ].filter(Boolean).join('\n\n');
      return {
        ok: true,
        summary: `已读取长期资料 · ${doc.title}`,
        detailText
      };
    }
    case 'searchMemory': {
      if (!ctx.searchCollaboratorMemory) {
        return { ok: false, error: '当前没有可搜索记忆的协作者。' };
      }
      return ctx.searchCollaboratorMemory(action.query, action.mode, action.maxResults);
    }
    case 'openMemorySource': {
      if (!ctx.openMemorySource) {
        return { ok: false, error: '当前没有可读取的记忆原文。' };
      }
      return ctx.openMemorySource(action.sourceConversationId, action.sourceMessageIds, action.maxChars);
    }
    case 'readPolarisKnowledge':
      return ctx.readPolarisKnowledge(action.topic);
    case 'listEnvironmentNodes':
    case 'inspectEnvironmentNode':
    case 'searchEnvironmentNodes':
      if (!ctx.readEnvironmentDirectory) {
        return { ok: false, error: '当前环境目录不可用。' };
      }
      return ctx.readEnvironmentDirectory(action);
    case 'listCalendars':
      return ctx.listCalendars();
    case 'readCalendarEvents':
      return ctx.readCalendarEvents({
        startDate: action.startDate,
        endDate: action.endDate,
        query: action.query,
        maxEvents: action.maxEvents
      });
    case 'createCalendarEvent':
      return ctx.createCalendarEvent({
        title: action.title,
        startDate: action.startDate,
        endDate: action.endDate,
        allDay: action.allDay,
        location: action.location,
        notes: action.notes,
        calendarId: action.calendarId
      });
    case 'updateCalendarEvent':
      return ctx.updateCalendarEvent({
        eventId: action.eventId,
        title: action.title,
        startDate: action.startDate,
        endDate: action.endDate,
        allDay: action.allDay,
        location: action.location,
        notes: action.notes
      });
    case 'deleteCalendarEvent':
      return ctx.deleteCalendarEvent({
        eventId: action.eventId
      });
    case 'startTask':
      return {
        ok: true,
        summary: `任务已开启${action.title ? ` · ${action.title}` : action.capability ? ` · ${action.capability}` : ''}`
      };
    case 'completeTask':
      return {
        ok: true,
        summary: `任务已完成${action.stage ? ` · ${action.stage}` : ''}`
      };
    case 'wait': {
      const seconds = resolveWaitSeconds(action.seconds);
      await new Promise((resolve) => {
        globalThis.setTimeout(resolve, Math.round(seconds * 1000));
      });
      const formattedSeconds = formatWaitSeconds(seconds);
      return {
        ok: true,
        summary: `已等待 ${formattedSeconds} 秒${action.targetLabel ? ` · ${action.targetLabel}` : ''}`,
        detailText: [
          action.reason ? `等待原因：${action.reason}` : null,
          '等待已结束；请继续读取真实状态、检查结果，或给出自然收尾。'
        ].filter(Boolean).join('\n')
      };
    }
    case 'createProactiveMessageRule':
      return ctx.createProactiveMessageRule(action);
    case 'listProactiveMessageRules':
      return ctx.listProactiveMessageRules(action);
    case 'updateProactiveMessageRule':
      return ctx.updateProactiveMessageRule(action);
    case 'deleteProactiveMessageRule':
      return ctx.deleteProactiveMessageRule(action);
    case 'runCode': {
      const result = await ctx.runCode(action.code);
      const logText = result.logs
        .map((entry) => `[${entry.level}] ${entry.args.join(' ')}`)
        .join('\n');
      if (!result.ok) {
        const errorDetail = [
          result.error,
          result.stack ? `\n${result.stack}` : '',
          logText ? `\n--- console ---\n${logText}` : ''
        ].filter(Boolean).join('');
        return {
          ok: false,
          error: errorDetail
        };
      }
      const detailParts = [
        result.returnValue !== undefined ? `返回值：${result.returnValue}` : null,
        logText ? `--- console ---\n${logText}` : null
      ].filter(Boolean);
      return {
        ok: true,
        summary: '代码已执行',
        detailText: detailParts.join('\n\n') || '（无输出）'
      };
    }
    case 'listDesktopWorkspaces': {
      const host = ctx.desktopLocalHost;
      if (!host) {
        return { ok: false, error: '当前不是官网 Mac 桌面宿主，不能访问本机环境。' };
      }
      const state = await host.getState();
      const detailText = [
        `本机环境：${state.available ? '可用' : '不可用'} · ${state.platform} · ${state.permissionMode === 'trusted' ? '信任文件读写' : '每步确认'}`,
        state.trustedRoots.length
          ? state.trustedRoots.map((root, index) =>
              `${index + 1}. ${root.label} · rootId=${root.id}\n   path=${root.path}`
            ).join('\n')
          : '还没有授权的本机工作区。'
      ].join('\n');
      return {
        ok: true,
        summary: `已读取本机工作区 · ${state.trustedRoots.length} 个文件夹`,
        detailText
      };
    }
    case 'listDesktopFiles': {
      const resolved = await resolveDesktopRootId(action.rootId);
      if (!resolved.ok) return resolved;
      const listing = await resolved.host.listDirectory({
        rootId: resolved.root.id,
        relativePath: action.path
      });
      const detailText = [
        `rootId=${listing.root.id} · ${listing.root.label}`,
        `path=${listing.relativePath || '.'}`,
        listing.entries.length
          ? listing.entries.map((entry) => `${entry.kind === 'directory' ? 'dir ' : entry.kind === 'file' ? 'file' : 'other'}  ${entry.name}`).join('\n')
          : '（空目录）'
      ].join('\n');
      return {
        ok: true,
        summary: `已读取本机目录 · ${listing.root.label}/${listing.relativePath || '.'}`,
        detailText
      };
    }
    case 'readDesktopFile': {
      const resolved = await resolveDesktopRootId(action.rootId);
      if (!resolved.ok) return resolved;
      const file = await resolved.host.readFile({
        rootId: resolved.root.id,
        relativePath: action.filePath
      });
      return {
        ok: true,
        summary: `已读取本机文件 · ${file.root.label}/${file.relativePath}`,
        detailText: file.content
      };
    }
    case 'searchDesktopFiles': {
      const resolved = await resolveDesktopRootId(action.rootId);
      if (!resolved.ok) return resolved;
      const workspace = await resolved.host.readWorkspaceFiles({
        rootId: resolved.root.id
      });
      const files = workspace.files
        .filter((file) => pathMatchesDesktopPrefix(file.relativePath, action.path))
        .map(desktopFileSnapshotToResolved);
      const result = searchProjectFiles(files, {
        query: action.query,
        maxResults: action.maxResults
      });
      return {
        ok: true,
        summary: `已搜索本机文件 · ${result.totalMatches} 处命中`,
        detailText: formatProjectFileSearch(`desktop:${workspace.root.label}`, result)
      };
    }
    case 'readDesktopFileContext': {
      const resolved = await resolveDesktopRootId(action.rootId);
      if (!resolved.ok) return resolved;
      const file = await resolved.host.readFile({
        rootId: resolved.root.id,
        relativePath: action.filePath
      });
      const result = readProjectFileContext(desktopFileSnapshotToResolved({
        relativePath: file.relativePath,
        content: file.content,
        bytes: 0,
        updatedAt: 0
      }), {
        query: action.query,
        lineNumber: action.lineNumber,
        before: action.before,
        after: action.after,
        occurrence: action.occurrence
      });
      return {
        ok: true,
        summary: result.anchorLineNumber
          ? `已读取本机文件上下文 · ${file.root.label}/${file.relativePath}:${result.anchorLineNumber}`
          : `已读取本机文件上下文 · ${file.root.label}/${file.relativePath}`,
        detailText: formatProjectFileContext(result)
      };
    }
    case 'writeDesktopFile': {
      const resolved = await resolveDesktopRootId(action.rootId);
      if (!resolved.ok) return resolved;
      const result = await resolved.host.writeFile({
        rootId: resolved.root.id,
        relativePath: action.filePath,
        content: action.content
      });
      return {
        ok: true,
        summary: `已写入本机文件 · ${result.root.label}/${result.relativePath}`,
        detailText: `${result.bytes} bytes`
      };
    }
    case 'editDesktopFileText': {
      const resolved = await resolveDesktopRootId(action.rootId);
      if (!resolved.ok) return resolved;
      const file = await resolved.host.readFile({
        rootId: resolved.root.id,
        relativePath: action.filePath
      });
      const matchCount = countStringOccurrences(file.content, action.oldString);
      if (matchCount === 0) {
        return {
          ok: false,
          error: buildMissingSnippetError({
            label: '要替换的本机文件片段',
            snippet: action.oldString,
            filePath: file.relativePath,
            guidance: '请先用 readDesktopFile 读取目标附近正文，或改用更短、更稳定的原文片段；oldString 必须和当前真实文件完全一致，包括空格、换行和引号。'
          })
        };
      }
      if (matchCount > 1) {
        return {
          ok: false,
          error: buildAmbiguousSnippetError({
            content: file.content,
            snippet: action.oldString,
            count: matchCount,
            label: '要替换的本机文件片段',
            filePath: file.relativePath,
            guidance: '请提供更长的 oldString。'
          })
        };
      }
      const nextContent = file.content.replace(action.oldString, action.newString);
      const result = await resolved.host.writeFile({
        rootId: resolved.root.id,
        relativePath: file.relativePath,
        content: nextContent
      });
      return {
        ok: true,
        summary: `已局部替换本机文件 · ${result.root.label}/${result.relativePath}`,
        detailText: `replaced=1 · ${result.bytes} bytes`
      };
    }
    case 'replaceDesktopFileLines': {
      const resolved = await resolveDesktopRootId(action.rootId);
      if (!resolved.ok) return resolved;
      const file = await resolved.host.readFile({
        rootId: resolved.root.id,
        relativePath: action.filePath
      });
      const lineTarget = resolveProjectFileLineReplacement(
        file.content,
        action.startLine,
        action.endLine ?? action.startLine,
        action.code
      );
      if (!lineTarget) {
        return {
          ok: false,
          error: `没有找到要替换的本机文件行段 · ${file.relativePath}:${action.startLine}${action.endLine ? `-${action.endLine}` : ''}。请先用 readDesktopFileContext 读取目标行附近，再用返回的行号替换。`
        };
      }
      const result = await resolved.host.writeFile({
        rootId: resolved.root.id,
        relativePath: file.relativePath,
        content: lineTarget.content
      });
      return {
        ok: true,
        summary: `已按行替换本机文件 · ${result.root.label}/${result.relativePath}:${lineTarget.startLine}-${lineTarget.endLine}`,
        detailText: `lines=${lineTarget.startLine}-${lineTarget.endLine} · ${result.bytes} bytes`
      };
    }
    case 'createDesktopDirectory': {
      const resolved = await resolveDesktopRootId(action.rootId);
      if (!resolved.ok) return resolved;
      if (!resolved.host.createDirectory) {
        return { ok: false, error: '当前桌面宿主不支持创建本机文件夹。' };
      }
      const result = await resolved.host.createDirectory({
        rootId: resolved.root.id,
        relativePath: action.path
      });
      return {
        ok: true,
        summary: `已创建本机文件夹 · ${result.root.label}/${result.relativePath}`,
        detailText: `directory=${result.relativePath}`
      };
    }
    case 'deleteDesktopPath': {
      const resolved = await resolveDesktopRootId(action.rootId);
      if (!resolved.ok) return resolved;
      if (!resolved.host.deletePath) {
        return { ok: false, error: '当前桌面宿主不支持删除本机路径。' };
      }
      const result = await resolved.host.deletePath({
        rootId: resolved.root.id,
        relativePath: action.path
      });
      return {
        ok: true,
        summary: `已删除本机路径 · ${result.root.label}/${result.relativePath}`,
        detailText: `deleted=${result.relativePath} · kind=${result.kind}`
      };
    }
    case 'moveDesktopPath': {
      const resolved = await resolveDesktopRootId(action.rootId);
      if (!resolved.ok) return resolved;
      if (!resolved.host.movePath) {
        return { ok: false, error: '当前桌面宿主不支持移动本机路径。' };
      }
      const result = await resolved.host.movePath({
        rootId: resolved.root.id,
        fromRelativePath: action.fromPath,
        toRelativePath: action.toPath
      });
      return {
        ok: true,
        summary: `已移动本机路径 · ${result.root.label}/${result.toRelativePath}`,
        detailText: `${result.fromRelativePath} -> ${result.toRelativePath} · kind=${result.kind}`
      };
    }
    case 'runDesktopCommand': {
      const resolved = await resolveDesktopRootId(action.rootId);
      if (!resolved.ok) return resolved;
      const result = await resolved.host.runCommand({
        rootId: resolved.root.id,
        command: action.command,
        args: action.args,
        cwdRelativePath: action.cwdPath
      });
      const commandLine = `$ ${[result.command, ...result.args].join(' ')}`;
      const detailText = [
        commandLine,
        `cwd=${result.cwdRelativePath || '.'}`,
        `exit=${result.exitCode ?? result.signal ?? 0} · ${result.durationMs}ms`,
        result.stdout ? `--- stdout ---\n${result.stdout}` : null,
        result.stderr ? `--- stderr ---\n${result.stderr}` : null
      ].filter(Boolean).join('\n');
      if (result.exitCode === 0 && !result.signal) {
        return {
          ok: true,
          summary: `本机命令已完成 · ${commandLine}`,
          detailText
        };
      }
      return {
        ok: false,
        error: detailText
      };
    }
    case 'runDesktopCommandSequence': {
      const resolved = await resolveDesktopRootId(action.rootId);
      if (!resolved.ok) return resolved;
      if (!resolved.host.runCommandSequence) {
        return { ok: false, error: '当前桌面宿主不支持本机命令流程。' };
      }
      const result = await resolved.host.runCommandSequence({
        rootId: resolved.root.id,
        steps: action.steps.map((step) => ({
          label: step.label,
          command: step.command,
          args: step.args,
          cwdRelativePath: step.cwdPath
        })),
        continueOnError: action.continueOnError
      });
      const failedStep = result.steps.find((step) => step.exitCode !== 0 || step.signal);
      const detailText = formatDesktopCommandSequence(result);
      if (!failedStep) {
        return {
          ok: true,
          summary: `本机命令流程已完成 · ${result.steps.length} 步`,
          detailText
        };
      }
      return {
        ok: false,
        error: detailText
      };
    }
    case 'startDesktopCommand': {
      const resolved = await resolveDesktopRootId(action.rootId);
      if (!resolved.ok) return resolved;
      if (!resolved.host.startCommand) {
        return { ok: false, error: '当前桌面宿主不支持持久终端会话。' };
      }
      const session = await resolved.host.startCommand({
        rootId: resolved.root.id,
        command: action.command,
        args: action.args,
        cwdRelativePath: action.cwdPath
      });
      return {
        ok: true,
        summary: `本机终端会话已启动 · ${session.id}`,
        detailText: formatDesktopCommandSession(session)
      };
    }
    case 'listDesktopCommandSessions': {
      const host = ctx.desktopLocalHost;
      if (!host) {
        return { ok: false, error: '当前不是官网 Mac 桌面宿主，不能访问本机终端会话。' };
      }
      if (!host.listCommandSessions) {
        return { ok: false, error: '当前桌面宿主不支持持久终端会话。' };
      }
      const sessions = await host.listCommandSessions();
      return {
        ok: true,
        summary: sessions.length ? `找到 ${sessions.length} 个本机终端会话。` : '当前没有本机终端会话。',
        detailText: sessions.length ? sessions.map(formatDesktopCommandSession).join('\n\n') : '没有正在记录的终端会话。'
      };
    }
    case 'stopDesktopCommand': {
      const host = ctx.desktopLocalHost;
      if (!host) {
        return { ok: false, error: '当前不是官网 Mac 桌面宿主，不能访问本机终端会话。' };
      }
      if (!host.stopCommand) {
        return { ok: false, error: '当前桌面宿主不支持停止终端会话。' };
      }
      const session = await host.stopCommand({ sessionId: action.sessionId });
      return {
        ok: true,
        summary: `本机终端会话已停止 · ${session.id}`,
        detailText: formatDesktopCommandSession(session)
      };
    }
    case 'syncDesktopWorkspaceFromDisk': {
      if (!ctx.syncDesktopWorkspaceFromDisk) {
        return { ok: false, error: '当前环境不能同步桌面工作区。' };
      }
      return ctx.syncDesktopWorkspaceFromDisk({
        projectId: action.projectId,
        rootId: action.rootId,
        allowOverwrite: action.allowOverwrite
      });
    }
    case 'syncDesktopWorkspaceToDisk': {
      if (!ctx.syncDesktopWorkspaceToDisk) {
        return { ok: false, error: '当前环境不能同步桌面工作区。' };
      }
      return ctx.syncDesktopWorkspaceToDisk({
        projectId: action.projectId,
        rootId: action.rootId,
        allowOverwrite: action.allowOverwrite
      });
    }
  }
}

export const utilityToolExecutorPlugin: ToolExecutorPlugin = {
  name: 'utility',
  canHandle: isUtilityToolAction,
  execute: async (action, ctx) => {
    if (!isUtilityToolAction(action)) {
      return { ok: false, error: `通用工具无法执行：${action.kind}` };
    }
    return executeUtilityToolAction(action, ctx);
  }
};
