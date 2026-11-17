import { ChangedEvent, WS_PING, WS_PONG, WS_PROTOCOL } from "@vault-sync/protocol";

import { LIVE_MAX_BACKOFF_MS, LIVE_PING_MS } from "../constants.ts";

const BASE_RECONNECT_MS = 1000;
const STABLE_AFTER_MS = 30_000;
const REVOKED = 4001;
const PONG_GRACE = 2;

export interface LiveHooks {
  readonly onRemoteChange: () => void;
  readonly onStatus: (message: string) => void;
  readonly stillAllowed: () => Promise<boolean>;
}

export interface LiveTarget {
  readonly url: string;
  readonly vaultId: string;
  readonly deviceId: string;
  readonly token: string;
}

function socketUrl(target: LiveTarget): string {
  const url = new URL(`/v1/vaults/${target.vaultId}/ws`, target.url);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function parseEvent(data: unknown): ChangedEvent | null {
  if (typeof data !== "string") return null;
  try {
    const parsed = ChangedEvent.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export class LiveConnection {
  private socket: WebSocket | null = null;
  private ping: ReturnType<typeof setTimeout> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  private openedAt = 0;
  private lastPong = 0;
  private stopped = false;
  private readonly target: LiveTarget;
  private readonly hooks: LiveHooks;

  constructor(target: LiveTarget, hooks: LiveHooks) {
    this.target = target;
    this.hooks = hooks;
  }

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.ping);
    clearTimeout(this.retry);
    this.socket?.close();
  }

  private open(): void {
    const socket = new WebSocket(socketUrl(this.target), [WS_PROTOCOL, this.target.token]);
    this.socket = socket;
    this.openedAt = 0;
    socket.addEventListener("open", () => {
      this.onOpen(socket);
    });
    socket.addEventListener("message", (event) => {
      this.onMessage(event.data);
    });
    socket.addEventListener("close", (event) => {
      void this.onClose(event.code);
    });
  }

  private onOpen(socket: WebSocket): void {
    this.openedAt = Date.now();
    this.lastPong = this.openedAt;
    this.hooks.onStatus("live updates connected");
    this.hooks.onRemoteChange();
    this.ping = setInterval(() => {
      if (Date.now() - this.lastPong > PONG_GRACE * LIVE_PING_MS) socket.close();
      else socket.send(WS_PING);
    }, LIVE_PING_MS);
  }

  private onMessage(data: unknown): void {
    if (data === WS_PONG) {
      this.lastPong = Date.now();
      return;
    }
    const event = parseEvent(data);
    if (event && event.deviceId !== this.target.deviceId) this.hooks.onRemoteChange();
  }

  private async onClose(code: number): Promise<void> {
    clearInterval(this.ping);
    this.socket = null;
    if (this.stopped) return;
    if (this.openedAt !== 0 && Date.now() - this.openedAt > STABLE_AFTER_MS) this.attempts = 0;
    const neverOpened = this.openedAt === 0;
    if (code === REVOKED || (neverOpened && !(await this.hooks.stillAllowed()))) {
      this.hooks.onStatus("this device is no longer allowed; live updates stopped");
      return;
    }
    this.attempts += 1;
    const backoff = Math.min(BASE_RECONNECT_MS * 2 ** (this.attempts - 1), LIVE_MAX_BACKOFF_MS);
    const delay = backoff * (0.5 + Math.random());
    this.hooks.onStatus(`live updates disconnected; retrying in ${Math.round(delay / 1000)} s`);
    this.retry = setTimeout(() => {
      this.open();
    }, delay);
  }
}
