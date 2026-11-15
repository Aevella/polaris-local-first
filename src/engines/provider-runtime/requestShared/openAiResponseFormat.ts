// Chat Completions response formats are objects. Image/audio endpoint formats
// are strings and deliberately do not pass through this request boundary.
export function normalizeOpenAiChatResponseFormat(body: Record<string, unknown>) {
  const value = body.response_format;
  if (typeof value !== 'string') return;
  const type = value.trim();
  if (type === 'text' || type === 'json_object') {
    body.response_format = { type };
  }
}
