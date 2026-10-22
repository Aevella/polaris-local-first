import { createPortal } from 'react-dom';
import { isWideLayoutSurface } from '../../../app/shell/appLayoutSurface';
import { useAppLayoutSurface } from '../../app-shell/useAppLayoutSurface';
import {
  useRoomProjectFullscreenController,
  type RoomProjectFullscreenInput
} from '../../../app/collection/useRoomProjectFullscreenController';
import { RoomProjectFullscreenView } from './RoomProjectFullscreenView';

/** Mount the fullscreen portal on the current layout surface; product orchestration lives in app/. */
export function RoomProjectFullscreen(props: RoomProjectFullscreenInput) {
  const layoutSurface = useAppLayoutSurface();
  const controller = useRoomProjectFullscreenController(props, isWideLayoutSurface(layoutSurface));
  if (!controller || typeof document === 'undefined') return null;
  return createPortal(<RoomProjectFullscreenView {...controller} />, document.body);
}
