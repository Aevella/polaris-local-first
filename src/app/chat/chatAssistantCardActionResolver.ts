import type { ToolAction } from '../../engines/toolExecutor';
import type { AssistantToolAction } from '../../engines/assistantToolProtocol';
import type { CodeCard } from '../../types/domain';
import { findCardByTarget, formatResolvedTargetLabel } from './chatAssistantTargetResolution';

export function resolveAssistantCardAction(args: { action: AssistantToolAction; cards: CodeCard[]; activeCardId: string | null }): { resolved: ToolAction[]; errors: string[] } | null {
  const { action, cards, activeCardId } = args;
  const resolved: ToolAction[] = [];
  const errors: string[] = [];
  switch (action.kind) {
      case 'listCodeCards': {
        resolved.push({
          kind: 'listCodeCards',
          targetLabel: action.targetLabel
        });
        break;
      }
      case 'patchCodeCard': {
        const targetCard = findCardByTarget(cards, activeCardId, action.target);
        if (!targetCard.ok) {
          errors.push(targetCard.error);
          break;
        }
        resolved.push({
          kind: 'patchCodeCard',
          cardId: targetCard.card.id,
          patch: action.patch,
          targetLabel: action.patch.title?.trim() || action.targetLabel || targetCard.card.title,
          openInCollection: action.openInCollection
        });
        break;
      }
      case 'appendCodeCard': {
        const targetCard = findCardByTarget(cards, activeCardId, action.target);
        if (!targetCard.ok) {
          errors.push(targetCard.error);
          break;
        }
        resolved.push({
          kind: 'appendCodeCard',
          cardId: targetCard.card.id,
          code: action.code,
          targetLabel: formatResolvedTargetLabel(
            targetCard,
            action.targetLabel || targetCard.card.title
          ),
          openInCollection: action.openInCollection ?? true
        });
        break;
      }
      case 'editCodeCardText': {
        const targetCard = findCardByTarget(cards, activeCardId, action.target);
        if (!targetCard.ok) {
          errors.push(targetCard.error);
          break;
        }
        resolved.push({
          kind: 'editCodeCardText',
          cardId: targetCard.card.id,
          oldString: action.oldString,
          newString: action.newString,
          targetLabel: formatResolvedTargetLabel(
            targetCard,
            action.targetLabel || targetCard.card.title
          ),
          openInCollection: action.openInCollection ?? true
        });
        break;
      }
      case 'readCodeCard': {
        const targetCard = findCardByTarget(cards, activeCardId, action.target);
        if (!targetCard.ok) {
          errors.push(targetCard.error);
          break;
        }
        resolved.push({
          kind: 'readCodeCard',
          cardId: targetCard.card.id,
          targetLabel: action.targetLabel || targetCard.card.title
        });
        break;
      }
    default:
      return null;
  }
  return { resolved, errors };
}
