import { useEffect, useState } from 'react';
import type { CheckhenMode } from './mode';

let cached: Promise<CheckhenMode> | null = null;

/** The deployment's mode, fetched once per page load. Null until it arrives. */
export function useCheckhenMode(): CheckhenMode | null {
  const [mode, setMode] = useState<CheckhenMode | null>(null);
  useEffect(() => {
    cached ??= fetch('/api/mode')
      .then((response) => (response.ok ? response.json() : { mode: 'classroom' }))
      .then((data) => (data.mode === 'hosted' ? 'hosted' : 'classroom'))
      .catch(() => 'classroom' as CheckhenMode);
    let live = true;
    cached.then((value) => live && setMode(value));
    return () => {
      live = false;
    };
  }, []);
  return mode;
}
