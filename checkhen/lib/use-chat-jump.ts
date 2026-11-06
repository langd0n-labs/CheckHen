import { RefObject, useCallback, useEffect, useRef, useState } from 'react';

export type ChatJump = { classId: string; messageId: string };

export function useChatJump(
  classId: string | null | undefined,
  viewport: RefObject<HTMLElement | null>
) {
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const active = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    active.current = false;
    setHighlightedId(null);
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
      if (settle.current) {
        clearTimeout(settle.current);
      }
      active.current = false;
    };
  }, [classId]);

  const jump = useCallback(
    (event: ChatJump) => {
      if (
        !event ||
        typeof event.classId !== 'string' ||
        typeof event.messageId !== 'string' ||
        (classId !== undefined && event.classId !== classId)
      ) {
        return;
      }
      const target = Array.from(
        viewport.current?.querySelectorAll<HTMLElement>('[data-message-id]') ?? []
      ).find(
        (node) => node.dataset.messageId === event.messageId && node.dataset.hidden !== 'true'
      );
      if (!target) {
        return;
      }
      if (timer.current) {
        clearTimeout(timer.current);
      }
      if (settle.current) {
        clearTimeout(settle.current);
      }
      active.current = true;
      setHighlightedId(event.messageId);
      target.scrollIntoView({
        block: 'center',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      });
      // A message that arrives during a smooth scroll can stop the scroll short of the target.
      settle.current = setTimeout(() => {
        if (target.isConnected) {
          target.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
      }, 1000);
      timer.current = setTimeout(() => {
        active.current = false;
        setHighlightedId(null);
      }, 8000);
    },
    [classId, viewport]
  );

  return { highlightedId, active, jump };
}
