import { useEffect } from 'react';
import { startHeavySurfaceOpen } from '../../app/developer/runtime-performance/runtimePerformanceDebug';
import type { MenuOverlayPage } from '../../app/shell/appShellContracts';
import { MCP_OAUTH_OPEN_SETTINGS_EVENT } from '../../app/shell/mcpServerConnection';
import type { useAppModalState } from './useAppModalState';
import {
  loadApiProviderSheetModule,
  loadMenuSheetModule
} from './appShellLazyModules';

type AppModalState = ReturnType<typeof useAppModalState>;

export function useAppShellOverlayNavigation(modals: AppModalState) {
  const closeMenu = () => {
    modals.setMenuOpen(false);
    modals.setMenuInitialPage('root');
  };

  const openMenuAt = (page: MenuOverlayPage) => {
    modals.setMenuInitialPage(page);
    void loadMenuSheetModule();
    startHeavySurfaceOpen('menu-sheet');
    modals.setMenuOpen(true);
  };

  useEffect(() => {
    const openMcpSettings = () => {
      modals.setMenuInitialPage('mcp');
      void loadMenuSheetModule();
      startHeavySurfaceOpen('menu-sheet');
      modals.setMenuOpen(true);
    };
    globalThis.addEventListener(MCP_OAUTH_OPEN_SETTINGS_EVENT, openMcpSettings);
    return () => globalThis.removeEventListener(MCP_OAUTH_OPEN_SETTINGS_EVENT, openMcpSettings);
  }, [modals.setMenuInitialPage, modals.setMenuOpen]);

  const closeApi = () => {
    modals.setApiOpen(false);
    modals.setApiReturnPage('root');
  };

  const openApiFromMenu = (returnPage: MenuOverlayPage) => {
    closeMenu();
    modals.setApiReturnPage(returnPage);
    void loadApiProviderSheetModule();
    startHeavySurfaceOpen('provider-sheet');
    modals.setApiOpen(true);
  };

  const backToMenuFromApi = () => {
    const returnPage = modals.apiReturnPage ?? 'root';
    closeApi();
    openMenuAt(returnPage);
  };

  const toggleMenu = () => {
    if (modals.menuOpen) {
      closeMenu();
      return;
    }
    openMenuAt('root');
  };

  return {
    closeMenu,
    openMenuAt,
    closeApi,
    openApiFromMenu,
    backToMenuFromApi,
    toggleMenu
  };
}
