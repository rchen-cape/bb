import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import {
  USAGE_REALTIME_CHANNEL,
  type AiHubRpcContract,
} from "../src/contract.js";

export type AiHubRpc = ReturnType<typeof useRpc<AiHubRpcContract>>;

export const REALTIME_REFRESH_MIN_MS = 10_000;

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface QueryState<T> {
  data: T | null;
  dataKey: string | null;
  error: string | null;
  loading: boolean;
}

export interface AiHubQuery<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  stale: boolean;
  refresh: () => void;
}

export function useAiHubQuery<T>(
  key: string,
  run: (rpc: AiHubRpc) => Promise<T>,
): AiHubQuery<T> {
  const rpc = useRpc<AiHubRpcContract>();
  const [state, setState] = useState<QueryState<T>>({
    data: null,
    dataKey: null,
    error: null,
    loading: true,
  });
  const runRef = useRef(run);
  const keyRef = useRef(key);
  const requestRef = useRef(0);
  const inFlightRef = useRef(false);
  const queuedRef = useRef(false);

  useLayoutEffect(() => {
    runRef.current = run;
    keyRef.current = key;
  });

  const start = useCallback(() => {
    const launch = () => {
      const requestId = ++requestRef.current;
      const requestKey = keyRef.current;
      inFlightRef.current = true;
      queuedRef.current = false;
      setState((previous) =>
        previous.loading ? previous : { ...previous, loading: true },
      );
      const settle = (next: (previous: QueryState<T>) => QueryState<T>) => {
        if (requestRef.current !== requestId) return;
        inFlightRef.current = false;
        setState(next);
        if (queuedRef.current) launch();
      };
      runRef.current(rpc).then(
        (data) =>
          settle(() => ({
            data,
            dataKey: requestKey,
            error: null,
            loading: false,
          })),
        (cause: unknown) =>
          settle((previous) => ({
            ...previous,
            error: errorMessage(cause),
            loading: false,
          })),
      );
    };
    launch();
  }, [rpc]);

  const refresh = useCallback(() => {
    if (inFlightRef.current) {
      queuedRef.current = true;
      return;
    }
    start();
  }, [start]);

  useEffect(() => {
    start();
  }, [key, start]);

  const lastRealtimeRefreshRef = useRef<number | null>(null);
  const realtimeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (realtimeTimerRef.current !== null) {
        clearTimeout(realtimeTimerRef.current);
      }
    },
    [],
  );
  useRealtime(USAGE_REALTIME_CHANNEL, () => {
    if (realtimeTimerRef.current !== null) return;
    const now = Date.now();
    const last = lastRealtimeRefreshRef.current;
    const wait =
      last === null ? 0 : Math.max(0, last + REALTIME_REFRESH_MIN_MS - now);
    if (wait === 0) {
      lastRealtimeRefreshRef.current = now;
      refresh();
      return;
    }
    realtimeTimerRef.current = setTimeout(() => {
      realtimeTimerRef.current = null;
      lastRealtimeRefreshRef.current = Date.now();
      refresh();
    }, wait);
  });

  const connection = useRealtimeConnectionState();
  const previousConnectionRef = useRef(connection);
  useEffect(() => {
    const previous = previousConnectionRef.current;
    previousConnectionRef.current = connection;
    if (connection === "connected" && previous !== "connected") refresh();
  }, [connection, refresh]);

  return {
    data: state.data,
    error: state.error,
    loading: state.loading,
    stale: state.data !== null && state.dataKey !== key,
    refresh,
  };
}
