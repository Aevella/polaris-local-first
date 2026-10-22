import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_WORLD_BOOK_SCAN_DEPTH, type RegexTriggerRule } from '../../../../engines/regexTriggerProcessor';

export function WorldBookEntryEditor({ rule, onChange, onConfirm, onCancel, onRemove, error, saving = false }: {
  rule: RegexTriggerRule;
  onChange: (patch: Partial<RegexTriggerRule>) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onRemove?: () => void;
  error?: string | null;
  saving?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    dialog.focus({ preventScroll: true });
    return () => dialog.close();
  }, []);
  const canConfirm = (rule.pattern.trim().length > 0 || Boolean(rule.alwaysOn)) && rule.prompt.trim().length > 0;
  return createPortal(
    <dialog ref={dialogRef} tabIndex={-1} className="ps-worldbook-drawer" aria-label="世界书条目编辑" onCancel={(event) => { event.preventDefault(); onCancel(); }} onKeyDown={(event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault();
        if (canConfirm && !saving) onConfirm();
      }
    }}>
      <header className="ps-worldbook-editor-head">
        <button type="button" className="ps-worldbook-back" onClick={onCancel}>取消</button>
        <button type="button" className="memory-doc-import-btn" onClick={onConfirm} disabled={!canConfirm || saving}>{saving ? '保存中…' : '保存条目'}</button>
      </header>
      <div className="ps-worldbook-drawer-body">
        <fieldset className="ps-worldbook-inputs" disabled={saving}>
        {error ? <div role="alert" className="memory-doc-import-error">{error}</div> : null}
        <div className="ps-worldbook-modes" aria-label="条目生效方式">
          <button type="button" aria-pressed={Boolean(rule.alwaysOn)} onClick={() => onChange({ alwaysOn: true })}>常驻</button>
          <button type="button" aria-pressed={!rule.alwaysOn} onClick={() => onChange({ alwaysOn: false })}>关键词触发</button>
        </div>
        <label className="ps-worldbook-body-field">
          <span>设定正文 <small>{rule.prompt.length.toLocaleString()} 字符</small></span>
          <textarea className="ps-rx-input ps-worldbook-body" rows={20} value={rule.prompt}
            onChange={(event) => onChange({ prompt: event.target.value })}
            placeholder="输入设定正文" />
        </label>
        {!rule.alwaysOn ? (
          <div className="ps-worldbook-conditions">
            <label className="ps-rx-field"><span className="ps-rx-field-label">关键词或正则</span>
              <input className="ps-rx-input ps-rx-input--mono" value={rule.pattern}
                onChange={(event) => onChange({ pattern: event.target.value })} placeholder="角色名|地点名|章节关键词" />
            </label>
            <label className="ps-rx-field"><span className="ps-rx-field-label">扫描最近几条消息</span>
              <input className="ps-rx-input" type="number" min={1} value={rule.scanDepth ?? DEFAULT_WORLD_BOOK_SCAN_DEPTH}
                onChange={(event) => onChange({ scanDepth: Number(event.target.value) || 1 })} />
            </label>
            <label className="ps-rx-field"><span className="ps-rx-field-label">正则 Flags</span>
              <input className="ps-rx-input ps-rx-input--mono" value={rule.flags ?? ''}
                onChange={(event) => onChange({ flags: event.target.value })} placeholder="i：忽略大小写" />
            </label>
          </div>
        ) : null}
        <details className="ps-worldbook-options"><summary>条目顺序与管理</summary>
          <label className="ps-rx-field"><span className="ps-rx-field-label">优先级 · 数值越大越靠前</span>
            <input className="ps-rx-input" type="number" value={rule.priority ?? 0}
              onChange={(event) => onChange({ priority: Number(event.target.value) || 0 })} />
          </label>
          {onRemove ? <button type="button" className="ps-worldbook-delete" onClick={onRemove}>删除此条目</button> : null}
        </details>
        </fieldset>
      </div>
    </dialog>,
    document.body
  );
}
