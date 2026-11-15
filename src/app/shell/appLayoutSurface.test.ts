import { describe, expect, it } from 'vitest';
import {
  isSidebarLayoutSurface,
  isWideLayoutSurface,
  NATIVE_IOS_TABLET_LAYOUT_QUERY,
  normalizeAppLayoutSurface,
  resolveAppLayoutSurfaceFromMatches,
  shouldShowDesktopSidebar
} from './appLayoutSurface';

describe('normalizeAppLayoutSurface', () => {
  it('accepts explicit layout surface names', () => {
    expect(normalizeAppLayoutSurface('phone')).toBe('phone');
    expect(normalizeAppLayoutSurface('tablet')).toBe('tablet');
    expect(normalizeAppLayoutSurface('desktop')).toBe('desktop');
  });

  it('maps legacy mobile to phone', () => {
    expect(normalizeAppLayoutSurface('mobile')).toBe('phone');
  });

  it('rejects unknown values', () => {
    expect(normalizeAppLayoutSurface('ios')).toBeNull();
    expect(normalizeAppLayoutSurface(null)).toBeNull();
  });
});

describe('resolveAppLayoutSurfaceFromMatches', () => {
  it('does not require landscape orientation for native ios tablet geometry', () => {
    expect(NATIVE_IOS_TABLET_LAYOUT_QUERY).not.toContain('orientation');
  });

  it('uses the tablet shell for ordinary wide browser layouts even when hover is available', () => {
    expect(resolveAppLayoutSurfaceFromMatches({ desktop: true, tablet: true })).toBe('tablet');
  });

  it('uses tablet for wide touch-class viewports', () => {
    expect(resolveAppLayoutSurfaceFromMatches({ desktop: false, tablet: true })).toBe('tablet');
  });

  it('keeps desktop as an explicit host surface when no tablet viewport match is present', () => {
    expect(resolveAppLayoutSurfaceFromMatches({ desktop: true, tablet: false })).toBe('desktop');
  });

  it('falls back to phone for narrow viewports', () => {
    expect(resolveAppLayoutSurfaceFromMatches({ desktop: false, tablet: false })).toBe('phone');
  });

  it('uses the tablet shell for native ios portrait windows with tablet-class geometry', () => {
    expect(resolveAppLayoutSurfaceFromMatches({
      desktop: false,
      nativeIos: true,
      nativeIosTablet: true,
      tablet: true
    })).toBe('tablet');
  });

  it('keeps compact native ios windows on the phone shell', () => {
    expect(resolveAppLayoutSurfaceFromMatches({
      desktop: false,
      nativeIos: true,
      nativeIosTablet: false,
      tablet: true
    })).toBe('phone');
  });
});

describe('layout surface helpers', () => {
  it('uses the shared sidebar frame for every wide layout', () => {
    expect(isWideLayoutSurface('tablet')).toBe(true);
    expect(isSidebarLayoutSurface('tablet')).toBe(true);
    expect(isSidebarLayoutSurface('desktop')).toBe(true);
  });
});

describe('shouldShowDesktopSidebar', () => {
  it('keeps the global desktop sidebar out of the group world', () => {
    expect(shouldShowDesktopSidebar('tablet', 'group')).toBe(false);
    expect(shouldShowDesktopSidebar('desktop', 'group')).toBe(false);
  });

  it('keeps the sidebar available for wide chat and collection worlds', () => {
    expect(shouldShowDesktopSidebar('tablet', 'chat')).toBe(true);
    expect(shouldShowDesktopSidebar('tablet', 'collection')).toBe(true);
    expect(shouldShowDesktopSidebar('phone', 'chat')).toBe(false);
  });
});
