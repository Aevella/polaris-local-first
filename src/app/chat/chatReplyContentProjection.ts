import type { AssistantToolAction } from '../../engines/assistantToolProtocol';
import type { AssistantNativeToolCall } from '../../engines/chatApi';
import { extractCodeBlocksFromMessage } from '../../engines/codeCardEngine';
import { normalizeReplySpacing } from '../../engines/replyText';
import { TOOL_DRAFT_BLOCK_PATTERN } from './chatMarkdownPatterns';
import {
  collectNativeToolCallToolDraftCode,
  collectNativeToolCallVisibleCode
} from './chatReplyContentNativeDrafts';

type ToolActionCodeItem = {
  language?: string;
  code: string;
};

type ToolActionCodeProjectionOptions = {
  excludeProjectFileWrites?: boolean;
};

function buildFence(language: string | undefined, code: string) {
  const label = (language ?? '').trim();
  return `\`\`\`${label}\n${code.trim()}\n\`\`\``;
}

function buildToolDraftBlock(code: string) {
  return `\`\`\`polaris-tools\n${code.trim()}\n\`\`\``;
}

function mergeCodeItemsIntoVisibleContent(content: string, codeItems: ToolActionCodeItem[]) {
  if (!codeItems.length) return normalizeReplySpacing(content);

  const nextContent = content;
  const existingCodes = new Set(extractCodeBlocksFromMessage(nextContent).map((block) => block.code.trim()));
  const missingFences = codeItems
    .filter((item) => !existingCodes.has(item.code))
    .map((item) => buildFence(item.language, item.code));

  return normalizeReplySpacing([nextContent.trim(), ...missingFences].filter(Boolean).join('\n\n'));
}

function mergeCodeItemsIntoToolDraftContent(content: string, codeItems: ToolActionCodeItem[]) {
  if (!codeItems.length) return normalizeReplySpacing(content);

  const draftBlocks = codeItems
    .filter((item) => item.code.trim())
    .map((item) => buildToolDraftBlock(item.code));

  return normalizeReplySpacing([content.trim(), ...draftBlocks].filter(Boolean).join('\n\n'));
}

function isProjectFileWriteAction(action: AssistantToolAction) {
  return (
    action.kind === 'createProjectFile'
    || action.kind === 'appendProjectFile'
    || action.kind === 'insertProjectFile'
    || action.kind === 'replaceProjectFileLines'
    || action.kind === 'writeProjectFiles'
    || action.kind === 'editProjectFileText'
  );
}

function collectToolActionCode(
  actions: AssistantToolAction[],
  options: ToolActionCodeProjectionOptions = {}
) {
  const items: ToolActionCodeItem[] = [];
  for (const action of actions) {
    if (options.excludeProjectFileWrites && isProjectFileWriteAction(action)) {
      continue;
    }
    if (action.kind === 'patchRawCss' || action.kind === 'appendThemeCss' || action.kind === 'insertThemeCss' || action.kind === 'replaceThemeCss') {
      const code = action.css.trim();
      if (code) {
        items.push({
          language: 'css',
          code
        });
      }
      continue;
    }
    if (action.kind === 'runCode') {
      const code = action.code.trim();
      if (code) {
        items.push({
          language: 'js',
          code
        });
      }
      continue;
    }
    if (action.kind === 'createCodeCard') {
      const code = action.card.code.trim();
      if (code) {
        items.push({
          language: action.card.language,
          code
        });
      }
      continue;
    }
    if (action.kind === 'createProjectFile') {
      const code = action.file.code?.trim();
      if (code) {
        items.push({
          language: action.file.language,
          code
        });
      }
      continue;
    }
    if (action.kind === 'patchCodeCard' && typeof action.patch.code === 'string') {
      const code = action.patch.code.trim();
      if (code) {
        items.push({
          language: action.patch.language,
          code
        });
      }
      continue;
    }
    if (action.kind === 'appendCodeCard' || action.kind === 'appendProjectFile' || action.kind === 'insertProjectFile' || action.kind === 'replaceProjectFileLines') {
      const code = action.code.trim();
      if (code) {
        items.push({
          code
        });
      }
      continue;
    }
    if (action.kind === 'writeProjectFiles') {
      action.files.forEach((file) => {
        const code = file.code.trim();
        if (code) {
          items.push({
            language: file.language,
            code
          });
        }
      });
      continue;
    }
    if (action.kind === 'editCodeCardText' || action.kind === 'editProjectFileText' || action.kind === 'editThemeCss') {
      const code = action.newString.trim();
      if (code) {
        items.push({
          code
        });
      }
      continue;
    }
    if (action.kind === 'deleteThemeCss') {
      const code = action.oldString.trim();
      if (code) {
        items.push({
          language: 'css',
          code
        });
      }
    }
  }
  return items;
}

export function mergeToolActionCodeIntoVisibleContent(
  content: string,
  actions: AssistantToolAction[],
  options: ToolActionCodeProjectionOptions = {}
) {
  return mergeCodeItemsIntoVisibleContent(content, collectToolActionCode(actions, options));
}

export function stripToolDraftBlocks(content: string) {
  return content
    .replace(TOOL_DRAFT_BLOCK_PATTERN, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractJsonStringFieldFromDraftBlock(block: string, fieldName: string) {
  const fieldMatch = new RegExp(`"${fieldName}"\\s*:\\s*"`).exec(block);
  if (!fieldMatch) return null;
  let value = '';
  let escaped = false;
  for (let i = fieldMatch.index + fieldMatch[0].length; i < block.length; i += 1) {
    const ch = block[i];
    if (escaped) {
      if (ch === 'n') value += '\n';
      else if (ch === 'r') value += '\r';
      else if (ch === 't') value += '\t';
      else if (ch === '"') value += '"';
      else if (ch === '\\') value += '\\';
      else value += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') break;
    value += ch;
  }

  return value.trim() || null;
}

function extractCodeFieldFromDraftBlock(block: string): ToolActionCodeItem | null {
  const code = extractJsonStringFieldFromDraftBlock(block, 'code');
  if (!code) return null;

  const langMatch = /"language"\s*:\s*"([^"]*)"/.exec(block);
  const kindMatch = /"kind"\s*:\s*"([^"]*)"/.exec(block);
  const language = langMatch?.[1]
    || (kindMatch?.[1] === 'runCode' ? 'js' : undefined)
    || (kindMatch?.[1] === 'patchRawCss' ? 'css' : undefined);

  return { language, code };
}

function extractCssFieldFromDraftBlock(block: string): ToolActionCodeItem | null {
  if (!/"kind"\s*:\s*"(patchRawCss|appendThemeCss|insertThemeCss|replaceThemeCss)"/.test(block)) return null;

  const css = extractJsonStringFieldFromDraftBlock(block, 'css');
  return css ? { language: 'css', code: css } : null;
}

function extractNewStringFieldFromDraftBlock(block: string): ToolActionCodeItem | null {
  if (!/"kind"\s*:\s*"(editCodeCardText|editProjectFileText|editThemeCss)"/.test(block)) return null;

  const newString = extractJsonStringFieldFromDraftBlock(block, 'newString');
  const filePathMatch = /"filePath"\s*:\s*"([^"]*)"/.exec(block);
  const filePath = filePathMatch?.[1]?.trim().toLowerCase() ?? '';
  const language =
    /"kind"\s*:\s*"editThemeCss"/.test(block)
      ? 'css'
      : filePath.endsWith('.html')
        ? 'html'
        : filePath.endsWith('.css')
          ? 'css'
          : filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')
            ? 'js'
            : filePath.endsWith('.ts') || filePath.endsWith('.tsx')
              ? 'ts'
              : undefined;
  return newString ? { language, code: newString } : null;
}

export function projectToolDraftBlocksAsCode(content: string) {
  const items: ToolActionCodeItem[] = [];
  const pattern = /```polaris[-_]tools\s*([\s\S]*?)(?:```|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const block = match[1];
    const codeItem =
      extractCodeFieldFromDraftBlock(block)
      ?? extractCssFieldFromDraftBlock(block)
      ?? extractNewStringFieldFromDraftBlock(block);
    if (codeItem) items.push(codeItem);
  }

  const stripped = stripToolDraftBlocks(content);
  return mergeCodeItemsIntoVisibleContent(stripped, items);
}

export function buildToolOnlyFallback(actions: AssistantToolAction[]) {
  const kinds = new Set(actions.map((action) => action.kind));
  const hasThemeAction = [...kinds].some((kind) =>
    kind === 'applyThemeCoordinates' ||
    kind === 'applySurfaceTokens' ||
    kind === 'patchRawCss' ||
    kind === 'readThemeCss' ||
    kind === 'editThemeCss' ||
    kind === 'appendThemeCss' ||
    kind === 'insertThemeCss' ||
    kind === 'deleteThemeCss' ||
    kind === 'replaceThemeCss' ||
    kind === 'inspectThemeRender' ||
    kind === 'applyPreset'
  );

  if (hasThemeAction) {
    return '';
  }
  if (
    kinds.has('webSearch')
    || kinds.has('readWebPage')
    || kinds.has('listCalendars')
    || kinds.has('readCalendarEvents')
    || kinds.has('createCalendarEvent')
    || kinds.has('updateCalendarEvent')
    || kinds.has('deleteCalendarEvent')
  ) {
    return '';
  }
  if (
    kinds.has('inspectAttachments') ||
    kinds.has('readAttachmentText') ||
    kinds.has('inspectArchiveEntries') ||
    kinds.has('readArchiveEntryText')
  ) {
    return '';
  }
  if (kinds.has('createQrCode') || kinds.has('generateImage') || kinds.has('sendImageAttachment')) {
    return '';
  }
  if (
    kinds.has('createCodeCard') ||
    kinds.has('createProjectFile') ||
    kinds.has('patchCodeCard') ||
    kinds.has('appendCodeCard') ||
    kinds.has('appendProjectFile') ||
    kinds.has('insertProjectFile') ||
    kinds.has('replaceProjectFileLines') ||
    kinds.has('writeProjectFiles') ||
    kinds.has('listProjectFiles') ||
    kinds.has('searchProjectFiles') ||
    kinds.has('checkProjectPreview') ||
    kinds.has('inspectProjectRuntime') ||
    kinds.has('editCodeCardText') ||
    kinds.has('editProjectFileText') ||
    kinds.has('deleteProjectFile') ||
    kinds.has('readCodeCard') ||
    kinds.has('readProjectFile') ||
    kinds.has('readProjectFileContext') ||
    kinds.has('saveAttachmentAsCodeCard') ||
    kinds.has('saveArchiveEntryAsCodeCard')
  ) {
    return '';
  }
  return '';
}

export function mergeNativeToolCallDraftCodeIntoVisibleContent(content: string, nativeToolCalls: AssistantNativeToolCall[]) {
  const visibleCodeItems = collectNativeToolCallVisibleCode(nativeToolCalls);
  const toolDraftItems = collectNativeToolCallToolDraftCode(nativeToolCalls);
  const withVisibleCode = mergeCodeItemsIntoVisibleContent(content, visibleCodeItems);
  return mergeCodeItemsIntoToolDraftContent(withVisibleCode, toolDraftItems);
}
