import { useEffect, useRef, useState } from 'react';
import {
  parseRegexTriggers,
  parseWorldBookRegexTriggers,
  DEFAULT_WORLD_BOOK_SCAN_DEPTH,
  type RegexTriggerRule
} from '../../../../engines/regexTriggerProcessor';
import { canUseNativeSystemFilePicker, pickNativeSystemFiles } from '../../../../native/systemPickedFiles';
import { Icon } from '../../../Icon';
import { resolveDocumentFilePickerAccept } from '../../../filePickerAccept';
import { type PersonaTabProps } from '../personaUiShared';
import { WorldBookEntryEditor } from './WorldBookEntryEditor';
import { usePersonaStore } from '../../../../stores/personaStore';

type RegexTriggerDraft = RegexTriggerRule & { id: number };

const WORLD_BOOK_IMPORT_ACCEPT = '.json,.txt,.md,application/json,text/plain,text/markdown,text/x-markdown';

function serializeRegexTriggers(rules: RegexTriggerDraft[]): string {
  const normalized = rules
    .map(({ pattern, prompt, flags, scanDepth, alwaysOn, priority }) => ({
      pattern: pattern.trim(),
      prompt: prompt.trim(),
      flags: flags?.trim() ?? '',
      scanDepth: Number(scanDepth),
      alwaysOn: Boolean(alwaysOn),
      priority: Number(priority)
    }))
    .filter((rule) => (rule.pattern.length > 0 || rule.alwaysOn) && rule.prompt.length > 0)
    .map((rule) => (
      {
        pattern: rule.pattern,
        prompt: rule.prompt,
        ...(rule.flags ? { flags: rule.flags } : {}),
        ...(Number.isFinite(rule.scanDepth) && rule.scanDepth > 0 ? { scanDepth: Math.floor(rule.scanDepth) } : {}),
        ...(rule.alwaysOn ? { alwaysOn: true } : {}),
        ...(Number.isFinite(rule.priority) && rule.priority !== 0 ? { priority: Math.trunc(rule.priority) } : {})
      }
    ));

  if (!normalized.length) return '';
  return JSON.stringify(normalized, null, 2);
}

function CompactRegexTrigger({
  rule,
  onEdit,
  onRemove
}: {
  rule: RegexTriggerDraft;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div role="button" tabIndex={0} className="ps-worldbook-entry" onClick={onEdit}
      onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onEdit(); } }}>
      <div className="ps-worldbook-entry-head">
        <span className={`ps-worldbook-badge ${rule.alwaysOn ? 'is-constant' : ''}`}>{rule.alwaysOn ? '常驻' : '关键词'}</span>
        <span>{rule.prompt.length.toLocaleString()} 字符</span>
        <button type="button" className="ps-rx-row-remove" onClick={(event) => { event.stopPropagation(); onRemove(); }} aria-label="删除世界书条目">×</button>
      </div>
      <p>{rule.prompt}</p>
      <div className="ps-worldbook-entry-foot">
        <span>{rule.alwaysOn ? '每轮生效' : `/${rule.pattern}/${rule.flags || ''} · 最近 ${rule.scanDepth ?? DEFAULT_WORLD_BOOK_SCAN_DEPTH} 条`}</span>
        <span>编辑 →</span>
      </div>
    </div>
  );
}

export function RegexTriggerRulesField({
  activeCollaboratorId,
  activePersona
}: PersonaTabProps) {
  const nextRegexTriggerIdRef = useRef(0);
  const editingPreviousRef = useRef('');
  const [regexTriggers, setRegexTriggers] = useState<RegexTriggerDraft[]>([]);
  const [editingTrigger, setEditingTrigger] = useState<RegexTriggerDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [importingWorldBook, setImportingWorldBook] = useState(false);
  const [worldBookImportMessage, setWorldBookImportMessage] = useState<string | null>(null);
  const [worldBookImportError, setWorldBookImportError] = useState<string | null>(null);
  const activeCollaboratorIdRef = useRef(activeCollaboratorId);
  activeCollaboratorIdRef.current = activeCollaboratorId;
  const worldBookFileInputRef = useRef<HTMLInputElement | null>(null);
  const worldBookImportAccept = resolveDocumentFilePickerAccept(WORLD_BOOK_IMPORT_ACCEPT);

  const createRegexTriggerDraft = (rule?: Partial<RegexTriggerRule>): RegexTriggerDraft => {
    const id = nextRegexTriggerIdRef.current;
    nextRegexTriggerIdRef.current += 1;
    return {
      id,
      pattern: rule?.pattern ?? '',
      prompt: rule?.prompt ?? '',
      flags: rule ? rule.flags ?? '' : 'i',
      scanDepth: rule?.scanDepth ?? DEFAULT_WORLD_BOOK_SCAN_DEPTH,
      alwaysOn: rule?.alwaysOn ?? false,
      priority: rule?.priority ?? 0
    };
  };

  useEffect(() => {
    nextRegexTriggerIdRef.current = 0;
    setRegexTriggers([]);
    setEditingTrigger(null);
    setWorldBookImportError(null);
  }, [activeCollaboratorId]);

  useEffect(() => {
    const rules = parseRegexTriggers(activePersona?.advanced.regexTriggers);
    setRegexTriggers((previous) => rules.map((rule, index) => ({
      ...createRegexTriggerDraft(rule), id: previous[index]?.id ?? nextRegexTriggerIdRef.current - 1
    })));
  }, [activeCollaboratorId, activePersona?.advanced.regexTriggers]);

  const persistRegexTriggers = async (nextRules: RegexTriggerDraft[]) => {
    if (!activeCollaboratorId) throw new Error('请先选择协作者。');
    await usePersonaStore.getState().saveWorldBookRules(activeCollaboratorId,
      parseRegexTriggers(serializeRegexTriggers(nextRules)),
      { expectedPrevious: editingTrigger ? editingPreviousRef.current : activePersona?.advanced.regexTriggers ?? '' });
  };

  const beginCreateRegexTrigger = (alwaysOn = false) => {
    if (saving) return;
    editingPreviousRef.current = activePersona?.advanced.regexTriggers ?? '';
    setWorldBookImportError(null);
    setEditingTrigger(createRegexTriggerDraft({ alwaysOn, flags: 'i' }));
  };

  const beginEditRegexTrigger = (ruleId: number) => {
    if (saving) return;
    const target = regexTriggers.find((rule) => rule.id === ruleId);
    if (!target) return;
    editingPreviousRef.current = activePersona?.advanced.regexTriggers ?? '';
    setWorldBookImportError(null);
    setEditingTrigger({ ...target });
  };

  const updateEditingTrigger = (patch: Partial<Omit<RegexTriggerDraft, 'id'>>) => {
    if (!editingTrigger) return;
    setEditingTrigger({ ...editingTrigger, ...patch });
  };

  const confirmEditingTrigger = async () => {
    if (saving) return;
    if (!editingTrigger || (!editingTrigger.pattern.trim() && !editingTrigger.alwaysOn) || !editingTrigger.prompt.trim()) return;
    if (!editingTrigger.alwaysOn) {
      try { new RegExp(editingTrigger.pattern.trim(), editingTrigger.flags?.trim()); } catch {
        setWorldBookImportError('匹配表达式或 Flags 无效，请修改后再保存。');
        return;
      }
    }
    setWorldBookImportError(null);
    const existingIndex = regexTriggers.findIndex((rule) => rule.id === editingTrigger.id);
    const normalizedRule = {
      ...editingTrigger,
      pattern: editingTrigger.alwaysOn ? '' : editingTrigger.pattern.trim(),
      prompt: editingTrigger.prompt.trim(),
      flags: editingTrigger.alwaysOn ? '' : editingTrigger.flags?.trim() ?? '',
      scanDepth: Math.max(1, Math.floor(Number(editingTrigger.scanDepth) || DEFAULT_WORLD_BOOK_SCAN_DEPTH)),
      priority: Math.trunc(Number(editingTrigger.priority) || 0)
    };

    const nextRules =
      existingIndex >= 0
        ? regexTriggers.map((rule) => (rule.id === editingTrigger.id ? normalizedRule : rule))
        : [...regexTriggers, normalizedRule];

    const targetId = activeCollaboratorId;
    setSaving(true);
    try {
      await persistRegexTriggers(nextRules);
      if (activeCollaboratorIdRef.current !== targetId) return;
      setEditingTrigger(null);
    } catch (error) {
      if (activeCollaboratorIdRef.current !== targetId) return;
      setWorldBookImportError(`未保存：${error instanceof Error ? error.message : '存储写入失败'}。正文已保留，可以重试或复制后退出。`);
    } finally { setSaving(false); }
  };

  const removeRegexTrigger = async (ruleId: number) => {
    if (saving) return;
    const targetId = activeCollaboratorId;
    setSaving(true);
    try {
      await persistRegexTriggers(regexTriggers.filter((rule) => rule.id !== ruleId));
      if (activeCollaboratorIdRef.current !== targetId) return;
      if (editingTrigger?.id === ruleId) setEditingTrigger(null);
      setWorldBookImportError(null);
    } catch (error) {
      if (activeCollaboratorIdRef.current !== targetId) return;
      setWorldBookImportError(`未删除：${error instanceof Error ? error.message : '存储写入失败'}。原条目已保留。`);
    } finally { setSaving(false); }
  };

  const importWorldBookFiles = async (files: FileList | File[] | null) => {
    const selectedFiles = files ? Array.from(files) : [];
    if (!selectedFiles.length || importingWorldBook) return;

    const targetCollaboratorId = activeCollaboratorId;
    setImportingWorldBook(true);
    setWorldBookImportMessage(null);
    setWorldBookImportError(null);
    try {
      const importedRules: RegexTriggerRule[] = [];
      const failedMessages: string[] = [];
      let skippedCount = 0;

      for (const file of selectedFiles) {
        try {
          const result = parseWorldBookRegexTriggers(await file.text());
          skippedCount += result.skippedCount;
          failedMessages.push(...result.warnings.map((message) => `${file.name || '未命名文件'}：${message}`));
          importedRules.push(...result.rules);
          if (result.rules.length === 0) {
            failedMessages.push(`${file.name || '未命名文件'} 没有可导入的世界书条目`);
          }
        } catch (error) {
          failedMessages.push(error instanceof Error ? error.message : `${file.name || '未命名文件'} 读取失败`);
        }
      }

      if (importedRules.length > 0) {
        if (!targetCollaboratorId) throw new Error('请先选择协作者。');
        await usePersonaStore.getState().saveWorldBookRules(targetCollaboratorId, importedRules, { append: true });
        if (activeCollaboratorIdRef.current !== targetCollaboratorId) return;
        setWorldBookImportMessage(`已导入 ${importedRules.length} 条世界书${skippedCount > 0 ? `；跳过 ${skippedCount} 条停用、无效或不支持的条目` : ''}`);
      }
      if (failedMessages.length > 0) {
        setWorldBookImportError(failedMessages.join('；'));
      }
    } catch (error) {
      if (activeCollaboratorIdRef.current === targetCollaboratorId) {
        setWorldBookImportError(`未导入：${error instanceof Error ? error.message : '存储写入失败'}。原世界书未覆盖，可以重新选择文件重试。`);
      }
    } finally {
      setImportingWorldBook(false);
      if (worldBookFileInputRef.current) {
        worldBookFileInputRef.current.value = '';
      }
    }
  };

  const openWorldBookImportPicker = async () => {
    if (importingWorldBook) return;
    if (canUseNativeSystemFilePicker()) {
      const files = await pickNativeSystemFiles({
        accept: WORLD_BOOK_IMPORT_ACCEPT,
        multiple: true
      });
      await importWorldBookFiles(files);
      return;
    }
    worldBookFileInputRef.current?.click();
  };

  return (
    <section className="ps-worldbook-page" aria-label="世界书条目">
      {editingTrigger ? <WorldBookEntryEditor key={editingTrigger.id} rule={editingTrigger} onChange={updateEditingTrigger}
        onConfirm={confirmEditingTrigger} onCancel={() => { setEditingTrigger(null); setWorldBookImportError(null); }}
        error={worldBookImportError} saving={saving}
        onRemove={regexTriggers.some((rule) => rule.id === editingTrigger.id) ? () => removeRegexTrigger(editingTrigger.id) : undefined} /> : null}
      <div className="ps-worldbook-toolbar">
        <button type="button" className="memory-doc-import-btn" onClick={() => beginCreateRegexTrigger(true)}>+ 常驻设定</button>
        <button type="button" className="ps-rx-add" onClick={() => beginCreateRegexTrigger()}>+ 关键词设定</button>
        <button type="button" className="ps-rx-add" onClick={() => { void openWorldBookImportPicker(); }} disabled={importingWorldBook}>
          <Icon name="filePlus" size={14} /> {importingWorldBook ? '导入中…' : '导入世界书'}
        </button>
        <input ref={worldBookFileInputRef} className="memory-doc-import-input" type="file" multiple accept={worldBookImportAccept}
          onChange={(event) => { void importWorldBookFiles(event.currentTarget.files); }} />
      </div>
      {worldBookImportMessage ? <div className="memory-doc-import-hint" role="status">{worldBookImportMessage}</div> : null}
      {worldBookImportError ? <div className="memory-doc-import-error" role="alert">{worldBookImportError}</div> : null}
      {regexTriggers.length ? <div className="ps-worldbook-library">
        {regexTriggers.map((rule) => <CompactRegexTrigger key={rule.id} rule={rule}
          onEdit={() => beginEditRegexTrigger(rule.id)} onRemove={() => removeRegexTrigger(rule.id)} />)}
      </div> : <div className="ps-worldbook-empty">
        <span>暂无条目</span>
        <button type="button" className="memory-doc-import-btn" onClick={() => beginCreateRegexTrigger(true)}>写第一条常驻设定</button>
      </div>}
    </section>
  );
}
