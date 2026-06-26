/**
 * MS-05-02 / IS-12 core type definitions.
 *
 * Covers the full Phase-1 + E15 compliance surface:
 *   - NcPropertyId, NcMethodId, NcEventId
 *   - NcDatatypeDescriptor (Primitive / Struct)
 *   - NcClassDescriptor, NcPropertyDescriptor, NcMethodDescriptor
 *   - NcBlockMemberDescriptor
 *   - NcMethodResult, NcMethodResultError, NcMethodStatus (exact MS-05-02 codes)
 *   - NcPropertyChangeType (spec enum, integer values)
 *   - NcPropertyChangedEventData
 *   - IS-12 message wire types (Command, CommandResponse, Notification,
 *     Subscription, SubscriptionResponse, Error)
 *
 * All interfaces are plain data — no methods — so they serialize cleanly to JSON.
 */

// ---------------------------------------------------------------------------
// Fundamental identifiers
// ---------------------------------------------------------------------------

export interface NcPropertyId {
  readonly level: number;
  readonly index: number;
}

export interface NcMethodId {
  readonly level: number;
  readonly index: number;
}

export interface NcEventId {
  readonly level: number;
  readonly index: number;
}

export interface NcElementId {
  readonly level: number;
  readonly index: number;
}

// ---------------------------------------------------------------------------
// Datatype descriptors
// ---------------------------------------------------------------------------

export type NcDatatypeType = 'Primitive' | 'Struct' | 'Enum' | 'Typedef';

export interface NcEnumItemDescriptor {
  readonly name: string;
  readonly value: number;
  readonly description: string;
}

export interface NcFieldDescriptor {
  readonly name: string;
  readonly typeName: string | null;
  readonly isNullable: boolean;
  readonly isSequence: boolean;
  readonly constraints: null;
  readonly description: string;
}

export interface NcDatatypeDescriptorPrimitive {
  readonly type: 'Primitive';
  readonly name: string;
  readonly description: string;
  readonly constraints: null;
}

export interface NcDatatypeDescriptorStruct {
  readonly type: 'Struct';
  readonly name: string;
  readonly description: string;
  readonly fields: NcFieldDescriptor[];
  readonly parentType: string | null;
  readonly constraints: null;
}

export interface NcDatatypeDescriptorEnum {
  readonly type: 'Enum';
  readonly name: string;
  readonly description: string;
  readonly items: NcEnumItemDescriptor[];
  readonly constraints: null;
}

export interface NcDatatypeDescriptorTypedef {
  readonly type: 'Typedef';
  readonly name: string;
  readonly description: string;
  readonly parentType: string;
  readonly isSequence: boolean;
  readonly constraints: null;
}

export type NcDatatypeDescriptor =
  | NcDatatypeDescriptorPrimitive
  | NcDatatypeDescriptorStruct
  | NcDatatypeDescriptorEnum
  | NcDatatypeDescriptorTypedef;

// ---------------------------------------------------------------------------
// Class / property / method descriptors
// ---------------------------------------------------------------------------

export interface NcPropertyDescriptor {
  readonly id: NcPropertyId;
  readonly name: string;
  readonly typeName: string | null;
  readonly isReadOnly: boolean;
  readonly isNullable: boolean;
  readonly isSequence: boolean;
  readonly isDeprecated: boolean;
  readonly description: string;
  readonly constraints: null;
}

export interface NcParameterDescriptor {
  readonly name: string;
  readonly typeName: string | null;
  readonly isNullable: boolean;
  readonly isSequence: boolean;
  readonly description: string;
  readonly constraints: null;
}

export interface NcMethodDescriptor {
  readonly id: NcMethodId;
  readonly name: string;
  /** MS-05-02: NcMethodDescriptor.resultDatatype is NcName (isNullable: false). */
  readonly resultDatatype: string;
  readonly parameters: NcParameterDescriptor[];
  readonly isDeprecated: boolean;
  readonly description: string;
}

export interface NcEventDescriptor {
  readonly id: NcEventId;
  readonly name: string;
  readonly eventDatatype: string | null;
  readonly description: string;
  readonly isDeprecated: boolean;
}

export interface NcClassDescriptor {
  readonly classId: readonly number[];
  readonly name: string;
  readonly fixedRole: string | null;
  readonly description: string;
  readonly properties: NcPropertyDescriptor[];
  readonly methods: NcMethodDescriptor[];
  readonly events: NcEventDescriptor[];
}

// ---------------------------------------------------------------------------
// Method results
// ---------------------------------------------------------------------------

/** NcMethodStatus numeric codes — exact MS-05-02 §5.1 enumeration. */
export const NcMethodStatus = {
  Ok: 200,
  PropertyDeprecated: 298,
  MethodDeprecated: 299,
  BadCommandFormat: 400,
  Unauthorized: 401,
  BadOid: 404,
  Readonly: 405,
  InvalidRequest: 406,
  Conflict: 409,
  BufferOverflow: 413,
  IndexOutOfBounds: 414,
  ParameterError: 417,
  Locked: 423,
  DeviceError: 500,
  MethodNotImplemented: 501,
  PropertyNotImplemented: 502,
  NotReady: 503,
  Timeout: 504,
} as const;
export type NcMethodStatus = (typeof NcMethodStatus)[keyof typeof NcMethodStatus];

export interface NcMethodResult {
  readonly status: NcMethodStatus;
}

export interface NcMethodResultPropertyValue extends NcMethodResult {
  readonly value: unknown;
}

export interface NcMethodResultError extends NcMethodResult {
  readonly errorMessage: string;
}

export interface NcMethodResultId extends NcMethodResult {
  readonly id: number;
}

// ---------------------------------------------------------------------------
// NcPropertyChangeType — MS-05-02 §9 (integer enum on the wire)
// ---------------------------------------------------------------------------

export const NcPropertyChangeType = {
  ValueChanged: 0,
  SequenceItemAdded: 1,
  SequenceItemChanged: 2,
  SequenceItemRemoved: 3,
} as const;
export type NcPropertyChangeType = (typeof NcPropertyChangeType)[keyof typeof NcPropertyChangeType];

// ---------------------------------------------------------------------------
// NcBlockMemberDescriptor — MS-05-02 §7
// ---------------------------------------------------------------------------

export interface NcBlockMemberDescriptor {
  readonly oid: number;
  readonly constantOid: boolean;
  readonly classId: NcClassDescriptor['classId'];
  readonly role: string;
  readonly userLabel: string | null;
  readonly owner: number;
  readonly description: string;
  readonly constraints: null;
}

// ---------------------------------------------------------------------------
// Property-changed event data
// ---------------------------------------------------------------------------

export interface NcPropertyChangedEventData {
  readonly propertyId: NcPropertyId;
  readonly changeType: NcPropertyChangeType;
  readonly value: unknown;
  readonly sequenceItemIndex: number | null;
}

// ---------------------------------------------------------------------------
// IS-12 wire message types
// ---------------------------------------------------------------------------

export const IS12MessageType = {
  Command: 0,
  CommandResponse: 1,
  Notification: 2,
  Subscription: 3,
  SubscriptionResponse: 4,
  Error: 5,
} as const;
export type IS12MessageType = (typeof IS12MessageType)[keyof typeof IS12MessageType];

/** A single method call within a Command message. */
export interface NcCommandMessage {
  readonly handle: number;
  readonly oid: number;
  readonly methodId: NcMethodId;
  readonly arguments: Record<string, unknown>;
}

export interface IS12CommandMessage {
  readonly messageType: 0;
  readonly commands: NcCommandMessage[];
}

export interface NcCommandResponseMessage {
  readonly handle: number;
  readonly result: NcMethodResult | NcMethodResultPropertyValue | NcMethodResultError;
}

export interface IS12CommandResponseMessage {
  readonly messageType: 1;
  readonly responses: NcCommandResponseMessage[];
}

export interface NcNotificationMessage {
  readonly oid: number;
  readonly eventId: NcEventId;
  readonly eventData: NcPropertyChangedEventData;
}

export interface IS12NotificationMessage {
  readonly messageType: 2;
  readonly notifications: NcNotificationMessage[];
}

export interface IS12SubscriptionMessage {
  readonly messageType: 3;
  readonly subscriptions: number[];
}

export interface IS12SubscriptionResponseMessage {
  readonly messageType: 4;
  readonly subscriptions: number[];
}

export interface IS12ErrorMessage {
  readonly messageType: 5;
  readonly status: NcMethodStatus;
  readonly errorMessage: string;
}

export type IS12Message =
  | IS12CommandMessage
  | IS12CommandResponseMessage
  | IS12NotificationMessage
  | IS12SubscriptionMessage
  | IS12SubscriptionResponseMessage
  | IS12ErrorMessage;
