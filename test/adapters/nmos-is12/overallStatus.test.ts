/**
 * Unit tests for BCP-008-01/02 derived overallStatus computation.
 */

import { describe, it, expect } from 'vitest';

import {
  computeReceiverOverallStatus,
  computeSenderOverallStatus,
  NcOverallStatus,
} from '../../../src/adapters/nmos-is12/ms05/overallStatus.js';

describe('overallStatus derivation', () => {
  it('receiver: Inactive when connectionStatus is Inactive', () => {
    const v = computeReceiverOverallStatus({
      linkStatus: 1,
      connectionStatus: 0,
      externalSynchronizationStatus: 0,
      streamStatus: 1,
    });
    expect(v).toBe(NcOverallStatus.Inactive);
  });

  it('receiver: Inactive when streamStatus is Inactive', () => {
    const v = computeReceiverOverallStatus({
      linkStatus: 1,
      connectionStatus: 1,
      externalSynchronizationStatus: 0,
      streamStatus: 0,
    });
    expect(v).toBe(NcOverallStatus.Inactive);
  });

  it('receiver: least-healthy when active', () => {
    const v = computeReceiverOverallStatus({
      linkStatus: 1,
      connectionStatus: 2,
      externalSynchronizationStatus: 0,
      streamStatus: 1,
    });
    expect(v).toBe(NcOverallStatus.PartiallyHealthy);
  });

  it('sender: Inactive when transmissionStatus is Inactive', () => {
    const v = computeSenderOverallStatus({
      linkStatus: 1,
      transmissionStatus: 0,
      externalSynchronizationStatus: 0,
      essenceStatus: 1,
    });
    expect(v).toBe(NcOverallStatus.Inactive);
  });

  it('sender: Inactive when essenceStatus is Inactive', () => {
    const v = computeSenderOverallStatus({
      linkStatus: 1,
      transmissionStatus: 1,
      externalSynchronizationStatus: 0,
      essenceStatus: 0,
    });
    expect(v).toBe(NcOverallStatus.Inactive);
  });

  it('sender: least-healthy when active', () => {
    const v = computeSenderOverallStatus({
      linkStatus: 1,
      transmissionStatus: 1,
      externalSynchronizationStatus: 3,
      essenceStatus: 1,
    });
    expect(v).toBe(NcOverallStatus.Unhealthy);
  });
});
