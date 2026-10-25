import { describe, expect, it } from 'vitest';
import { shouldShowWorldSwitchVeil } from './worldSwitchVeilVisibility';

describe('shouldShowWorldSwitchVeil', () => {
  it('keeps the world switch handle between chat and collection', () => {
    expect(shouldShowWorldSwitchVeil('chat', true)).toBe(true);
    expect(shouldShowWorldSwitchVeil('collection', true)).toBe(true);
  });

  it('removes the world switch handle from the group world', () => {
    expect(shouldShowWorldSwitchVeil('group', true)).toBe(false);
  });

  it('removes the world switch handle when the user disables it', () => {
    expect(shouldShowWorldSwitchVeil('chat', false)).toBe(false);
    expect(shouldShowWorldSwitchVeil('collection', false)).toBe(false);
  });
});
