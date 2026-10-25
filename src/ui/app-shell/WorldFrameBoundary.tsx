import { Component, type ErrorInfo, type ReactNode } from 'react';
import { recordClientError } from '../../app/bootstrap/clientErrorLog';
import type { World } from '../../types/domain';
import { createTranslator, useI18n, type I18nTranslator } from '../../i18n';
import { useSpaceStore } from '../../stores/spaceStore';

type WorldFrameBoundaryProps = {
  world: World;
  retryKey: number;
  onRetry: () => void;
  children: ReactNode;
};

type WorldFrameBoundaryState = {
  errorId: string | null;
};

function worldFrameLabel(world: World, t: I18nTranslator['t']) {
  if (world === 'chat') return t('app.world.chat');
  if (world === 'collection') return t('app.world.collection');
  return t('app.world.group');
}

function createWorldFrameTranslator() {
  return createTranslator(useSpaceStore.getState().appLanguage);
}

export function WorldFrameFallback() {
  return <div className="world-frame-loading" aria-hidden="true" />;
}

export class WorldFrameBoundary extends Component<WorldFrameBoundaryProps, WorldFrameBoundaryState> {
  state: WorldFrameBoundaryState = {
    errorId: null
  };

  static getDerivedStateFromError(): WorldFrameBoundaryState {
    return {
      errorId: 'err-pending'
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const entry = recordClientError(error, 'boundary', {
      componentStack: info.componentStack ?? undefined,
      context: `world-frame:${this.props.world}`
    });
    this.setState({ errorId: entry.id });
  }

  componentDidUpdate(previousProps: WorldFrameBoundaryProps) {
    if (previousProps.retryKey !== this.props.retryKey && this.state.errorId) {
      this.setState({ errorId: null });
    }
  }

  reloadApp = () => {
    window.location.reload();
  };

  render() {
    const { children, onRetry, world } = this.props;
    const { errorId } = this.state;
    const { t } = createWorldFrameTranslator();
    if (!errorId) return children;

    return (
      <div className="world-frame-fallback" role="alert">
        <div className="world-frame-fallback-panel">
          <strong>{t('app.world.failedTitle', { world: worldFrameLabel(world, t) })}</strong>
          <p>{t('app.world.failedBody')}</p>
          <div className="world-frame-fallback-actions">
            <button type="button" className="primary" onClick={onRetry}>{t('app.world.retry')}</button>
            <button type="button" onClick={this.reloadApp}>{t('app.world.reload')}</button>
          </div>
          <code>{errorId}</code>
        </div>
      </div>
    );
  }
}
