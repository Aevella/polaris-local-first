import type { CanonicalProviderOutputTokenField, ProviderHttpRequest } from './providerRuntimeTypes';

const OUTPUT_TOKEN_FIELDS = ['max_completion_tokens', 'max_output_tokens', 'max_tokens'] as const;

function removeConnectionTestReasoningBudget(request: ProviderHttpRequest) {
  delete request.body.thinking;
  delete request.body.reasoning;
  delete request.body.output_config;

  const generationConfig = request.body.generationConfig;
  if (generationConfig && typeof generationConfig === 'object' && !Array.isArray(generationConfig)) {
    delete (generationConfig as Record<string, unknown>).thinkingConfig;
  }
}

export function setConnectionTestOutputTokenField(
  request: ProviderHttpRequest,
  field: Extract<CanonicalProviderOutputTokenField, 'max_completion_tokens' | 'max_output_tokens' | 'max_tokens'>,
  maxOutputTokens: number
) {
  removeConnectionTestReasoningBudget(request);
  for (const candidate of OUTPUT_TOKEN_FIELDS) {
    delete request.body[candidate];
  }
  request.body[field] = maxOutputTokens;
}

export function setGeminiConnectionTestOutputTokens(request: ProviderHttpRequest, maxOutputTokens: number) {
  const generationConfig = {
    ...(
      request.body.generationConfig
      && typeof request.body.generationConfig === 'object'
      && !Array.isArray(request.body.generationConfig)
        ? request.body.generationConfig
        : {}
    ),
    maxOutputTokens
  };
  delete (generationConfig as Record<string, unknown>).thinkingConfig;
  request.body.generationConfig = generationConfig;
}
