import { VaultEvent, WS_PING, WS_PROTOCOL } from "@vault-sync/protocol";
import { useEffect, useState } from "react";

export type LiveState = "connecting" | "live" | "offline";

const PING_MS = 30_000;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 60_000;
const MAX_FAILED_CONNECTS = 5;
const CHANGE_DEBOUNCE_MS = 1500;
const CLOSE_REVOKED = 4001;

interface Live {
  readonly revision: number;
  readonly state: LiveState;
}

interface Connection {
  stopped: boolean;
  socket: WebSocket | null;
  failures: number;
  ping?: ReturnType<typeof setInterval>;
  retry?: ReturnType<typeof setTimeout>;
  debounce?: ReturnType<typeof setTimeout>;
}

function socketUrl(): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/api/vault/ws`;
}

function isChange(data: unknown): boolean {
  if (typeof data !== "string") return false;
  try {
    return VaultEvent.safeParse(JSON.parse(data)).success;
  } catch {
    return false;
  }
}

function stop(conn: Connection): void {
  conn.stopped = true;
  clearInterval(conn.ping);
  clearTimeout(conn.retry);
  clearTimeout(conn.debounce);
  conn.socket?.close(1000, "leaving");
}

export function useLiveRevision(): Live {
  const [live, setLive] = useState<Live>({ revision: 0, state: "connecting" });

  useEffect(() => {
    const conn: Connection = { stopped: false, socket: null, failures: 0 };
    const bump = () => {
      setLive((prev) => ({ ...prev, revision: prev.revision + 1 }));
    };

    const connect = () => {
      const socket = new WebSocket(socketUrl(), WS_PROTOCOL);
      let opened = false;
      conn.socket = socket;
      const current = () => !conn.stopped && conn.socket === socket;
      socket.addEventListener("open", () => {
        if (!current()) return;
        opened = true;
        conn.failures = 0;
        setLive((prev) => ({ revision: prev.revision + 1, state: "live" }));
        conn.ping = setInterval(() => {
          socket.send(WS_PING);
        }, PING_MS);
      });
      socket.addEventListener("message", (event) => {
        if (!current() || !isChange(event.data)) return;
        clearTimeout(conn.debounce);
        conn.debounce = setTimeout(bump, CHANGE_DEBOUNCE_MS);
      });
      socket.addEventListener("close", (event) => {
        if (!current()) return;
        clearInterval(conn.ping);
        setLive((prev) => ({ ...prev, state: "offline" }));
        conn.failures = opened ? 0 : conn.failures + 1;
        if (event.code === CLOSE_REVOKED || conn.failures >= MAX_FAILED_CONNECTS) return;
        conn.retry = setTimeout(connect, Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (conn.failures + 1)));
      });
    };

    connect();
    return () => {
      stop(conn);
    };
  }, []);

  return live;
}
