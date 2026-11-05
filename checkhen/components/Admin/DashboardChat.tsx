import { Component, createRef, ReactNode } from 'react';
import classes from './DashboardChat.module.css';

// Take the reading-position snapshot before React prepends message elements.
export default class DashboardChat extends Component<{ children: ReactNode; narrow: boolean }> {
  viewport = createRef<HTMLDivElement>();

  getSnapshotBeforeUpdate() {
    const viewport = this.viewport.current!;
    if (viewport.scrollTop <= 1) {
      return null;
    }
    const top = viewport.getBoundingClientRect().top;
    const anchor = Array.from(viewport.querySelectorAll<HTMLElement>('[data-message-id]')).find(
      (node) => node.getBoundingClientRect().bottom > top
    );
    return anchor ? { node: anchor, top: anchor.getBoundingClientRect().top } : null;
  }

  componentDidUpdate(
    _props: unknown,
    _state: unknown,
    snapshot: { node: HTMLElement; top: number } | null
  ) {
    const viewport = this.viewport.current!;
    if (!snapshot) {
      if (viewport.scrollTop) {
        viewport.scrollTop = 0;
      }
    } else if (snapshot.node.isConnected) {
      const delta = snapshot.node.getBoundingClientRect().top - snapshot.top;
      if (delta) {
        viewport.scrollTop += delta;
      }
    }
  }

  render() {
    return (
      <div
        ref={this.viewport}
        role="region"
        aria-label="Discussion messages"
        className={classes.viewport}
        style={this.props.narrow ? { height: '60vh', flex: 'none' } : undefined}
      >
        {this.props.children}
      </div>
    );
  }
}

export function newestFirst<T extends { id: string; createdAt: string }>(
  messages: readonly T[]
): T[] {
  return [...messages].sort(
    (a, b) =>
      Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}
