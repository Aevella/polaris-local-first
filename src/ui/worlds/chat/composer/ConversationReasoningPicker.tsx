import { CONVERSATION_REASONING_STRENGTHS } from '../../../../engines/conversationReasoning';
import type { ConversationReasoningStrength } from '../../../../types/domain';
import { Icon } from '../../../Icon';
import { runSelectionAction } from '../../../haptics';
import { useI18n } from '../../../../i18n';

type ConversationReasoningPickerProps = {
  value: ConversationReasoningStrength;
  onChange: (value: ConversationReasoningStrength) => void;
  onBack: () => void;
};

const LABEL_KEYS = {
  off: 'chat.reasoning.off',
  automatic: 'chat.reasoning.automatic',
  light: 'chat.reasoning.light',
  medium: 'chat.reasoning.medium',
  high: 'chat.reasoning.high',
  extreme: 'chat.reasoning.extreme'
} as const;

const DETAIL_KEYS = {
  off: 'chat.reasoning.offDetail',
  automatic: 'chat.reasoning.automaticDetail',
  light: 'chat.reasoning.lightDetail',
  medium: 'chat.reasoning.mediumDetail',
  high: 'chat.reasoning.highDetail',
  extreme: 'chat.reasoning.extremeDetail'
} as const;

export function ConversationReasoningPicker({
  value,
  onChange,
  onBack
}: ConversationReasoningPickerProps) {
  const { t } = useI18n();

  return (
    <div className="conversation-reasoning-picker">
      <div className="attachment-picker-card-head">
        <div className="conversation-reasoning-picker-heading">
          <strong>{t('chat.reasoning.title')}</strong>
          <span>{t('chat.reasoning.routeHint')}</span>
        </div>
        <button
          type="button"
          className="attachment-picker-card-back"
          onClick={(event) => runSelectionAction(onBack, { element: event.currentTarget })}
        >
          {t('chat.composer.back')}
        </button>
      </div>
      <div className="conversation-reasoning-options" role="radiogroup" aria-label={t('chat.reasoning.title')}>
        {CONVERSATION_REASONING_STRENGTHS.map((strength) => {
          const selected = strength === value;
          return (
            <button
              key={strength}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`conversation-reasoning-option ${selected ? 'selected' : ''}`}
              onClick={(event) => runSelectionAction(() => onChange(strength), { element: event.currentTarget })}
            >
              <span className={`conversation-reasoning-mark strength-${strength}`} aria-hidden="true">
                <Icon name={strength === 'off' ? 'pause' : 'orbit'} size={16} />
              </span>
              <span className="conversation-reasoning-copy">
                <strong>{t(LABEL_KEYS[strength])}</strong>
                <span>{t(DETAIL_KEYS[strength])}</span>
              </span>
              {selected ? <Icon name="check" size={14} /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
