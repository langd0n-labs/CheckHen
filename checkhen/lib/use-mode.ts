import { useEffect, useState } from 'react';
import type { CheckhenMode } from './mode';

type ModeInfo = { mode: CheckhenMode; demo: boolean; full: boolean };
let cached: Promise<ModeInfo> | null = null;

function modeInfo(): Promise<ModeInfo> {
  cached ??= fetch('/api/mode')
    .then(
      (response): Promise<{ mode?: string; demo?: boolean; full?: boolean }> =>
        response.ok ? response.json() : Promise.resolve({})
    )
    .then(
      (data) =>
        ({
          mode: data.mode === 'hosted' ? 'hosted' : 'classroom',
          demo: data.demo === true,
          full: data.full === true,
        }) as ModeInfo
    )
    .catch(() => ({ mode: 'classroom', demo: false, full: false }) as ModeInfo);
  return cached;
}

function useModeInfo(): ModeInfo | null {
  const [info, setInfo] = useState<ModeInfo | null>(null);
  useEffect(() => {
    let live = true;
    modeInfo().then((value) => live && setInfo(value));
    return () => {
      live = false;
    };
  }, []);
  return info;
}

/** The deployment's mode, fetched once per page load. Null until it arrives. */
export function useCheckhenMode(): CheckhenMode | null {
  return useModeInfo()?.mode ?? null;
}

/** Whether this is the demo deployment. */
export function useDemoMode(): boolean {
  return useModeInfo()?.demo ?? false;
}

/** Whether the demo has reached its storage limit and takes no changes. */
export function useDemoFull(): boolean {
  return useModeInfo()?.full ?? false;
}
