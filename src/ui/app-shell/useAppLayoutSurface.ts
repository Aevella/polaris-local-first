import { useEffect, useState } from 'react';
import {
  DESKTOP_SIDEBAR_AUTO_COLLAPSE_WIDTH,
  NATIVE_IOS_TABLET_LAYOUT_QUERY,
  TABLET_LAYOUT_QUERY,
  normalizeAppLayoutSurface,
  resolveAppLayoutSurfaceFromMatches,
  type AppLayoutSurface
} from '../../app/shell/appLayoutSurface';

const DESKTOP_SIDEBAR_AUTO_COLLAPSE_QUERY = `(max-width: ${DESKTOP_SIDEBAR_AUTO_COLLAPSE_WIDTH - 1}px)`;

function resolveDomLayoutSurface(): AppLayoutSurface | null {
  if (typeof document === 'undefined') return null;

  const { polarisLayoutSurface, polarisSurface } = document.documentElement.dataset;

  return normalizeAppLayoutSurface(polarisLayoutSurface) ?? normalizeAppLayoutSurface(polarisSurface);
}

function resolveViewportLayoutSurface(): AppLayoutSurface {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'phone';
  }

  const root = document.documentElement;
  const nativeIos = root.dataset.polarisNative === 'true' && root.dataset.polarisPlatform === 'ios';

  return resolveAppLayoutSurfaceFromMatches({
    desktop: false,
    nativeIos,
    nativeIosTablet: window.matchMedia(NATIVE_IOS_TABLET_LAYOUT_QUERY).matches,
    tablet: window.matchMedia(TABLET_LAYOUT_QUERY).matches
  });
}

function resolveAppLayoutSurface(): AppLayoutSurface {
  return resolveDomLayoutSurface() ?? resolveViewportLayoutSurface();
}

export function useAppLayoutSurface() {
  const [surface, setSurface] = useState<AppLayoutSurface>(() => resolveAppLayoutSurface());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQueries = [
      window.matchMedia(TABLET_LAYOUT_QUERY),
      window.matchMedia(NATIVE_IOS_TABLET_LAYOUT_QUERY)
    ];
    const refreshSurface = () => {
      setSurface(resolveAppLayoutSurface());
    };

    refreshSurface();
    mediaQueries.forEach((mediaQuery) => mediaQuery.addEventListener('change', refreshSurface));

    return () => {
      mediaQueries.forEach((mediaQuery) => mediaQuery.removeEventListener('change', refreshSurface));
    };
  }, []);

  return surface;
}

export function useDesktopSidebarAutoCollapse(enabled: boolean) {
  const [autoCollapsed, setAutoCollapsed] = useState(false);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      setAutoCollapsed(false);
      return undefined;
    }

    const mediaQuery = window.matchMedia(DESKTOP_SIDEBAR_AUTO_COLLAPSE_QUERY);
    const refreshAutoCollapsed = () => {
      setAutoCollapsed(mediaQuery.matches);
    };

    refreshAutoCollapsed();
    mediaQuery.addEventListener('change', refreshAutoCollapsed);

    return () => {
      mediaQuery.removeEventListener('change', refreshAutoCollapsed);
    };
  }, [enabled]);

  return autoCollapsed;
}
