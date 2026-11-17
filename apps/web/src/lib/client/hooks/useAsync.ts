import { useCallback, useEffect, useEffectEvent, useState } from "react";

export interface AsyncState<T> {
  readonly data: T | null;
  readonly error: Error | null;
  readonly loading: boolean;
  readonly refresh: () => void;
}

interface Settled<T> {
  readonly key: string;
  readonly nonce: string;
  readonly data: T | null;
  readonly error: Error | null;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Something went wrong. Try again.");
}

export function useAsync<T>(load: (signal: AbortSignal) => Promise<T>, key: string, revision = 0): AsyncState<T> {
  const [settled, setSettled] = useState<Settled<T>>({ key: "", nonce: "", data: null, error: null });
  const [manual, setManual] = useState(0);
  const nonce = `${revision}:${manual}`;
  const run = useEffectEvent(load);

  useEffect(() => {
    const controller = new AbortController();
    const settle = async () => {
      try {
        const data = await run(controller.signal);
        if (!controller.signal.aborted) setSettled({ key, nonce, data, error: null });
      } catch (error) {
        if (controller.signal.aborted) return;
        setSettled((prev) => ({ key, nonce, data: prev.key === key ? prev.data : null, error: toError(error) }));
      }
    };
    void settle();
    return () => {
      controller.abort();
    };
  }, [key, nonce]);

  const refresh = useCallback(() => {
    setManual((n) => n + 1);
  }, []);

  const sameKey = settled.key === key;
  return {
    data: sameKey ? settled.data : null,
    error: sameKey ? settled.error : null,
    loading: !sameKey || settled.nonce !== nonce,
    refresh,
  };
}
