export function prepareBuiltInChatPayloadForModel(payload: Record<string, unknown>, model: string): Record<string, unknown> {
  return {
    ...payload,
    model
  };
}
