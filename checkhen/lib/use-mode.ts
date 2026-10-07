import { useEffect, useState } from 'react';
import type { CheckhenMode } from './mode';

type ModeInfo = { mode: CheckhenMode; demo: boolean };
let cached: Promise<ModeInfo> | null = null;

function modeInfo(): Promise<ModeInfo> {
  cached ??= fetch('/api/mode')
    .then(
      (response): Promise<{ mode?: string; demo?: boolean }> =>
        response.ok ? response.json() : Promise.resolve({})
    )
    .then(
      (data) =>
        ({
          mode: data.mode === 'hosted' ? 'hosted' : 'classroom',
          demo: data.demo === true,
        }) as ModeInfo
    )
    .catch(() => ({ mode: 'classroom', demo: false }) as ModeInfo);
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
