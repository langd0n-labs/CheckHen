import { RefObject, useCallback, useEffect, useRef, useState } from 'react';

export type ChatJump = { classId: string; messageId: string };

export function useChatJump(
  classId: string | null | undefined,
  viewport: RefObject<HTMLElement | null>
) {
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const active = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    active.current = false;
    setHighlightedId(null);
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
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
      active.current = true;
      setHighlightedId(event.messageId);
      target.scrollIntoView({
        block: 'center',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      });
      timer.current = setTimeout(() => {
        active.current = false;
        setHighlightedId(null);
      }, 8000);
    },
    [classId, viewport]
  );

  return { highlightedId, active, jump };
}
