/**
 * E14.T3 — Typed IS-12 WebSocket test client.
 *
 * A lightweight wrapper around a raw WebSocket that:
 *   - Sends typed IS-12 messages (Command, Subscription)
 *   - Returns typed responses (CommandResponse, SubscriptionResponse, Notification)
 *   - Supports waiting for the next message of any type, or a specific messageType
 *
 * Usage:
 *   const client = await Is12Client.connect(port);
 *   const resp = await client.command({ oid: 1, methodId: NC_OBJECT_METHOD.Get, arguments: { id: ... } });
 *   await client.subscribe([1]);
 *   const notif = await client.nextNotification();
 *   await client.close();
 */

import WebSocket from 'ws';

import { IS12MessageType } from '../../src/adapters/nmos-is12/ms05/types.js';

import type {
  IS12CommandMessage,
  IS12CommandResponseMessage,
  IS12NotificationMessage,
  IS12SubscriptionMessage,
  IS12SubscriptionResponseMessage,
  NcMethodId,
} from '../../src/adapters/nmos-is12/ms05/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommandArgs {
  oid: number;
  methodId: NcMethodId;
  arguments: Record<string, unknown>;
  handle?: number;
}

export type AnyIS12Message =
  | IS12CommandResponseMessage
  | IS12SubscriptionResponseMessage
  | IS12NotificationMessage;

// ---------------------------------------------------------------------------
// Is12Client
// ---------------------------------------------------------------------------

export class Is12Client {
  private readonly _ws: WebSocket;
  private _nextHandle = 1;
  private readonly _pending = new Map<
    number,
    (resp: IS12CommandResponseMessage) => void
  >();
  private readonly _notifQueue: IS12NotificationMessage[] = [];
  private _notifWaiter: ((n: IS12NotificationMessage) => void) | null = null;
  private _subResponseWaiter: ((r: IS12SubscriptionResponseMessage) => void) | null = null;
  private readonly _rawQueue: string[] = [];
  private _rawWaiter: ((raw: string) => void) | null = null;

  private constructor(ws: WebSocket) {
    this._ws = ws;
    ws.on('message', (data: Buffer | string) => {
      const raw = data.toString();
      const msg = JSON.parse(raw) as AnyIS12Message;
      this._dispatchRaw(raw);
      this._dispatch(msg);
    });
  }

  /** Open a new client connected to ws://127.0.0.1:<port>. */
  static connect(port: number): Promise<Is12Client> {
    return new Promise<Is12Client>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.once('open', () => resolve(new Is12Client(ws)));
      ws.once('error', (err: Error) => reject(err));
    });
  }

  /** Send one or more Get/Set commands and resolve with the CommandResponse. */
  command(cmd: CommandArgs, timeoutMs = 5000): Promise<IS12CommandResponseMessage> {
    const handle = cmd.handle ?? this._nextHandle++;
    const msg: IS12CommandMessage = {
      messageType: IS12MessageType.Command,
      commands: [{ handle, oid: cmd.oid, methodId: cmd.methodId, arguments: cmd.arguments }],
    };
    return new Promise<IS12CommandResponseMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(handle);
        reject(new Error(`Is12Client: no CommandResponse for handle ${handle} within ${timeoutMs}ms`));
      }, timeoutMs);
      this._pending.set(handle, (resp) => { clearTimeout(timer); resolve(resp); });
      this._ws.send(JSON.stringify(msg));
    });
  }

  /** Subscribe to a list of oids and resolve when SubscriptionResponse arrives. */
  subscribe(oids: number[], timeoutMs = 5000): Promise<IS12SubscriptionResponseMessage> {
    const msg: IS12SubscriptionMessage = {
      messageType: IS12MessageType.Subscription,
      subscriptions: oids,
    };
    return new Promise<IS12SubscriptionResponseMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._subResponseWaiter = null;
        reject(new Error(`Is12Client: no SubscriptionResponse within ${timeoutMs}ms`));
      }, timeoutMs);
      this._subResponseWaiter = (resp) => { clearTimeout(timer); resolve(resp); };
      this._ws.send(JSON.stringify(msg));
    });
  }

  /**
   * Resolves with the next Notification message received.
   * Rejects after `timeoutMs` if none arrives.
   */
  nextNotification(timeoutMs = 500): Promise<IS12NotificationMessage> {
    if (this._notifQueue.length > 0) {
      return Promise.resolve(this._notifQueue.shift()!);
    }
    return new Promise<IS12NotificationMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._notifWaiter = null;
        reject(new Error(`Is12Client: no Notification received within ${timeoutMs}ms`));
      }, timeoutMs);
      this._notifWaiter = (n) => {
        clearTimeout(timer);
        resolve(n);
      };
    });
  }

  /** Send a raw string frame — bypasses typed message wrappers. */
  sendRaw(raw: string): void {
    this._ws.send(raw);
  }

  /**
   * Resolves with the next raw WebSocket frame received (as a string).
   * Rejects after `timeoutMs` if none arrives.
   */
  nextRawMessage(timeoutMs = 500): Promise<string> {
    if (this._rawQueue.length > 0) {
      return Promise.resolve(this._rawQueue.shift()!);
    }
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._rawWaiter = null;
        reject(new Error(`Is12Client: no raw message received within ${timeoutMs}ms`));
      }, timeoutMs);
      this._rawWaiter = (raw) => { clearTimeout(timer); resolve(raw); };
    });
  }

  /** Close the WebSocket connection. */
  close(): Promise<void> {
    return new Promise<void>((resolve) => {
      this._ws.once('close', () => resolve());
      this._ws.close();
    });
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _dispatchRaw(raw: string): void {
    if (this._rawWaiter !== null) {
      const w = this._rawWaiter;
      this._rawWaiter = null;
      w(raw);
    } else {
      this._rawQueue.push(raw);
    }
  }

  private _dispatch(msg: AnyIS12Message): void {
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
      case IS12MessageType.Notification: {
        if (this._notifWaiter !== null) {
          const w = this._notifWaiter;
          this._notifWaiter = null;
          w(msg);
        } else {
          this._notifQueue.push(msg);
        }
        break;
      }
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
