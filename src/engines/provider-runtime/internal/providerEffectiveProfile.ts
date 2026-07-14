import type { ProviderProfile } from '../../../types/domain';

export function resolveProviderEffectiveModel(
  provider: Pick<ProviderProfile, 'model'>,
  modelOverride?: string | null
) {
  return modelOverride?.trim() || provider.model;
}
