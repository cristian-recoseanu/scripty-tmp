/**
 * E17.T2 — IS-04 resource builders.
 *
 * Constructs minimal-but-valid IS-04 v1.3 Node and Device resources from
 * adapter configuration. Both resources are immutable after construction.
 *
 * IS-04 spec refs:
 *   Node    — AMWA IS-04 §3.2.1  (https://specs.amwa.tv/is-04/releases/v1.3.2/docs/2.1._APIs_-_Common_Keys.html)
 *   Device  — AMWA IS-04 §3.2.2
 *   Control — AMWA IS-04 §3.1 control object definition
 */

import { randomUUID } from 'node:crypto';
import os from 'node:os';

import type { Is04Node, Is04Device, Is04DeviceControl, Is04Sender, Is04Receiver } from './types.js';

/** AMWA URN for the IS-12 NCP control type (IS-04 §8, IS-12 §5.1.1). */
export const NCP_CONTROL_TYPE = 'urn:x-nmos:control:ncp/v1.0';

/** AMWA URN for the generic device type. */
export const NMOS_DEVICE_TYPE = 'urn:x-nmos:device:generic';

// ---------------------------------------------------------------------------
// Timestamp helper
// ---------------------------------------------------------------------------

/**
 * Returns an IS-04 version timestamp in the form "<seconds>:<nanoseconds>".
 * This is a TAI-like epoch offset — we use Unix time as an approximation since
 * the exact TAI offset is environment-dependent.
 */
export function nowVersion(): string {
  const ms = Date.now();
  const sec = Math.floor(ms / 1000);
  const ns = (ms % 1000) * 1_000_000;
  return `${sec}:${ns}`;
}

// ---------------------------------------------------------------------------
// BuildNodeOptions
// ---------------------------------------------------------------------------

export interface BuildNodeOptions {
  /** Stable UUID for this node. Omit (or pass undefined) to auto-generate. */
  nodeId?: string | undefined;
  /** HTTP port on which the IS-04 Node API is served. */
  httpPort: number;
  /** Bind/advertised host for the Node API. */
  httpHost: string;
  /** Human-readable label. */
  label?: string | undefined;
  /** Human-readable description. */
  description?: string | undefined;
}

// ---------------------------------------------------------------------------
// buildIs04Node
// ---------------------------------------------------------------------------

/**
 * Constructs a minimal IS-04 v1.3 Node resource.
 * Nodes do not advertise media flow APIs — they only need the self API entry.
 */
export function buildIs04Node(opts: BuildNodeOptions): Is04Node {
  const nodeId = opts.nodeId ?? randomUUID();
  const host = resolveHost(opts.httpHost);
  const href = `http://${host}:${opts.httpPort}/x-nmos/node/v1.3/`;

  return {
    id: nodeId,
    version: nowVersion(),
    label: opts.label ?? 'protocol-bridge-node',
    description: opts.description ?? 'NMOS IS-12 Protocol Bridge node',
    tags: {},
    href,
    hostname: os.hostname(),
    caps: {},
    services: [],
    clocks: [{ name: 'clk0', ref_type: 'internal' }],
    interfaces: [],
    api: {
      versions: ['v1.3'],
      endpoints: [
        {
          host,
          port: opts.httpPort,
          protocol: 'http',
          authorization: false,
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// BuildDeviceOptions
// ---------------------------------------------------------------------------

export interface BuildDeviceOptions {
  /** Stable UUID for this device. Omit (or pass undefined) to auto-generate. */
  deviceId?: string | undefined;
  /** UUID of the owning IS-04 node. */
  nodeId: string;
  /** Human-readable label. */
  label?: string | undefined;
  /** Human-readable description. */
  description?: string | undefined;
  /** IS-12 WebSocket control endpoints to advertise in controls[]. */
  controls: Is04DeviceControl[];
  /** IS-04 sender resource ids advertised on this device. */
  senderIds?: string[] | undefined;
  /** IS-04 receiver resource ids advertised on this device. */
  receiverIds?: string[] | undefined;
}

// ---------------------------------------------------------------------------
// buildIs04Device
// ---------------------------------------------------------------------------

/**
 * Constructs a minimal IS-04 v1.3 Device resource.
 * Senders/receivers/sources/flows are empty (IS-12 only, no media flows).
 */
export function buildIs04Device(opts: BuildDeviceOptions): Is04Device {
  return {
    id: opts.deviceId ?? randomUUID(),
    version: nowVersion(),
    label: opts.label ?? 'protocol-bridge-device',
    description: opts.description ?? 'NMOS IS-12 Protocol Bridge device',
    tags: {},
    type: NMOS_DEVICE_TYPE,
    node_id: opts.nodeId,
    senders: opts.senderIds ?? [],
    receivers: opts.receiverIds ?? [],
    controls: opts.controls,
  };
}

// ---------------------------------------------------------------------------
// buildIs04Sender / buildIs04Receiver
// ---------------------------------------------------------------------------

export interface BuildSenderOptions {
  senderId?: string | undefined;
  flowId?: string | undefined;
  deviceId: string;
  label?: string | undefined;
  description?: string | undefined;
}

export interface BuildReceiverOptions {
  receiverId?: string | undefined;
  deviceId: string;
  label?: string | undefined;
  description?: string | undefined;
}

/** Minimal IS-04 v1.3 Sender resource for monitor touchpoint resolution. */
export function buildIs04Sender(opts: BuildSenderOptions): Is04Sender {
  return {
    id: opts.senderId ?? randomUUID(),
    version: nowVersion(),
    label: opts.label ?? 'protocol-bridge-sender',
    description: opts.description ?? '',
    tags: {},
    flow_id: opts.flowId ?? randomUUID(),
    transport: 'urn:x-nmos:transport:rtp',
    device_id: opts.deviceId,
    interface_bindings: [],
  };
}

/** Minimal IS-04 v1.3 Receiver resource for monitor touchpoint resolution. */
export function buildIs04Receiver(opts: BuildReceiverOptions): Is04Receiver {
  return {
    id: opts.receiverId ?? randomUUID(),
    version: nowVersion(),
    label: opts.label ?? 'protocol-bridge-receiver',
    description: opts.description ?? '',
    tags: {},
    format: 'urn:x-nmos:format:video',
    caps: {},
    device_id: opts.deviceId,
    transport_type: 'urn:x-nmos:transport:rtp',
    interface_bindings: [],
  };
}

// ---------------------------------------------------------------------------
// buildNcpControl
// ---------------------------------------------------------------------------

/**
 * Builds the IS-04 control object that advertises the IS-12 NCP WebSocket
 * endpoint (urn:x-nmos:control:ncp/v1.0).
 *
 * @param wsHost  - Advertised hostname/IP for the WS server.
 * @param wsPort  - Advertised WebSocket port (may differ from bind port when NAT is involved).
 * @param wsPath  - URI path the WebSocket endpoint is served on. Defaults to '/'.
 */
export function buildNcpControl(wsHost: string, wsPort: number, wsPath = '/'): Is04DeviceControl {
  const host = resolveHost(wsHost);
  const normPath = wsPath.startsWith('/') ? wsPath : `/${wsPath}`;
  return {
    type: NCP_CONTROL_TYPE,
    href: `ws://${host}:${wsPort}${normPath}`,
    authorization: false,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function resolveHost(host: string): string {
  if (host === '0.0.0.0' || host === '::') {
    return os.hostname();
  }
  return host;
}
