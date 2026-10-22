import { Component, type ReactNode } from 'react';
import type { TimelineReadingPosition } from './timelineReadingPosition';

type Props = {
  conversationId: string | null;
  captureReadingPosition: () => TimelineReadingPosition | null;
  onGeometryChange: (position: TimelineReadingPosition | null) => void;
  children: ReactNode;
};

/** Capture the live viewport before React mutates rows or spacers. A scroll
 * event can still be queued while a message/measurement update commits. */
export class TimelineGeometryBoundary extends Component<Props, Record<string, never>, TimelineReadingPosition | null> {
  getSnapshotBeforeUpdate(previous: Props) {
    if (previous.conversationId !== this.props.conversationId) {
      // Save the departing conversation while its DOM still exists.
      previous.captureReadingPosition();
      return null;
    }
    return this.props.captureReadingPosition();
  }

  componentDidMount() {
    this.props.onGeometryChange(null);
  }

  componentDidUpdate(...update: [Props, Record<string, never>, TimelineReadingPosition | null]) {
    this.props.onGeometryChange(update[2]);
  }

  render() {
    return <div className="chat-flow-shell">{this.props.children}</div>;
  }
}
