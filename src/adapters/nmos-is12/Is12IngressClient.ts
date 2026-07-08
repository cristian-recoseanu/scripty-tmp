/**
 * E21.T2 — Production IS-12 WebSocket client (NCP controller role).
 *
 * Connects outbound to a remote IS-12 device. Used by Is12IngressAdapter.
 */

import WebSocket from 'ws';

import { IS12MessageType } from './ms05/types.js';

import type {
  IS12CommandMessage,
  IS12CommandResponseMessage,
  IS12NotificationMessage,
  IS12SubscriptionMessage,
  IS12SubscriptionResponseMessage,
  NcMethodId,
} from './ms05/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Is12IngressCommandArgs {
  oid: number;
  methodId: NcMethodId;
  arguments: Record<string, unknown>;
  handle?: number;
}

export type Is12IngressClientHandlers = {
  onNotification?: (msg: IS12NotificationMessage) => void;
  onDisconnect?: () => void;
  onError?: (err: Error) => void;
};

// ---------------------------------------------------------------------------
// Is12IngressClient
// ---------------------------------------------------------------------------

export class Is12IngressClient {
  private readonly _ws: WebSocket;
  private _nextHandle = 1;
  private readonly _pending = new Map<number, (resp: IS12CommandResponseMessage) => void>();
  private _subResponseWaiter: ((r: IS12SubscriptionResponseMessage) => void) | null = null;
  private readonly _handlers: Is12IngressClientHandlers;

  private constructor(ws: WebSocket, handlers: Is12IngressClientHandlers) {
    this._ws = ws;
    this._handlers = handlers;
    ws.on('message', (data: Buffer | string) => {
      const msg = JSON.parse(data.toString()) as
        | IS12CommandResponseMessage
        | IS12NotificationMessage
        | IS12SubscriptionResponseMessage;
      this._dispatch(msg);
    });
    ws.on('close', () => {
      this._handlers.onDisconnect?.();
    });
    ws.on('error', (err: Error) => {
      this._handlers.onError?.(err);
    });
  }

  /** Open a client connected to the given WebSocket URL. */
  static connect(
    wsUrl: string,
    handlers: Is12IngressClientHandlers = {},
    timeoutMs = 10_000,
  ): Promise<Is12IngressClient> {
    return new Promise<Is12IngressClient>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error(`Is12IngressClient: connection to '${wsUrl}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      ws.once('open', () => {
        clearTimeout(timer);
        resolve(new Is12IngressClient(ws, handlers));
      });
      ws.once('error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  get connected(): boolean {
    return this._ws.readyState === WebSocket.OPEN;
  }

  command(
    cmd: Is12IngressCommandArgs,
    timeoutMs = 5000,
  ): Promise<IS12CommandResponseMessage> {
    const handle = cmd.handle ?? this._nextHandle++;
    const msg: IS12CommandMessage = {
      messageType: IS12MessageType.Command,
      commands: [{ handle, oid: cmd.oid, methodId: cmd.methodId, arguments: cmd.arguments }],
    };
    return new Promise<IS12CommandResponseMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(handle);
        reject(new Error(`Is12IngressClient: no CommandResponse for handle ${handle} within ${timeoutMs}ms`));
      }, timeoutMs);
      this._pending.set(handle, (resp) => {
        clearTimeout(timer);
        resolve(resp);
      });
      this._ws.send(JSON.stringify(msg));
    });
  }

  subscribe(oids: number[], timeoutMs = 5000): Promise<IS12SubscriptionResponseMessage> {
    const msg: IS12SubscriptionMessage = {
      messageType: IS12MessageType.Subscription,
      subscriptions: oids,
    };
    return new Promise<IS12SubscriptionResponseMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._subResponseWaiter = null;
        reject(new Error(`Is12IngressClient: no SubscriptionResponse within ${timeoutMs}ms`));
      }, timeoutMs);
      this._subResponseWaiter = (resp) => {
        clearTimeout(timer);
        resolve(resp);
      };
      this._ws.send(JSON.stringify(msg));
    });
  }

  close(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this._ws.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      this._ws.once('close', () => resolve());
      this._ws.close();
    });
  }

  private _dispatch(
    msg: IS12CommandResponseMessage | IS12NotificationMessage | IS12SubscriptionResponseMessage,
  ): void {
    switch (msg.messageType) {
      case IS12MessageType.CommandResponse: {
        for (const r of msg.responses) {
          const waiter = this._pending.get(r.handle);
          if (waiter !== undefined) {
            this._pending.delete(r.handle);
            waiter(msg);
          }
        }
        break;
      }
      case IS12MessageType.Notification:
        this._handlers.onNotification?.(msg);
        break;
      case IS12MessageType.SubscriptionResponse: {
        if (this._subResponseWaiter !== null) {
          const w = this._subResponseWaiter;
          this._subResponseWaiter = null;
          w(msg);
        }
        break;
      }
      default:
        break;
    }
  }
}
