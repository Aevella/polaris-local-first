import type { ChatMemoryEvidence, ChatMemoryEvidenceChunkKind, ChatMemoryEvidenceItemKind } from '../../../../types/domain';
import { useI18n, type I18nTranslator } from '../../../../i18n';
import { Icon } from '../../../Icon';

type MessageMemoryEvidenceProps = {
  evidence: ChatMemoryEvidence;
  expanded: boolean;
  onToggle: () => void;
  showTrigger?: boolean;
  copy?: I18nTranslator;
};

type EvidenceTone = 'vector' | 'text' | 'tail' | 'voice';
type Translate = I18nTranslator['t'];
type FormatNumber = I18nTranslator['formatNumber'];

function formatEvidenceKind(kind: ChatMemoryEvidenceItemKind, t: Translate) {
  if (kind === 'recent_tail') return t('memory.evidence.kindRecentTail');
  if (kind === 'vector_match') return t('memory.evidence.kindVectorMatch');
  if (kind === 'voice_anchor') return t('memory.evidence.kindVoiceAnchor');
  return t('memory.evidence.kindMatchedContext');
}

function evidenceTone(kind: ChatMemoryEvidenceItemKind): EvidenceTone {
  if (kind === 'vector_match') return 'vector';
  if (kind === 'matched_context') return 'text';
  if (kind === 'voice_anchor') return 'voice';
  return 'tail';
}

function triggerKind(evidence: ChatMemoryEvidence) {
  const hasVector = evidence.items.some((item) => item.kind === 'vector_match');
  const hasText = evidence.items.some((item) => item.kind === 'matched_context');
  if (hasVector && hasText) return 'mixed';
  if (hasVector) return 'vector';
  if (hasText) return 'text';
  return 'local';
}

function triggerIcon(kind: ReturnType<typeof triggerKind>) {
  if (kind === 'vector') return 'sparkle';
  if (kind === 'text') return 'search';
  if (kind === 'mixed') return 'memoryMap';
  return 'openBook';
}

function formatChunkKind(kind: ChatMemoryEvidenceChunkKind | undefined, t: Translate) {
  if (kind === 'dialogue_turn') return t('memory.evidence.chunkDialogueTurn');
  if (kind === 'user_intent') return t('memory.evidence.chunkUserIntent');
  if (kind === 'source_message') return t('memory.evidence.chunkSourceMessage');
  return null;
}

function formatScore(score: number | null) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return score > 1 ? score.toFixed(2) : score.toFixed(3);
}

function formatCount(
  count: number,
  singularKey: Parameters<Translate>[0],
  pluralKey: Parameters<Translate>[0],
  t: Translate,
  formatNumber: FormatNumber
) {
  return t(count === 1 ? singularKey : pluralKey, { count: formatNumber(count) });
}

export function MessageMemoryEvidence({
  evidence,
  expanded,
  onToggle,
  showTrigger = true,
  copy
}: MessageMemoryEvidenceProps) {
  const defaultCopy = useI18n();
  const { t, formatNumber } = copy ?? defaultCopy;
  const vectorCount = evidence.items.filter((item) => item.kind === 'vector_match').length;
  const textCount = evidence.items.filter((item) => item.kind === 'matched_context').length;
  const kind = triggerKind(evidence);
  const labelParts = [
    formatCount(evidence.items.length, 'memory.evidence.memoryCountOne', 'memory.evidence.memoryCountOther', t, formatNumber),
    vectorCount > 0
      ? formatCount(vectorCount, 'memory.evidence.vectorCountOne', 'memory.evidence.vectorCountOther', t, formatNumber)
      : null,
    textCount > 0
      ? formatCount(textCount, 'memory.evidence.anchorCountOne', 'memory.evidence.anchorCountOther', t, formatNumber)
      : null
  ].filter(Boolean);
  const label = labelParts.join(' · ');
  const showPanel = expanded || !showTrigger;

  return (
    <div className={`message-memory-evidence ${showPanel ? 'expanded' : 'collapsed'} ${showTrigger ? '' : 'embedded'}`} data-kind={kind}>
      {showTrigger ? (
        <button
          type="button"
          className="message-memory-evidence-trigger"
          data-kind={kind}
          aria-expanded={expanded}
          aria-label={expanded ? t('memory.evidence.collapseAria') : t('memory.evidence.expandAria')}
          onClick={onToggle}
        >
          <Icon name={triggerIcon(kind)} size={15} />
          <span>{label}</span>
        </button>
      ) : null}
      {showPanel ? (
        <div className="message-memory-evidence-panel">
          <div className="message-memory-evidence-panel-head">
            <span>{showTrigger ? t('memory.evidence.panelTitle') : label}</span>
            <span>{evidence.strategy === 'semantic_index' ? t('memory.evidence.strategySemanticIndex') : t('memory.evidence.strategyLocalScan')}</span>
          </div>
          <div className="message-memory-evidence-list">
            {evidence.items.map((item) => {
              const chunkKind = formatChunkKind(item.memoryChunkKind, t);
              const score = formatScore(item.score);
              const tone = evidenceTone(item.kind);
              return (
                <article key={item.id} className={`message-memory-evidence-item ${item.kind}`} data-kind={tone}>
                  <div className="message-memory-evidence-item-head">
                    <strong>{formatEvidenceKind(item.kind, t)}</strong>
                    <span>
                      {formatCount(
                        item.sourceMessageIds.length,
                        'memory.evidence.messageCountOne',
                        'memory.evidence.messageCountOther',
                        t,
                        formatNumber
                      )}
                    </span>
                    {chunkKind ? <span>{chunkKind}</span> : null}
                    {score ? <span>{t('memory.evidence.similarity', { score })}</span> : null}
                  </div>
                  <p className="message-memory-evidence-title">{item.label}</p>
                  <p className="message-memory-evidence-excerpt">{item.textExcerpt}</p>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
