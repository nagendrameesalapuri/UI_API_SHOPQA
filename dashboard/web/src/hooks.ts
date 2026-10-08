import { useCallback, useEffect, useRef, useState } from "react";

export type AsyncState<T> = { data?: T; error?: Error; loading: boolean; reload: () => void };

/**
 * Loads data once and, if pollSeconds is given, keeps refreshing it while `active`.
 * Old data stays on screen during a refresh (no flicker).
 */
export function useAsync<T>(
  load: () => Promise<T>,
  deps: unknown[],
  opts: { pollSeconds?: number; active?: boolean } = {},
): AsyncState<T> {
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({
    loading: true,
  });
  const loadRef = useRef(load);
  loadRef.current = load;
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    loadRef.current().then(
      (data) => !cancelled && setState({ data, loading: false }),
      (error: unknown) =>
        !cancelled &&
        setState((s) => ({
          data: s.data,
          error: error instanceof Error ? error : new Error(String(error)),
          loading: false,
        })),
    );
    return () => {
      cancelled = true;
    };
  }, [...deps, tick]);

  const active = opts.active ?? true;
  useEffect(() => {
    if (!opts.pollSeconds || !active) return;
    const id = window.setInterval(reload, opts.pollSeconds * 1000);
    return () => window.clearInterval(id);
  }, [opts.pollSeconds, active, reload]);

  return { ...state, reload };
}

/** Minimal hash router: #/, #/runs/<id>, #/trend, #/releases */
export function useRoute(): string[] {
  const parse = () => window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export const navigate = (hash: string) => {
  window.location.hash = hash;
};
