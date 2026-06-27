/**
 * E12.T4 — Record & replay.
 *
 * Recorder: subscribes to the UCE bus and appends each op as a JSON line
 *           to a file (newline-delimited JSON / NDJSON).
 *
 * Replayer: reads an NDJSON file and re-publishes each op onto a bus,
 *           allowing deterministic re-runs from a captured session.
 *
 * File format: one JSON-serialised Operation per line (NDJSON).
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';

import type { Operation } from '../engine/bus/operations.js';
import type { UceBus, Subscription } from '../engine/bus/UceBus.js';
import type { WriteStream } from 'node:fs';

// ---------------------------------------------------------------------------
// Recorder
// ---------------------------------------------------------------------------

export class Recorder {
  private _sub: Subscription | undefined;
  private _stream: WriteStream | undefined;
  private _count = 0;

  /**
   * Open the output file and subscribe to the bus.
   * Appends if the file already exists.
   */
  start(bus: UceBus, filePath: string): void {
    if (this._sub !== undefined) return;
    this._stream = createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
    this._sub = bus.subscribe({}, (op) => {
      this._write(op);
    });
  }

  /**
   * Unsubscribe from bus and close the file stream.
   * Returns a Promise that resolves once the stream is fully flushed & closed.
   */
  stop(): Promise<void> {
    this._sub?.unsubscribe();
    this._sub = undefined;
    return new Promise<void>((resolve, reject) => {
      if (this._stream === undefined) {
        resolve();
        return;
      }
      this._stream.end((err: Error | null | undefined) => {
        this._stream = undefined;
        if (err != null) reject(err);
        else resolve();
      });
    });
  }

  /** Number of ops written so far. */
  get recordedCount(): number {
    return this._count;
  }

  get isRecording(): boolean {
    return this._sub !== undefined;
  }

  private _write(op: Operation): void {
    this._stream?.write(JSON.stringify(op) + '\n');
    this._count++;
  }
}

// ---------------------------------------------------------------------------
// Replayer
// ---------------------------------------------------------------------------

export class Replayer {
  /**
   * Read an NDJSON file and publish each op onto the bus in order.
   * Returns the number of ops replayed.
   *
   * @param bus       — Target bus to publish onto.
   * @param filePath  — Path to the NDJSON file written by Recorder.
   * @param delayMs   — Optional per-op delay in milliseconds (default 0).
   */
  async replay(bus: UceBus, filePath: string, delayMs = 0): Promise<number> {
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    let count = 0;

    for await (const line of rl) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;

      const op = JSON.parse(trimmed) as Operation;
      bus.publish(op);
      count++;

      if (delayMs > 0) {
        await new Promise<void>((r) => setTimeout(r, delayMs));
      }
    }

    return count;
  }
}
