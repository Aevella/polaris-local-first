import { useEffect, useRef, useState } from 'react';
import { parseRegexRules, type RegexRule, type RegexRuleScope } from '../../../../engines/regexProcessor';
import { EditablePill } from '../EditablePill';
import { type PersonaTabProps } from '../personaUiShared';
import { RegexTriggerRulesField } from './RegexTriggerRulesField';

type RegexRuleDraft = RegexRule & { id: number };

const REGEX_SCOPE_OPTIONS: Array<{ value: RegexRuleScope; label: string }> = [
  { value: 'output', label: '输出' },
  { value: 'input', label: '输入' },
  { value: 'both', label: '双向' }
];

function serializeRegexRules(rules: RegexRuleDraft[]): string {
  const normalized = rules
    .map(({ scope, pattern, replacement, flags }) => ({
      scope,
      pattern: pattern.trim(),
      replacement,
      flags: flags?.trim() ?? ''
    }))
    .filter((rule) => rule.pattern.length > 0)
    .map((rule) => (
      rule.flags
        ? rule
        : {
            scope: rule.scope,
            pattern: rule.pattern,
            replacement: rule.replacement
          }
    ));

  if (!normalized.length) return '';
  return JSON.stringify(normalized, null, 2);
}

function CompactRegexRule({
  rule,
  active,
  onEdit,
  onRemove
}: {
  rule: RegexRuleDraft;
  active: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const scopeLabel = REGEX_SCOPE_OPTIONS.find((option) => option.value === rule.scope)?.label ?? '输出';

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
      <span className="ps-rx-scope">{scopeLabel}</span>
      <span className="ps-rx-arrow">→</span>
      <code className="ps-rx-pat">/{rule.pattern}/{rule.flags || ''}</code>
      <span className="ps-rx-arrow">→</span>
      <span className="ps-rx-rep">{rule.replacement}</span>
      <span className="ps-rx-row-spacer" />
      <button
        type="button"
        className="ps-rx-row-remove"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        aria-label="删除规则"
      >
        ×
      </button>
    </div>
  );
}

function RegexRuleEditor({
  rule,
  onChange,
  onConfirm,
  onRemove
}: {
  rule: RegexRuleDraft;
  onChange: (patch: Partial<Omit<RegexRuleDraft, 'id'>>) => void;
  onConfirm: () => void;
  onRemove?: () => void;
}) {
  const scopeLabel = REGEX_SCOPE_OPTIONS.find((option) => option.value === rule.scope)?.label ?? '输出';
  const canConfirm = rule.pattern.trim().length > 0;

  return (
    <div className="ps-rx-card ps-rx-card--active">
      <div className="ps-rx-card-head">
        <div className="ps-rx-card-preview">
          <span className="ps-rx-scope">{scopeLabel}</span>
          <code className="ps-rx-pat">/{rule.pattern || 'pattern'}/{rule.flags || ''}</code>
          <span className="ps-rx-arrow">→</span>
          <span className="ps-rx-rep">{rule.replacement || 'replacement'}</span>
        </div>
        <div className="ps-rx-card-actions">
          {onRemove ? (
            <button
              type="button"
              className="ps-rx-remove"
              onClick={onRemove}
              aria-label="删除规则"
            >
              ×
            </button>
          ) : null}
          <button
            type="button"
            className="ps-rx-confirm"
            onClick={onConfirm}
            disabled={!canConfirm}
            aria-label="确认规则"
          >
            ✓
          </button>
        </div>
      </div>

      <div className="ps-rx-grid">
        <label className="ps-rx-field">
          <span className="ps-rx-field-label">作用</span>
          <select
            className="ps-rx-select"
            value={rule.scope}
            onChange={(event) => onChange({ scope: event.target.value as RegexRuleScope })}
          >
            {REGEX_SCOPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="ps-rx-field ps-rx-field--wide">
          <span className="ps-rx-field-label">匹配</span>
          <input
            className="ps-rx-input ps-rx-input--mono"
            value={rule.pattern}
            onChange={(event) => onChange({ pattern: event.target.value })}
            placeholder="AI助手"
          />
        </label>

        <label className="ps-rx-field ps-rx-field--wide">
          <span className="ps-rx-field-label">替换成</span>
          <input
            className="ps-rx-input ps-rx-input--mono"
            value={rule.replacement}
            onChange={(event) => onChange({ replacement: event.target.value })}
            placeholder="Pharos"
          />
        </label>

        <label className="ps-rx-field">
          <span className="ps-rx-field-label">Flags</span>
          <input
            className="ps-rx-input ps-rx-input--mono"
            value={rule.flags ?? ''}
            onChange={(event) => onChange({ flags: event.target.value })}
            placeholder="g"
          />
        </label>
      </div>
    </div>
  );
}

export function SnippetsSettingsTab({
  activeCollaboratorId,
  activePersona,
  onUpdatePersona,
  visibleSections = 'all'
}: PersonaTabProps & {
  visibleSections?: 'all' | 'tone' | 'textRules' | 'worldBook';
}) {
  const snippets = activePersona?.advanced.snippets ?? [];
  const [draft, setDraft] = useState('');
  const nextRegexIdRef = useRef(0);
  const [regexRules, setRegexRules] = useState<RegexRuleDraft[]>([]);
  const [editingRule, setEditingRule] = useState<RegexRuleDraft | null>(null);

  const createRegexDraft = (rule?: Partial<RegexRule>): RegexRuleDraft => {
    const id = nextRegexIdRef.current;
    nextRegexIdRef.current += 1;
    return {
      id,
      scope: rule?.scope ?? 'output',
      pattern: rule?.pattern ?? '',
      replacement: rule?.replacement ?? '',
      flags: rule?.flags ?? 'g'
    };
  };

  useEffect(() => {
    nextRegexIdRef.current = 0;
    setRegexRules(parseRegexRules(activePersona?.advanced.regexRules).map((rule) => createRegexDraft(rule)));
    setEditingRule(null);
  }, [activeCollaboratorId]);

  const persistRegexRules = (nextRules: RegexRuleDraft[]) => {
    setRegexRules(nextRules);
    onUpdatePersona({ advanced: { regexRules: serializeRegexRules(nextRules) } });
  };

  const addSnippet = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onUpdatePersona({ advanced: { snippets: [...snippets, trimmed] } });
    setDraft('');
  };

  const removeSnippet = (i: number) => {
    const target = snippets[i]?.trim();
    if (!target) return;
    if (!window.confirm(`要删除这条语气偏好吗？\n\n“${target}”`)) return;
    onUpdatePersona({ advanced: { snippets: snippets.filter((_, idx) => idx !== i) } });
  };

  const editSnippet = (i: number, text: string) =>
    onUpdatePersona({ advanced: { snippets: snippets.map((snippet, idx) => (idx === i ? text : snippet)) } });

  const beginCreateRegexRule = () => {
    setEditingRule(createRegexDraft());
  };

  const beginEditRegexRule = (ruleId: number) => {
    const target = regexRules.find((rule) => rule.id === ruleId);
    if (!target) return;
    setEditingRule({ ...target });
  };

  const updateEditingRule = (patch: Partial<Omit<RegexRuleDraft, 'id'>>) => {
    if (!editingRule) return;
    setEditingRule({ ...editingRule, ...patch });
  };

  const confirmEditingRule = () => {
    if (!editingRule || !editingRule.pattern.trim()) return;
    const existingIndex = regexRules.findIndex((rule) => rule.id === editingRule.id);
    const normalizedRule = {
      ...editingRule,
      pattern: editingRule.pattern.trim(),
      flags: editingRule.flags?.trim() ?? ''
    };

    const nextRules =
      existingIndex >= 0
        ? regexRules.map((rule) => (rule.id === editingRule.id ? normalizedRule : rule))
        : [...regexRules, normalizedRule];

    persistRegexRules(nextRules);
    setEditingRule(null);
  };

  const removeRegexRule = (ruleId: number) => {
    const nextRules = regexRules.filter((rule) => rule.id !== ruleId);
    persistRegexRules(nextRules);
    if (editingRule?.id === ruleId) {
      setEditingRule(null);
    }
  };

  const showTone = visibleSections === 'all' || visibleSections === 'tone';
  const showTextRules = visibleSections === 'all' || visibleSections === 'textRules';
  const showWorldBook = visibleSections === 'all' || visibleSections === 'worldBook';

  return (
    <>
      {showTone ? (
      <div className="ps-field prompt-settings-field">
        <div className="ps-field-head">
          <span className="ps-field-label">语气偏好</span>
          <span className="ps-field-hint">{snippets.length} 条 · 自动编入提示词</span>
        </div>
        <div className="ps-sp-flow">
          {snippets.map((s, i) => (
            <EditablePill
              key={i}
              text={s}
              display="span"
              baseClassName="ps-sp"
              editingClassName="ps-sp--edit"
              inputClassName="ps-sp-input"
              removeButtonClassName="ps-sp-rm"
              removeLabel={`删除语气偏好 ${s}`}
              onRemove={() => removeSnippet(i)}
              onEdit={(value) => editSnippet(i, value)}
            />
          ))}
        </div>
        <div className="ps-mc-add">
          <input
            className="ps-mc-add-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="添加语气偏好…"
            onKeyDown={(event) => {
              if (event.key === 'Enter') addSnippet();
            }}
          />
          {draft.trim() && (
            <button
              type="button"
              className="ps-mc-add-btn"
              onClick={addSnippet}
              aria-label="添加语气偏好"
            >
              +
            </button>
          )}
        </div>
      </div>
      ) : null}

      {showTextRules ? (
      <div className="ps-field prompt-settings-field">
        <div className="ps-field-head">
          <span className="ps-field-label">文本替换规则</span>
          <span className="ps-field-hint">{regexRules.length} 条 · 对输入/输出做文本层自动修整</span>
        </div>

        <div className="ps-rx-list">
          {regexRules.map((rule) => (
            <CompactRegexRule
              key={rule.id}
              rule={rule}
              active={editingRule?.id === rule.id}
              onEdit={() => beginEditRegexRule(rule.id)}
              onRemove={() => removeRegexRule(rule.id)}
            />
          ))}
        </div>

        {editingRule ? (
          <RegexRuleEditor
            rule={editingRule}
            onChange={updateEditingRule}
            onConfirm={confirmEditingRule}
            onRemove={regexRules.some((rule) => rule.id === editingRule.id) ? () => removeRegexRule(editingRule.id) : undefined}
          />
        ) : null}

        <button type="button" className="ps-rx-add" onClick={beginCreateRegexRule}>
          + 添加规则
        </button>
      </div>
      ) : null}

      {showWorldBook ? (
        <RegexTriggerRulesField
          activeCollaboratorId={activeCollaboratorId}
          activePersona={activePersona}
          onUpdatePersona={onUpdatePersona}
        />
      ) : null}
    </>
  );
}
