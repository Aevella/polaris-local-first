import { useEffect, useMemo, useRef, useState } from 'react';
import { analyzeThemeCustomCss } from '../../engines/themeCssGuard';
import { serializeThemeCssFile } from '../../engines/themeCssFile';
import { hasPolarisCssParts, upsertPolarisCssParts } from '../../engines/themeCssParts';
import { useSpaceThemeSessionBindings } from '../../stores/spaceStoreThemeSessionBindings';
import { toThemeFrame } from '../../stores/spaceStoreTheme';
import { useThemeSessionActions } from './useThemeSessionActions';
import {
  buildDefaultSkinName,
  buildSavedSkinEditableCss,
  buildSavedSkinFileName,
  formatSavedSkinTargetSummary,
  isCustomBaseTheme,
  serializeSavedSkinCssFile,
  summarizeTheme
} from './themeStudioSupport';

type ThemeStudioUiPorts = {
  copyText: (text: string) => Promise<boolean>;
  downloadFile?: (blob: Blob, fileName: string) => boolean | void | Promise<boolean | void>;
};

type CustomCssApplyFeedback = {
  id: number;
  kind: 'applied' | 'blocked';
  message: string;
};

export function useThemeStudioController(open: boolean, ui: ThemeStudioUiPorts) {
  const themeSessionBindings = useSpaceThemeSessionBindings();
  const theme = themeSessionBindings.theme;
  const themeSession = useThemeSessionActions();

  const [customCssDraft, setCustomCssDraft] = useState('');
  const [saveName, setSaveName] = useState(buildDefaultSkinName(theme));
  const [copyFeedback, setCopyFeedback] = useState<'idle' | 'done' | 'failed'>('idle');
  const [savedSkinCopyFeedback, setSavedSkinCopyFeedback] = useState<Record<string, 'copied' | 'failed'>>({});
  const [savedSkinExportFeedback, setSavedSkinExportFeedback] = useState<Record<string, 'exported' | 'failed'>>({});
  const [customCssApplyFeedback, setCustomCssApplyFeedback] = useState<CustomCssApplyFeedback | null>(null);
  const liveCustomCssSnapshotTakenRef = useRef(false);
  const customCssApplyFeedbackTimerRef = useRef<number | null>(null);
  const saveNameEditedRef = useRef(false);

  const summary = useMemo(() => summarizeTheme(theme), [theme]);
  const defaultSkinName = useMemo(() => buildDefaultSkinName(theme), [theme]);
  const customBaseMode = useMemo(() => isCustomBaseTheme(theme), [theme]);
  const customCssGuard = useMemo(() => analyzeThemeCustomCss(customCssDraft), [customCssDraft]);

  useEffect(() => {
    if (!open) return;
    setCustomCssDraft('');
    setCustomCssApplyFeedback(null);
    liveCustomCssSnapshotTakenRef.current = false;
  }, [open]);

  useEffect(() => () => {
    if (customCssApplyFeedbackTimerRef.current == null) return;
    window.clearTimeout(customCssApplyFeedbackTimerRef.current);
  }, []);

  useEffect(() => {
    if (!open || saveNameEditedRef.current) return;
    setSaveName(defaultSkinName);
  }, [defaultSkinName, open]);

  useEffect(() => {
    if (copyFeedback === 'idle') return;
    const timer = window.setTimeout(() => setCopyFeedback('idle'), 1800);
    return () => window.clearTimeout(timer);
  }, [copyFeedback]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSavedSkinCopyFeedback({});
      setSavedSkinExportFeedback({});
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [savedSkinCopyFeedback, savedSkinExportFeedback]);

  const handleApplyThemePreset = (presetId: string) => {
    setCustomCssDraft('');
    liveCustomCssSnapshotTakenRef.current = false;
    themeSession.applyThemePreset(presetId);
  };

  const handleApplySavedSkin = (savedSkinId: string) => {
    const savedSkin = theme.savedSkins.find((item) => item.id === savedSkinId);
    if (!savedSkin) return;
    setCustomCssDraft('');
    liveCustomCssSnapshotTakenRef.current = false;
    themeSession.applySavedSkin(savedSkinId);
  };

  const handleRestoreSkinSnapshot = (snapshotId: string) => {
    const snapshot = theme.skinHistory.find((entry) => entry.id === snapshotId);
    if (!snapshot) return;
    setCustomCssDraft('');
    liveCustomCssSnapshotTakenRef.current = false;
    themeSession.restoreSkinSnapshot(snapshotId);
  };

  const handleRollbackLastSkin = () => {
    const latestSnapshot = theme.skinHistory[0];
    if (!latestSnapshot) return;
    setCustomCssDraft('');
    liveCustomCssSnapshotTakenRef.current = false;
    themeSession.rollbackLastSkin();
  };

  const showCustomCssApplyFeedback = (kind: CustomCssApplyFeedback['kind'], message: string) => {
    if (customCssApplyFeedbackTimerRef.current != null) {
      window.clearTimeout(customCssApplyFeedbackTimerRef.current);
    }
    setCustomCssApplyFeedback({ id: Date.now(), kind, message });
    customCssApplyFeedbackTimerRef.current = window.setTimeout(() => {
      setCustomCssApplyFeedback(null);
      customCssApplyFeedbackTimerRef.current = null;
    }, kind === 'applied' ? 1500 : 2200);
  };

  const handleCustomCssDraftChange = (value: string, options?: { feedback?: boolean }) => {
    setCustomCssDraft(value);
    const partUpsertResult = upsertPolarisCssParts(theme.customCSS, value);
    const nextCss = partUpsertResult.changed ? partUpsertResult.nextCss : value;
    const nextGuard = analyzeThemeCustomCss(nextCss);
    if (nextGuard.blockingIssues.length > 0) {
      if (options?.feedback) {
        showCustomCssApplyFeedback('blocked', '没吃上');
      }
      return;
    }

    const trimmed = nextCss.trim();
    if (!trimmed) {
      if (options?.feedback) {
        showCustomCssApplyFeedback('blocked', '没有可用 CSS');
      }
      return;
    }

    if (trimmed === theme.customCSS.trim()) {
      if (options?.feedback) {
        showCustomCssApplyFeedback('applied', '已使用');
      }
      return;
    }

    themeSession.applyLiveCustomCss(trimmed, {
      snapshotBeforeChange: !liveCustomCssSnapshotTakenRef.current
    });
    liveCustomCssSnapshotTakenRef.current = true;
    if (options?.feedback) {
      showCustomCssApplyFeedback('applied', '已使用');
    }
  };

  const handleClearCustomCss = () => {
    setCustomCssDraft('');
    setCustomCssApplyFeedback(null);
    liveCustomCssSnapshotTakenRef.current = false;
    themeSession.clearCustomCSS();
  };

  const handleSaveNameChange = (value: string) => {
    saveNameEditedRef.current = true;
    setSaveName(value);
  };

  const resetSaveName = () => {
    saveNameEditedRef.current = false;
    setSaveName(defaultSkinName);
  };

  return {
    theme,
    summary,
    defaultSkinName,
    customBaseMode,
    customCssDraft,
    customCssGuard,
    customCssApplyFeedback,
    saveName,
    copyFeedback,
    setSelectedSurfaceCodes: themeSessionBindings.setSelectedSurfaceCodes,
    selectAllThemeSurfaces: themeSessionBindings.selectAllThemeSurfaces,
    setCustomCssDraft: handleCustomCssDraftChange,
    clearCustomCss: handleClearCustomCss,
    setSaveName: handleSaveNameChange,
    resetSaveName,
    saveCurrentSkin: themeSessionBindings.saveCurrentSkin,
    renameSavedSkin: themeSessionBindings.renameSavedSkin,
    deleteSavedSkin: themeSessionBindings.deleteSavedSkin,
    updateSavedSkinCss: themeSessionBindings.updateSavedSkinCss,
    savedSkinCopyFeedback,
    savedSkinExportFeedback,
    getSavedSkinTargetSummary: formatSavedSkinTargetSummary,
    getSavedSkinEditableCss: buildSavedSkinEditableCss,
    themeSession: {
      ...themeSession,
      applyThemePreset: handleApplyThemePreset,
      applySavedSkin: handleApplySavedSkin,
      restoreSkinSnapshot: handleRestoreSkinSnapshot,
      rollbackLastSkin: handleRollbackLastSkin
    },
    handleCopyThemeBundle: async () => {
      try {
        const copied = await ui.copyText(serializeThemeCssFile(toThemeFrame(theme)));
        setCopyFeedback(copied ? 'done' : 'failed');
      } catch {
        setCopyFeedback('failed');
      }
    },
    handleCopySavedSkinFile: async (savedSkinId: string) => {
      const savedSkin = theme.savedSkins.find((item) => item.id === savedSkinId);
      if (!savedSkin) return;
      try {
        const copied = await ui.copyText(serializeSavedSkinCssFile(savedSkin));
        setSavedSkinCopyFeedback((state) => ({ ...state, [savedSkinId]: copied ? 'copied' : 'failed' }));
      } catch {
        setSavedSkinCopyFeedback((state) => ({ ...state, [savedSkinId]: 'failed' }));
      }
    },
    handleExportSavedSkinFile: async (savedSkinId: string) => {
      const savedSkin = theme.savedSkins.find((item) => item.id === savedSkinId);
      if (!savedSkin) return;
      if (!ui.downloadFile) {
        setSavedSkinExportFeedback((state) => ({ ...state, [savedSkinId]: 'failed' }));
        return;
      }
      try {
        const exported = await ui.downloadFile(
          new Blob([serializeSavedSkinCssFile(savedSkin)], { type: 'text/css;charset=utf-8' }),
          buildSavedSkinFileName(savedSkin)
        );
        setSavedSkinExportFeedback((state) => ({ ...state, [savedSkinId]: exported === false ? 'failed' : 'exported' }));
      } catch {
        setSavedSkinExportFeedback((state) => ({ ...state, [savedSkinId]: 'failed' }));
      }
    },
    hasPartMarkers: hasPolarisCssParts
  };
}
