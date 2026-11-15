import { resolveProviderCapability } from './providerCapability';
import { resolveProviderRuntimeRequestAdapter } from './providerRuntimeAdapters';
import type { ProviderRuntimeRequestInput } from './providerRuntimeRequestTypes';
import type { ProviderHttpRequest } from './providerRuntimeTypes';

export function buildProviderRuntimeRequest(input: ProviderRuntimeRequestInput): ProviderHttpRequest {
  const api = resolveProviderCapability(input.api, input.advanced).provider;
  return resolveProviderRuntimeRequestAdapter(api).buildRequest({ ...input, api });
}
