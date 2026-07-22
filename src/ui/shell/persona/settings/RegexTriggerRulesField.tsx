import { useEffect, useRef, useState } from 'react';
import {
  parseRegexTriggers,
  parseWorldBookRegexTriggers,
  type RegexTriggerRule
} from '../../../../engines/regexTriggerProcessor';
import { canUseNativeSystemFilePicker, pickNativeSystemFiles } from '../../../../native/systemPickedFiles';
import { Icon } from '../../../Icon';
import { resolveDocumentFilePickerAccept } from '../../../filePickerAccept';
import { type PersonaTabProps } from '../personaUiShared';

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
    .map((rule) => ({
      pattern: rule.pattern,
      prompt: rule.prompt,
      ...(rule.flags ? { flags: rule.flags } : {}),
      ...(Number.isFinite(rule.scanDepth) && rule.scanDepth > 0 ? { scanDepth: Math.floor(rule.scanDepth) } : {}),
      ...(rule.alwaysOn ? { alwaysOn: true } : {}),
      ...(Number.isFinite(rule.priority) && rule.priority !== 0 ? { priority: Math.trunc(rule.priority) } : {})
    }));

  if (!normalized.length) return '';
  return JSON.stringify(normalized, null, 2);
}

function CompactRegexTrigger({
  rule,
  active,
  onEdit,
  onRemove
}: {
  rule: RegexTriggerDraft;
  active: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`ps-rx-row ${active ? 'ps-rx-row--active' : ''}`}
      onClick={onEdit}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onEdit();
        }
      }}
    >
      <span className="ps-rx-scope">{rule.alwaysOn ? '常驻' : '触发'}</span>
      <span className="ps-rx-arrow">→</span>
      <code className="ps-rx-pat">{rule.alwaysOn ? 'always' : `/${rule.pattern}/${rule.flags || ''}`}</code>
      <span className="ps-rx-arrow">→</span>
      <span className="ps-rx-rep">{rule.prompt}</span>
      <span className="ps-rx-scope">深度 {rule.scanDepth ?? 4}</span>
      <span className="ps-rx-row-spacer" />
      <button
        type="button"
        className="ps-rx-row-remove"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        aria-label="删除正则触发"
      >
        ×
      </button>
    </div>
  );
}

function RegexTriggerEditor({
  rule,
  onChange,
  onConfirm,
  onRemove
}: {
  rule: RegexTriggerDraft;
  onChange: (patch: Partial<Omit<RegexTriggerDraft, 'id'>>) => void;
  onConfirm: () => void;
  onRemove?: () => void;
}) {
  const canConfirm = (rule.pattern.trim().length > 0 || Boolean(rule.alwaysOn)) && rule.prompt.trim().length > 0;

  return (
    <div className="ps-rx-card ps-rx-card--active">
      <div className="ps-rx-card-head">
        <div className="ps-rx-card-preview">
          <span className="ps-rx-scope">{rule.alwaysOn ? '常驻' : '触发'}</span>
          <code className="ps-rx-pat">{rule.alwaysOn ? 'always' : `/${rule.pattern || 'pattern'}/${rule.flags || ''}`}</code>
          <span className="ps-rx-arrow">→</span>
          <span className="ps-rx-rep">{rule.prompt || '补充给模型的上下文'}</span>
        </div>
        <div className="ps-rx-card-actions">
          {onRemove ? (
            <button
              type="button"
              className="ps-rx-remove"
              onClick={onRemove}
              aria-label="删除正则触发"
            >
              ×
            </button>
          ) : null}
          <button
            type="button"
            className="ps-rx-confirm"
            onClick={onConfirm}
            disabled={!canConfirm}
            aria-label="确认正则触发"
          >
            ✓
          </button>
        </div>
      </div>

      <div className="ps-rx-grid ps-rx-grid--trigger">
        <label className="ps-rx-field ps-rx-field--wide">
          <span className="ps-rx-field-label">匹配</span>
          <input
            className="ps-rx-input ps-rx-input--mono"
            value={rule.pattern}
            onChange={(event) => onChange({ pattern: event.target.value })}
            disabled={Boolean(rule.alwaysOn)}
            placeholder="角色名|地点名|章节关键词"
          />
        </label>

        <label className="ps-rx-field ps-rx-field--wide">
          <span className="ps-rx-field-label">触发后补充</span>
          <input
            className="ps-rx-input"
            value={rule.prompt}
            onChange={(event) => onChange({ prompt: event.target.value })}
            placeholder="命中后把这段设定或提醒带给模型"
          />
        </label>

        <label className="ps-rx-field">
          <span className="ps-rx-field-label">Flags</span>
          <input
            className="ps-rx-input ps-rx-input--mono"
            value={rule.flags ?? ''}
            onChange={(event) => onChange({ flags: event.target.value })}
            disabled={Boolean(rule.alwaysOn)}
            placeholder="i"
          />
        </label>

        <label className="ps-rx-field">
          <span className="ps-rx-field-label">扫描深度</span>
          <input
            className="ps-rx-input ps-rx-input--mono"
            type="number"
            min={1}
            value={rule.scanDepth ?? 4}
            onChange={(event) => onChange({ scanDepth: Number(event.target.value) || 1 })}
          />
        </label>

        <label className="ps-rx-field">
          <span className="ps-rx-field-label">优先级</span>
          <input
            className="ps-rx-input ps-rx-input--mono"
            type="number"
            value={rule.priority ?? 0}
            onChange={(event) => onChange({ priority: Number(event.target.value) || 0 })}
          />
        </label>

        <label className="ps-rx-field ps-rx-field--toggle">
          <span className="ps-rx-field-label">常驻</span>
          <input
            className="ps-rx-toggle"
            type="checkbox"
            checked={Boolean(rule.alwaysOn)}
            onChange={(event) => onChange({ alwaysOn: event.target.checked })}
          />
        </label>
      </div>
    </div>
  );
}

export function RegexTriggerRulesField({
  activeCollaboratorId,
  activePersona,
  onUpdatePersona
}: PersonaTabProps) {
  const nextRegexTriggerIdRef = useRef(0);
  const [regexTriggers, setRegexTriggers] = useState<RegexTriggerDraft[]>([]);
  const [editingTrigger, setEditingTrigger] = useState<RegexTriggerDraft | null>(null);
  const [importingWorldBook, setImportingWorldBook] = useState(false);
  const [worldBookImportMessage, setWorldBookImportMessage] = useState<string | null>(null);
  const [worldBookImportError, setWorldBookImportError] = useState<string | null>(null);
  const worldBookFileInputRef = useRef<HTMLInputElement | null>(null);
  const worldBookImportAccept = resolveDocumentFilePickerAccept(WORLD_BOOK_IMPORT_ACCEPT);

  const createRegexTriggerDraft = (rule?: Partial<RegexTriggerRule>): RegexTriggerDraft => {
    const id = nextRegexTriggerIdRef.current;
    nextRegexTriggerIdRef.current += 1;
    return {
      id,
      pattern: rule?.pattern ?? '',
      prompt: rule?.prompt ?? '',
      flags: rule?.flags ?? 'i',
      scanDepth: rule?.scanDepth ?? 4,
      alwaysOn: rule?.alwaysOn ?? false,
      priority: rule?.priority ?? 0
    };
  };

  useEffect(() => {
    nextRegexTriggerIdRef.current = 0;
    setRegexTriggers(parseRegexTriggers(activePersona?.advanced.regexTriggers).map((rule) => createRegexTriggerDraft(rule)));
    setEditingTrigger(null);
  }, [activeCollaboratorId]);

  const persistRegexTriggers = (nextRules: RegexTriggerDraft[]) => {
    setRegexTriggers(nextRules);
    onUpdatePersona({ advanced: { regexTriggers: serializeRegexTriggers(nextRules) } });
  };

  const beginCreateRegexTrigger = () => {
    setEditingTrigger(createRegexTriggerDraft());
  };

  const beginEditRegexTrigger = (ruleId: number) => {
    const target = regexTriggers.find((rule) => rule.id === ruleId);
    if (!target) return;
    setEditingTrigger({ ...target });
  };

  const updateEditingTrigger = (patch: Partial<Omit<RegexTriggerDraft, 'id'>>) => {
    if (!editingTrigger) return;
    setEditingTrigger({ ...editingTrigger, ...patch });
  };

  const confirmEditingTrigger = () => {
    if (!editingTrigger || (!editingTrigger.pattern.trim() && !editingTrigger.alwaysOn) || !editingTrigger.prompt.trim()) return;
    const existingIndex = regexTriggers.findIndex((rule) => rule.id === editingTrigger.id);
    const normalizedRule = {
      ...editingTrigger,
      pattern: editingTrigger.alwaysOn ? '' : editingTrigger.pattern.trim(),
      prompt: editingTrigger.prompt.trim(),
      flags: editingTrigger.alwaysOn ? '' : editingTrigger.flags?.trim() ?? '',
      scanDepth: Math.max(1, Math.floor(Number(editingTrigger.scanDepth) || 4)),
      priority: Math.trunc(Number(editingTrigger.priority) || 0)
    };

    const nextRules =
      existingIndex >= 0
        ? regexTriggers.map((rule) => (rule.id === editingTrigger.id ? normalizedRule : rule))
        : [...regexTriggers, normalizedRule];

    persistRegexTriggers(nextRules);
    setEditingTrigger(null);
  };

  const removeRegexTrigger = (ruleId: number) => {
    const nextRules = regexTriggers.filter((rule) => rule.id !== ruleId);
    persistRegexTriggers(nextRules);
    if (editingTrigger?.id === ruleId) {
      setEditingTrigger(null);
    }
  };

  const importWorldBookFiles = async (files: FileList | File[] | null) => {
    const selectedFiles = files ? Array.from(files) : [];
    if (!selectedFiles.length || importingWorldBook) return;

    setImportingWorldBook(true);
    setWorldBookImportMessage(null);
    setWorldBookImportError(null);
    try {
      const importedRules: RegexTriggerDraft[] = [];
      const failedMessages: string[] = [];

      for (const file of selectedFiles) {
        try {
          const result = parseWorldBookRegexTriggers(await file.text());
          importedRules.push(...result.rules.map((rule) => createRegexTriggerDraft(rule)));
          if (result.rules.length === 0) {
            failedMessages.push(`${file.name || '未命名文件'} 没有可导入的世界书条目`);
          }
        } catch (error) {
          failedMessages.push(error instanceof Error ? error.message : `${file.name || '未命名文件'} 读取失败`);
        }
      }

      if (importedRules.length > 0) {
        persistRegexTriggers([...regexTriggers, ...importedRules]);
        setEditingTrigger(null);
        setWorldBookImportMessage(`已导入 ${importedRules.length} 条世界书`);
      }
      if (failedMessages.length > 0) {
        setWorldBookImportError(failedMessages.join('；'));
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
    <div className="ps-field">
      <div className="ps-field-head ps-field-head--meta-right">
        <span className="ps-field-label">世界书触发</span>
        <span className="ps-field-hint">{regexTriggers.length} 条 · 命中后补充本轮上下文</span>
      </div>

      <div className="memory-doc-import-row">
        <button
          type="button"
          className="memory-doc-import-btn"
          onClick={() => {
            void openWorldBookImportPicker();
          }}
          disabled={importingWorldBook}
        >
          <Icon name="filePlus" size={14} />
          <span>{importingWorldBook ? '导入中…' : '导入世界书'}</span>
        </button>
        <span className="memory-doc-import-hint">支持 Kelivo/RikkaHub 风格 JSON 或文本；关键词会变成匹配，正文会变成命中后补充。</span>
        <input
          ref={worldBookFileInputRef}
          className="memory-doc-import-input"
          type="file"
          multiple
          accept={worldBookImportAccept}
          onChange={(event) => {
            void importWorldBookFiles(event.currentTarget.files);
          }}
        />
      </div>
      {worldBookImportMessage ? (
        <div className="memory-doc-import-hint">{worldBookImportMessage}</div>
      ) : null}
      {worldBookImportError ? (
        <div className="memory-doc-import-error">{worldBookImportError}</div>
      ) : null}

      <div className="ps-rx-list">
        {regexTriggers.map((rule) => (
          <CompactRegexTrigger
            key={rule.id}
            rule={rule}
            active={editingTrigger?.id === rule.id}
            onEdit={() => beginEditRegexTrigger(rule.id)}
            onRemove={() => removeRegexTrigger(rule.id)}
          />
        ))}
      </div>

      {editingTrigger ? (
        <RegexTriggerEditor
          rule={editingTrigger}
          onChange={updateEditingTrigger}
          onConfirm={confirmEditingTrigger}
          onRemove={regexTriggers.some((rule) => rule.id === editingTrigger.id) ? () => removeRegexTrigger(editingTrigger.id) : undefined}
        />
      ) : null}

      <button type="button" className="ps-rx-add" onClick={beginCreateRegexTrigger}>
        + 添加触发
      </button>
    </div>
  );
}
