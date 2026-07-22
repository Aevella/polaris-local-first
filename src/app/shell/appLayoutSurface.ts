import type { World } from '../../types/domain';

export type AppLayoutSurface = 'phone' | 'tablet' | 'desktop';

export const DESKTOP_LAYOUT_MIN_WIDTH = 500;
export const TABLET_LAYOUT_MIN_WIDTH = 700;
export const DESKTOP_SIDEBAR_AUTO_COLLAPSE_WIDTH = 920;

export const DESKTOP_LAYOUT_QUERY =
  `(min-width: ${DESKTOP_LAYOUT_MIN_WIDTH}px) and (hover: hover) and (pointer: fine)`;
export const TABLET_LAYOUT_QUERY = `(min-width: ${TABLET_LAYOUT_MIN_WIDTH}px)`;
export const NATIVE_IOS_TABLET_LAYOUT_QUERY =
  `(min-width: ${TABLET_LAYOUT_MIN_WIDTH}px) and (min-height: ${TABLET_LAYOUT_MIN_WIDTH}px) and (orientation: landscape)`;

export function normalizeAppLayoutSurface(value: string | null | undefined): AppLayoutSurface | null {
  if (value === 'phone' || value === 'tablet' || value === 'desktop') return value;
  if (value === 'mobile') return 'phone';
  return null;
}

export function resolveAppLayoutSurfaceFromMatches(matches: {
  desktop: boolean;
  nativeIos?: boolean;
  nativeIosTablet?: boolean;
  tablet: boolean;
}): AppLayoutSurface {
  if (matches.nativeIos) return matches.nativeIosTablet ? 'tablet' : 'phone';
  if (matches.tablet) return 'tablet';
  return matches.desktop ? 'desktop' : 'phone';
}

export function isWideLayoutSurface(surface: AppLayoutSurface) {
  return surface !== 'phone';
}

export function isSidebarLayoutSurface(surface: AppLayoutSurface) {
  return isWideLayoutSurface(surface);
}

export function shouldShowDesktopSidebar(surface: AppLayoutSurface, activeWorld: World) {
  return isSidebarLayoutSurface(surface) && activeWorld !== 'group';
}
