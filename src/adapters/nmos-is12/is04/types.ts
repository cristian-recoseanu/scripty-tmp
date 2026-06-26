/**
 * E17.T2 — AMWA IS-04 v1.3 resource types (TypeScript).
 *
 * Only the fields required for a minimal Node + Device + control advertisement
 * are captured here. Arrays for sources/flows/senders/receivers are always
 * empty in this implementation (IS-12 only, no media flows).
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** IS-04 API version string, e.g. "v1.3". */
export type Is04ApiVersion = `v${number}.${number}`;

/** AMWA URN for an IS-04 resource type used in registration. */
export type Is04ResourceType = 'node' | 'device' | 'source' | 'flow' | 'sender' | 'receiver';

// ---------------------------------------------------------------------------
// IS-04 API base / version list
// ---------------------------------------------------------------------------

export interface Is04VersionEntry {
  href: string;
}

// ---------------------------------------------------------------------------
// IS-04 Node resource (§3.2.1)
// ---------------------------------------------------------------------------

export interface Is04NodeService {
  href: string;
  type: string;
}

export interface Is04NodeApi {
  versions: string[];
  endpoints: Array<{ host: string; port: number; protocol: 'http' | 'https'; authorization: boolean }>;
}

export interface Is04NodeClocks {
  name: string;
  ref_type: 'internal' | 'ptp';
}

export interface Is04NodeInterface {
  name: string;
  chassis_id: string | null;
  port_id: string;
}

export interface Is04Node {
  id: string;
  version: string;
  label: string;
  description: string;
  tags: Record<string, string[]>;
  href: string;
  hostname: string | null;
  caps: Record<string, unknown>;
  services: Is04NodeService[];
  clocks: Is04NodeClocks[];
  interfaces: Is04NodeInterface[];
  api: Is04NodeApi;
}

// ---------------------------------------------------------------------------
// IS-04 Device resource (§3.2.2)
// ---------------------------------------------------------------------------

export interface Is04DeviceControl {
  /** AMWA URN identifying the control type, e.g. "urn:x-nmos:control:ncp/v1.0". */
  type: string;
  /** href of the control endpoint, e.g. "ws://192.168.1.2:9001/". */
  href: string;
  /** Whether the control endpoint requires IS-10 Bearer Token auth. */
  authorization: boolean;
}

export interface Is04Device {
  id: string;
  version: string;
  label: string;
  description: string;
  tags: Record<string, string[]>;
  type: string;
  node_id: string;
  senders: string[];
  receivers: string[];
  controls: Is04DeviceControl[];
}

// ---------------------------------------------------------------------------
// IS-04 Sender / Receiver resources (minimal stubs for touchpoint resolution)
// ---------------------------------------------------------------------------

export interface Is04Sender {
  id: string;
  version: string;
  label: string;
  description: string;
  tags: Record<string, string[]>;
  flow_id: string;
  transport: string;
  device_id: string;
  interface_bindings: string[];
}

export interface Is04Receiver {
  id: string;
  version: string;
  label: string;
  description: string;
  tags: Record<string, string[]>;
  format: string;
  caps: Record<string, unknown>;
  device_id: string;
  transport_type: string;
  interface_bindings: string[];
}

// ---------------------------------------------------------------------------
// IS-04 Registration API body wrapper (§4)
// ---------------------------------------------------------------------------

export interface Is04RegistrationBody<T> {
  type: Is04ResourceType;
  data: T;
}

// ---------------------------------------------------------------------------
// IS-04 Registration API heartbeat response (§4.3)
// ---------------------------------------------------------------------------

export interface Is04HeartbeatResponse {
  health: string;
}
