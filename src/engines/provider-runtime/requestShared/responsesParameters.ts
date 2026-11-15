/** Normalize supported controls only on the official reasoning route. Relays
 * retain their configured parameters because their model contracts may differ. */
export function normalizeResponsesParameters(body: Record<string, unknown>, endpoint: string) {
  if (body.reasoning_effort !== undefined) {
    const reasoning = body.reasoning && typeof body.reasoning === 'object' && !Array.isArray(body.reasoning)
      ? body.reasoning as Record<string, unknown> : {};
    body.reasoning = { effort: body.reasoning_effort, ...reasoning };
    delete body.reasoning_effort;
  }
  if (body.max_output_tokens === undefined && (body.max_completion_tokens !== undefined || body.max_tokens !== undefined)) {
    body.max_output_tokens = body.max_completion_tokens ?? body.max_tokens;
  }
  delete body.max_tokens;
  delete body.max_completion_tokens;
  delete body.stream_options;
  if (body.response_format && typeof body.response_format === 'object' && !Array.isArray(body.response_format)) {
    const format = body.response_format as Record<string, unknown>;
    const schema = format.json_schema && typeof format.json_schema === 'object' && !Array.isArray(format.json_schema)
      ? format.json_schema as Record<string, unknown> : undefined;
    const { json_schema: _schema, ...fields } = format;
    const text = body.text && typeof body.text === 'object' && !Array.isArray(body.text) ? body.text as Record<string, unknown> : {};
    body.text = { format: schema ? { ...fields, ...schema } : fields, ...text };
    delete body.response_format;
  }
  if (new URL(endpoint, 'https://local.invalid').hostname !== 'api.openai.com') return;
  const model = typeof body.model === 'string' ? body.model.toLowerCase() : '';
  if (!/^(?:gpt-[56](?:[.-]|$)|o[34](?:[.-]|$))/.test(model)) return;
  const reasoning = body.reasoning && typeof body.reasoning === 'object' && !Array.isArray(body.reasoning)
    ? body.reasoning as Record<string, unknown> : {};
  if (/^(?:gpt-6-astra|gpt-6\.1-sol)/.test(model) && reasoning.effort === 'none') {
    body.reasoning = { ...reasoning, effort: 'low' };
  }
  if (reasoning.effort !== 'none' || /^(?:gpt-6-astra|gpt-6\.1-sol)/.test(model)) {
    for (const key of ['temperature', 'top_p', 'logprobs', 'top_logprobs']) delete body[key];
  }
}
