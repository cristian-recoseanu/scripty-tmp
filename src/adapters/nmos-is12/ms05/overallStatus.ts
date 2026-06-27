/**
 * BCP-008-01 / BCP-008-02 — derived overallStatus computation.
 *
 * overallStatus is not driven by MQTT; it is computed from domain statuses per spec.
 */

/** NcOverallStatus */
export const NcOverallStatus = {
  Inactive: 0,
  Healthy: 1,
  PartiallyHealthy: 2,
  Unhealthy: 3,
} as const;

export const RECEIVER_MONITOR_CLASS_ID = [1, 2, 2, 1] as const;
export const SENDER_MONITOR_CLASS_ID = [1, 2, 2, 2] as const;

/** Domain status property names that contribute to receiver overallStatus. */
export const RECEIVER_DOMAIN_STATUS_PROPS = [
  'linkStatus',
  'connectionStatus',
  'externalSynchronizationStatus',
  'streamStatus',
] as const;

/** Domain status property names that contribute to sender overallStatus. */
export const SENDER_DOMAIN_STATUS_PROPS = [
  'linkStatus',
  'transmissionStatus',
  'externalSynchronizationStatus',
  'essenceStatus',
] as const;

export type MonitorDomainValues = Record<string, unknown>;

function asStatusNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return fallback;
}

function classIdMatches(classId: readonly number[], prefix: readonly number[]): boolean {
  if (classId.length < prefix.length) return false;
  return prefix.every((v, i) => classId[i] === v);
}

export function isReceiverMonitorClassId(classId: readonly number[]): boolean {
  return classIdMatches(classId, RECEIVER_MONITOR_CLASS_ID);
}

export function isSenderMonitorClassId(classId: readonly number[]): boolean {
  return classIdMatches(classId, SENDER_MONITOR_CLASS_ID);
}

/**
 * BCP-008-01 §Receiver overall status — mirrors BCP0080101Test.check_overall_status.
 */
export function computeReceiverOverallStatus(values: MonitorDomainValues): number {
  const connection = asStatusNumber(values.connectionStatus);
  const stream = asStatusNumber(values.streamStatus);

  if (connection === 0 || stream === 0) {
    return NcOverallStatus.Inactive;
  }

  const domainValues = RECEIVER_DOMAIN_STATUS_PROPS.map((name) => asStatusNumber(values[name]));
  return Math.max(...domainValues);
}

/**
 * BCP-008-02 §Sender overall status — mirrors BCP0080201Test.check_overall_status.
 */
export function computeSenderOverallStatus(values: MonitorDomainValues): number {
  const transmission = asStatusNumber(values.transmissionStatus);
  const essence = asStatusNumber(values.essenceStatus);

  if (transmission === 0 || essence === 0) {
    return NcOverallStatus.Inactive;
  }

  const domainValues = SENDER_DOMAIN_STATUS_PROPS.map((name) => asStatusNumber(values[name]));
  return Math.max(...domainValues);
}

export function computeOverallStatusForClassId(
  classId: readonly number[],
  values: MonitorDomainValues,
): number | undefined {
  if (isReceiverMonitorClassId(classId)) return computeReceiverOverallStatus(values);
  if (isSenderMonitorClassId(classId)) return computeSenderOverallStatus(values);
  return undefined;
}

export function isDomainStatusProperty(
  classId: readonly number[],
  propertyName: string,
): boolean {
  if (isReceiverMonitorClassId(classId)) {
    return (RECEIVER_DOMAIN_STATUS_PROPS as readonly string[]).includes(propertyName);
  }
  if (isSenderMonitorClassId(classId)) {
    return (SENDER_DOMAIN_STATUS_PROPS as readonly string[]).includes(propertyName);
  }
  return false;
}
