import type { World } from '../../types/domain';

export function shouldShowWorldSwitchVeil(activeWorld: World, enabled: boolean) {
  return enabled && activeWorld !== 'group';
}
