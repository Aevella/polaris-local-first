import { applyRegexRules, parseRegexRules } from '../regexProcessor';
import { buildMessageTemplateVars, resolveMessageTemplate } from '../templateEngine';
import type { ChatMessage, Persona } from '../../types/domain';
import { buildCardReferenceSystemContent } from './requestContextContent';
import { materializeRequestContextMessage, normalizeRequestContextMessageOrder } from './requestContextMessages';
import { toRequestMessage, type RequestMessage } from './requestMessage';
import { collapseAssistantReplySegmentsForRequest } from '../assistantReplySegments';

export type PreparedConversationMessages = {
  messages: RequestMessage[];
  transforms: {
    requestMessagesMaterialized: true;
    personaTransformed: true;
    cardReferencesMaterialized: true;
    orderNormalized: true;
  };
};

function isDefaultMessageTemplate(template: string | undefined) {
  const trimmed = template?.trim();
  return !trimmed || trimmed === '{{ message }}';
}

function materializeConversationCardReferences(messages: RequestMessage[]): RequestMessage[] {
  return messages.flatMap((message) => {
    if (message.role !== 'user' || !message.cardReference) {
      return [message];
    }

    return [
      {
        id: `${message.id}:card-reference`,
        role: 'system',
        content: buildCardReferenceSystemContent(message.cardReference),
        timestamp: message.timestamp,
        origin: 'system-note'
      },
      message
    ];
  });
}

function applyRequestMessagePersonaTransforms(
  messages: RequestMessage[],
  persona: Persona | null | undefined
): RequestMessage[] {
  const regexRules = parseRegexRules(persona?.advanced.regexRules);
  const shouldApplyRegex = regexRules.length > 0;
  const messageTemplate = persona?.messageTemplate?.trim();
  const shouldApplyTemplate = !isDefaultMessageTemplate(messageTemplate);

  if (!shouldApplyRegex && !shouldApplyTemplate) {
    return messages;
  }

  return messages.map((message) => {
    if (message.origin === 'trigger-runtime') {
      return message;
    }

    const sanitizedContent = shouldApplyRegex
      ? applyRegexRules(message.content, regexRules, 'input')
      : message.content;
    if (!shouldApplyTemplate) {
      return sanitizedContent === message.content
        ? message
        : { ...message, content: sanitizedContent };
    }

    const dateVars = buildMessageTemplateVars(message.timestamp || Date.now());
    const templatedContent = resolveMessageTemplate(messageTemplate, {
      role: message.role,
      message: sanitizedContent,
      time: dateVars.time,
      date: dateVars.date
    });

    if (templatedContent === message.content) {
      return message;
    }

    return {
      ...message,
      content: templatedContent
    };
  });
}

export function prepareConversationMessages(
  messages: ChatMessage[],
  persona: Persona | null | undefined
): PreparedConversationMessages {
  const contextMessages = collapseAssistantReplySegmentsForRequest(messages)
    .map(toRequestMessage)
    .map((message) => materializeRequestContextMessage(message));
  const preparedMessages = applyRequestMessagePersonaTransforms(contextMessages, persona);
  const messagesWithCardReferences = materializeConversationCardReferences(preparedMessages);

  return {
    messages: normalizeRequestContextMessageOrder(messagesWithCardReferences),
    transforms: {
      requestMessagesMaterialized: true,
      personaTransformed: true,
      cardReferencesMaterialized: true,
      orderNormalized: true
    }
  };
}
