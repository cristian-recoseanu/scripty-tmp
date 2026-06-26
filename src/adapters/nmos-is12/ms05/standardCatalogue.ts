/**
 * Standard MS-05-02 class and datatype descriptors.
 *
 * Sourced verbatim from:
 *   https://github.com/AMWA-TV/ms-05-02/tree/v1.0.x/models/classes
 *   https://github.com/AMWA-TV/ms-05-02/tree/v1.0.x/models/datatypes
 *
 * The ClassManager MUST expose these alongside any user-defined entries so
 * the AMWA test suite can validate the full device model.
 */

import type { NcClassDescriptor, NcDatatypeDescriptor } from './types.js';

// ---------------------------------------------------------------------------
// Standard class descriptors — one per class file in models/classes/
// ---------------------------------------------------------------------------

export const STANDARD_CLASS_DESCRIPTORS: NcClassDescriptor[] = [
  // 1.json — NcObject
  {
    classId: [1],
    name: 'NcObject',
    fixedRole: null,
    description: 'NcObject class descriptor',
    properties: [
      { id: { level: 1, index: 1 }, name: 'classId', typeName: 'NcClassId', isReadOnly: true, isNullable: false, isSequence: false, isDeprecated: false, description: 'Static value. All instances of the same class will have the same identity value', constraints: null },
      { id: { level: 1, index: 2 }, name: 'oid', typeName: 'NcOid', isReadOnly: true, isNullable: false, isSequence: false, isDeprecated: false, description: 'Object identifier', constraints: null },
      { id: { level: 1, index: 3 }, name: 'constantOid', typeName: 'NcBoolean', isReadOnly: true, isNullable: false, isSequence: false, isDeprecated: false, description: 'TRUE iff OID is hardwired into device', constraints: null },
      { id: { level: 1, index: 4 }, name: 'owner', typeName: 'NcOid', isReadOnly: true, isNullable: true, isSequence: false, isDeprecated: false, description: 'OID of containing block. Can only ever be null for the root block', constraints: null },
      { id: { level: 1, index: 5 }, name: 'role', typeName: 'NcString', isReadOnly: true, isNullable: false, isSequence: false, isDeprecated: false, description: 'Role of object in the containing block', constraints: null },
      { id: { level: 1, index: 6 }, name: 'userLabel', typeName: 'NcString', isReadOnly: false, isNullable: true, isSequence: false, isDeprecated: false, description: 'Scribble strip', constraints: null },
      { id: { level: 1, index: 7 }, name: 'touchpoints', typeName: 'NcTouchpoint', isReadOnly: true, isNullable: true, isSequence: true, isDeprecated: false, description: 'Touchpoints to other contexts', constraints: null },
      { id: { level: 1, index: 8 }, name: 'runtimePropertyConstraints', typeName: 'NcPropertyConstraints', isReadOnly: true, isNullable: true, isSequence: true, isDeprecated: false, description: 'Runtime property constraints', constraints: null },
    ],
    methods: [
      { id: { level: 1, index: 1 }, name: 'Get', resultDatatype: 'NcMethodResultPropertyValue', parameters: [{ name: 'id', typeName: 'NcPropertyId', isNullable: false, isSequence: false, description: 'Property id', constraints: null }], isDeprecated: false, description: 'Get property value' },
      { id: { level: 1, index: 2 }, name: 'Set', resultDatatype: 'NcMethodResult', parameters: [{ name: 'id', typeName: 'NcPropertyId', isNullable: false, isSequence: false, description: 'Property id', constraints: null }, { name: 'value', typeName: null, isNullable: true, isSequence: false, description: 'Property value', constraints: null }], isDeprecated: false, description: 'Set property value' },
      { id: { level: 1, index: 3 }, name: 'GetSequenceItem', resultDatatype: 'NcMethodResultPropertyValue', parameters: [{ name: 'id', typeName: 'NcPropertyId', isNullable: false, isSequence: false, description: 'Property id', constraints: null }, { name: 'index', typeName: 'NcId', isNullable: false, isSequence: false, description: 'Index of item in the sequence', constraints: null }], isDeprecated: false, description: 'Get sequence item' },
      { id: { level: 1, index: 4 }, name: 'SetSequenceItem', resultDatatype: 'NcMethodResult', parameters: [{ name: 'id', typeName: 'NcPropertyId', isNullable: false, isSequence: false, description: 'Property id', constraints: null }, { name: 'index', typeName: 'NcId', isNullable: false, isSequence: false, description: 'Index of item in the sequence', constraints: null }, { name: 'value', typeName: null, isNullable: true, isSequence: false, description: 'Value', constraints: null }], isDeprecated: false, description: 'Set sequence item value' },
      { id: { level: 1, index: 5 }, name: 'AddSequenceItem', resultDatatype: 'NcMethodResultId', parameters: [{ name: 'id', typeName: 'NcPropertyId', isNullable: false, isSequence: false, description: 'Property id', constraints: null }, { name: 'value', typeName: null, isNullable: true, isSequence: false, description: 'Value', constraints: null }], isDeprecated: false, description: 'Add item to sequence' },
      { id: { level: 1, index: 6 }, name: 'RemoveSequenceItem', resultDatatype: 'NcMethodResult', parameters: [{ name: 'id', typeName: 'NcPropertyId', isNullable: false, isSequence: false, description: 'Property id', constraints: null }, { name: 'index', typeName: 'NcId', isNullable: false, isSequence: false, description: 'Index of item in the sequence', constraints: null }], isDeprecated: false, description: 'Delete sequence item' },
      { id: { level: 1, index: 7 }, name: 'GetSequenceLength', resultDatatype: 'NcMethodResultLength', parameters: [{ name: 'id', typeName: 'NcPropertyId', isNullable: false, isSequence: false, description: 'Property id', constraints: null }], isDeprecated: false, description: 'Get sequence length' },
    ],
    events: [
      { id: { level: 1, index: 1 }, name: 'PropertyChanged', eventDatatype: 'NcPropertyChangedEventData', isDeprecated: false, description: 'Property changed event' },
    ],
  },

  // 1.1.json — NcBlock
  {
    classId: [1, 1],
    name: 'NcBlock',
    fixedRole: null,
    description: 'NcBlock class descriptor',
    properties: [
      { id: { level: 2, index: 1 }, name: 'enabled', typeName: 'NcBoolean', isReadOnly: true, isNullable: false, isSequence: false, isDeprecated: false, description: 'TRUE if block is functional', constraints: null },
      { id: { level: 2, index: 2 }, name: 'members', typeName: 'NcBlockMemberDescriptor', isReadOnly: true, isNullable: false, isSequence: true, isDeprecated: false, description: 'Descriptors of this block\'s members', constraints: null },
    ],
    methods: [
      { id: { level: 2, index: 1 }, name: 'GetMemberDescriptors', resultDatatype: 'NcMethodResultBlockMemberDescriptors', parameters: [{ name: 'recurse', typeName: 'NcBoolean', isNullable: false, isSequence: false, description: 'If recurse is set to true, nested members can be retrieved', constraints: null }], isDeprecated: false, description: 'Gets descriptors of members of the block' },
      { id: { level: 2, index: 2 }, name: 'FindMembersByPath', resultDatatype: 'NcMethodResultBlockMemberDescriptors', parameters: [{ name: 'path', typeName: 'NcRolePath', isNullable: false, isSequence: false, description: 'Relative path to search for (MUST not include the role of the block targeted by oid)', constraints: null }], isDeprecated: false, description: 'Finds member(s) by path' },
      { id: { level: 2, index: 3 }, name: 'FindMembersByRole', resultDatatype: 'NcMethodResultBlockMemberDescriptors', parameters: [{ name: 'role', typeName: 'NcString', isNullable: false, isSequence: false, description: 'Role text to search for', constraints: null }, { name: 'caseSensitive', typeName: 'NcBoolean', isNullable: false, isSequence: false, description: 'Signals if the comparison should be case sensitive', constraints: null }, { name: 'matchWholeString', typeName: 'NcBoolean', isNullable: false, isSequence: false, description: 'TRUE to only return exact matches', constraints: null }, { name: 'recurse', typeName: 'NcBoolean', isNullable: false, isSequence: false, description: 'TRUE to search nested blocks', constraints: null }], isDeprecated: false, description: 'Finds members with given role name or fragment' },
      { id: { level: 2, index: 4 }, name: 'FindMembersByClassId', resultDatatype: 'NcMethodResultBlockMemberDescriptors', parameters: [{ name: 'classId', typeName: 'NcClassId', isNullable: false, isSequence: false, description: 'Class id to search for', constraints: null }, { name: 'includeDerived', typeName: 'NcBoolean', isNullable: false, isSequence: false, description: 'If TRUE it will also include derived class descriptors', constraints: null }, { name: 'recurse', typeName: 'NcBoolean', isNullable: false, isSequence: false, description: 'TRUE to search nested blocks', constraints: null }], isDeprecated: false, description: 'Finds members with given class id' },
    ],
    events: [],
  },

  // 1.2.json — NcWorker
  {
    classId: [1, 2],
    name: 'NcWorker',
    fixedRole: null,
    description: 'NcWorker class descriptor',
    properties: [
      { id: { level: 2, index: 1 }, name: 'enabled', typeName: 'NcBoolean', isReadOnly: false, isNullable: false, isSequence: false, isDeprecated: false, description: 'TRUE iff worker is enabled', constraints: null },
    ],
    methods: [],
    events: [],
  },

  // 1.3.json — NcManager
  {
    classId: [1, 3],
    name: 'NcManager',
    fixedRole: null,
    description: 'NcManager class descriptor',
    properties: [],
    methods: [],
    events: [],
  },

  // 1.3.1.json — NcDeviceManager
  {
    classId: [1, 3, 1],
    name: 'NcDeviceManager',
    fixedRole: 'DeviceManager',
    description: 'NcDeviceManager class descriptor',
    properties: [
      { id: { level: 3, index: 1 }, name: 'ncVersion', typeName: 'NcVersionCode', isReadOnly: true, isNullable: false, isSequence: false, isDeprecated: false, description: 'Version of MS-05-02 that this device uses', constraints: null },
      { id: { level: 3, index: 2 }, name: 'manufacturer', typeName: 'NcManufacturer', isReadOnly: true, isNullable: false, isSequence: false, isDeprecated: false, description: 'Manufacturer descriptor', constraints: null },
      { id: { level: 3, index: 3 }, name: 'product', typeName: 'NcProduct', isReadOnly: true, isNullable: false, isSequence: false, isDeprecated: false, description: 'Product descriptor', constraints: null },
      { id: { level: 3, index: 4 }, name: 'serialNumber', typeName: 'NcString', isReadOnly: true, isNullable: false, isSequence: false, isDeprecated: false, description: 'Serial number', constraints: null },
      { id: { level: 3, index: 5 }, name: 'userInventoryCode', typeName: 'NcString', isReadOnly: false, isNullable: true, isSequence: false, isDeprecated: false, description: 'Asset tracking identifier (user specified)', constraints: null },
      { id: { level: 3, index: 6 }, name: 'deviceName', typeName: 'NcString', isReadOnly: false, isNullable: true, isSequence: false, isDeprecated: false, description: 'Name of this device in the application. Instance name, not product name.', constraints: null },
      { id: { level: 3, index: 7 }, name: 'deviceRole', typeName: 'NcString', isReadOnly: false, isNullable: true, isSequence: false, isDeprecated: false, description: 'Role of this device in the application.', constraints: null },
      { id: { level: 3, index: 8 }, name: 'operationalState', typeName: 'NcDeviceOperationalState', isReadOnly: true, isNullable: false, isSequence: false, isDeprecated: false, description: 'Device operational state', constraints: null },
      { id: { level: 3, index: 9 }, name: 'resetCause', typeName: 'NcResetCause', isReadOnly: true, isNullable: false, isSequence: false, isDeprecated: false, description: 'Reason for most recent reset', constraints: null },
      { id: { level: 3, index: 10 }, name: 'message', typeName: 'NcString', isReadOnly: true, isNullable: true, isSequence: false, isDeprecated: false, description: 'Arbitrary message from dev to controller', constraints: null },
    ],
    methods: [],
    events: [],
  },

  // 1.3.2.json — NcClassManager
  {
    classId: [1, 3, 2],
    name: 'NcClassManager',
    fixedRole: 'ClassManager',
    description: 'NcClassManager class descriptor',
    properties: [
      { id: { level: 3, index: 1 }, name: 'controlClasses', typeName: 'NcClassDescriptor', isReadOnly: true, isNullable: false, isSequence: true, isDeprecated: false, description: 'Descriptions of all control classes in the device (descriptors do not contain inherited elements)', constraints: null },
      { id: { level: 3, index: 2 }, name: 'datatypes', typeName: 'NcDatatypeDescriptor', isReadOnly: true, isNullable: false, isSequence: true, isDeprecated: false, description: 'Descriptions of all data types in the device (descriptors do not contain inherited elements)', constraints: null },
    ],
    methods: [
      { id: { level: 3, index: 1 }, name: 'GetControlClass', resultDatatype: 'NcMethodResultClassDescriptor', parameters: [{ name: 'classId', typeName: 'NcClassId', isNullable: false, isSequence: false, description: 'class ID', constraints: null }, { name: 'includeInherited', typeName: 'NcBoolean', isNullable: false, isSequence: false, description: 'If set the descriptor would contain all inherited elements', constraints: null }], isDeprecated: false, description: 'Get a single class descriptor' },
      { id: { level: 3, index: 2 }, name: 'GetDatatype', resultDatatype: 'NcMethodResultDatatypeDescriptor', parameters: [{ name: 'name', typeName: 'NcName', isNullable: false, isSequence: false, description: 'name of datatype', constraints: null }, { name: 'includeInherited', typeName: 'NcBoolean', isNullable: false, isSequence: false, description: 'If set the descriptor would contain all inherited elements', constraints: null }], isDeprecated: false, description: 'Get a single datatype descriptor' },
    ],
    events: [],
  },
];

// ---------------------------------------------------------------------------
// Standard datatype descriptors — from models/datatypes/
// ---------------------------------------------------------------------------

export const STANDARD_DATATYPE_DESCRIPTORS: NcDatatypeDescriptor[] = [
  // Primitives
  { type: 'Primitive', name: 'NcBoolean', description: 'Boolean primitive type', constraints: null },
  { type: 'Primitive', name: 'NcInt16', description: 'Int16 primitive type', constraints: null },
  { type: 'Primitive', name: 'NcInt32', description: 'Int32 primitive type', constraints: null },
  { type: 'Primitive', name: 'NcInt64', description: 'Int64 primitive type', constraints: null },
  { type: 'Primitive', name: 'NcUint16', description: 'Uint16 primitive type', constraints: null },
  { type: 'Primitive', name: 'NcUint32', description: 'Uint32 primitive type', constraints: null },
  { type: 'Primitive', name: 'NcUint64', description: 'Uint64 primitive type', constraints: null },
  { type: 'Primitive', name: 'NcFloat32', description: 'Float32 primitive type', constraints: null },
  { type: 'Primitive', name: 'NcFloat64', description: 'Float64 primitive type', constraints: null },
  { type: 'Primitive', name: 'NcString', description: 'String primitive type', constraints: null },

  // Typedefs
  { type: 'Typedef', name: 'NcClassId',       description: 'Sequence of class ID fields.',                    parentType: 'NcInt32',  isSequence: true,  constraints: null },
  { type: 'Typedef', name: 'NcOid',           description: 'Object id',                                        parentType: 'NcUint32', isSequence: false, constraints: null },
  { type: 'Typedef', name: 'NcUri',           description: 'Uniform resource identifier',                      parentType: 'NcString', isSequence: false, constraints: null },
  { type: 'Typedef', name: 'NcUuid',          description: 'UUID',                                             parentType: 'NcString', isSequence: false, constraints: null },
  { type: 'Typedef', name: 'NcRegex',         description: 'Regex pattern',                                    parentType: 'NcString', isSequence: false, constraints: null },
  { type: 'Typedef', name: 'NcRolePath',      description: 'Role path',                                        parentType: 'NcString', isSequence: true,  constraints: null },
  { type: 'Typedef', name: 'NcVersionCode',   description: 'Version code in semantic versioning format',       parentType: 'NcString', isSequence: false, constraints: null },
  { type: 'Typedef', name: 'NcOrganizationId',description: 'Unique 24-bit organization id',                   parentType: 'NcInt32',  isSequence: false, constraints: null },
  { type: 'Typedef', name: 'NcName',          description: 'Programmatically significant name, alphanumerics + underscore, no spaces', parentType: 'NcString', isSequence: false, constraints: null },
  { type: 'Typedef', name: 'NcId',            description: 'Identity handler',                                 parentType: 'NcUint32', isSequence: false, constraints: null },
  { type: 'Typedef', name: 'NcTimeInterval',  description: 'Time interval described in nanoseconds',           parentType: 'NcInt64',  isSequence: false, constraints: null },

  // Enums
  {
    type: 'Enum',
    name: 'NcDatatypeType',
    description: 'Datatype type',
    constraints: null,
    items: [
      { name: 'Primitive', value: 0, description: 'Primitive datatype' },
      { name: 'Typedef', value: 1, description: 'Typedef datatype' },
      { name: 'Struct', value: 2, description: 'Struct datatype' },
      { name: 'Enum', value: 3, description: 'Enum datatype' },
    ],
  },
  {
    type: 'Enum',
    name: 'NcMethodStatus',
    description: 'Method invokation status',
    constraints: null,
    items: [
      { name: 'Ok',                    value: 200, description: 'Method call was successful' },
      { name: 'PropertyDeprecated',    value: 298, description: 'Method call was successful but targeted property is deprecated' },
      { name: 'MethodDeprecated',      value: 299, description: 'Method call was successful but method is deprecated' },
      { name: 'BadCommandFormat',      value: 400, description: 'Badly-formed command (e.g. the incoming command has invalid message encoding and cannot be parsed by the underlying protocol)' },
      { name: 'Unauthorized',          value: 401, description: 'Client is not authorized' },
      { name: 'BadOid',                value: 404, description: 'Command addresses a nonexistent object' },
      { name: 'Readonly',              value: 405, description: 'Attempt to change read-only state' },
      { name: 'InvalidRequest',        value: 406, description: 'Method call is invalid in current operating context (e.g. attempting to invoke a method when the object is disabled)' },
      { name: 'Conflict',              value: 409, description: 'There is a conflict with the current state of the device' },
      { name: 'BufferOverflow',        value: 413, description: 'Something was too big' },
      { name: 'IndexOutOfBounds',      value: 414, description: 'Index is outside the available range' },
      { name: 'ParameterError',        value: 417, description: 'Method parameter does not meet expectations (e.g. attempting to invoke a method with an invalid type for one of its parameters)' },
      { name: 'Locked',                value: 423, description: 'Addressed object is locked' },
      { name: 'DeviceError',           value: 500, description: 'Internal device error' },
      { name: 'MethodNotImplemented',  value: 501, description: 'Addressed method is not implemented by the addressed object' },
      { name: 'PropertyNotImplemented',value: 502, description: 'Addressed property is not implemented by the addressed object' },
      { name: 'NotReady',              value: 503, description: 'The device is not ready to handle any commands' },
      { name: 'Timeout',               value: 504, description: 'Method call did not finish within the allotted time' },
    ],
  },
  {
    type: 'Enum',
    name: 'NcPropertyChangeType',
    description: 'Type of property change',
    constraints: null,
    items: [
      { name: 'ValueChanged', value: 0, description: 'Current value changed' },
      { name: 'SequenceItemAdded', value: 1, description: 'Item added to sequence' },
      { name: 'SequenceItemChanged', value: 2, description: 'Sequence item changed' },
      { name: 'SequenceItemRemoved', value: 3, description: 'Sequence item removed' },
    ],
  },
  {
    type: 'Enum',
    name: 'NcDeviceGenericState',
    description: 'Device generic operational state',
    constraints: null,
    items: [
      { name: 'Unknown',        value: 0, description: 'Unknown' },
      { name: 'NormalOperation',value: 1, description: 'Normal operation' },
      { name: 'Initializing',   value: 2, description: 'Device is initializing' },
      { name: 'Updating',       value: 3, description: 'Device is performing a software or firmware update' },
      { name: 'LicensingError', value: 4, description: 'Device is experiencing a licensing error' },
      { name: 'InternalError',  value: 5, description: 'Device is experiencing an internal error' },
    ],
  },
  {
    type: 'Enum',
    name: 'NcResetCause',
    description: 'Reset cause enum',
    constraints: null,
    items: [
      { name: 'Unknown', value: 0, description: 'Unknown' },
      { name: 'PowerOn', value: 1, description: 'Power on' },
      { name: 'InternalError', value: 2, description: 'Internal error' },
      { name: 'Upgrade', value: 3, description: 'Upgrade' },
      { name: 'ControllerRequest', value: 4, description: 'Controller request' },
      { name: 'ManualReset', value: 5, description: 'Manual reset of the device' },
    ],
  },

  // Structs
  {
    type: 'Struct',
    name: 'NcElementId',
    description: 'Class element id which contains the level and index',
    parentType: null,
    constraints: null,
    fields: [
      { name: 'level', typeName: 'NcUint16', isNullable: false, isSequence: false, description: 'Level of the element', constraints: null },
      { name: 'index', typeName: 'NcUint16', isNullable: false, isSequence: false, description: 'Index of the element', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcPropertyId',
    description: 'Unique identifier of a property (relative to a class)',
    parentType: 'NcElementId',
    constraints: null,
    fields: [],
  },
  {
    type: 'Struct',
    name: 'NcMethodId',
    description: 'Unique identifier of a method (relative to a class)',
    parentType: 'NcElementId',
    constraints: null,
    fields: [],
  },
  {
    type: 'Struct',
    name: 'NcEventId',
    description: 'Unique identifier of an event (relative to a class)',
    parentType: 'NcElementId',
    constraints: null,
    fields: [],
  },
  {
    type: 'Struct',
    name: 'NcPropertyChangedEventData',
    description: 'Payload of property-changed event',
    parentType: null,
    constraints: null,
    fields: [
      { name: 'propertyId', typeName: 'NcPropertyId', isNullable: false, isSequence: false, description: 'Property id', constraints: null },
      { name: 'changeType', typeName: 'NcPropertyChangeType', isNullable: false, isSequence: false, description: 'Indicates the type of change', constraints: null },
      { name: 'value', typeName: null, isNullable: true, isSequence: false, description: 'Property value. For sequence properties the entire sequence is reported unless a sequence item was added, changed or deleted', constraints: null },
      { name: 'sequenceItemIndex', typeName: 'NcId', isNullable: true, isSequence: false, description: 'The index of the sequence item if the change type is sequence item added, changed or deleted', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcMethodResult',
    description: 'Base result of the invoked method',
    parentType: null,
    constraints: null,
    fields: [
      { name: 'status', typeName: 'NcMethodStatus', isNullable: false, isSequence: false, description: 'Status for the invoked method', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcMethodResultError',
    description: 'Error result - to be used when the method call encounters an error',
    parentType: 'NcMethodResult',
    constraints: null,
    fields: [
      { name: 'errorMessage', typeName: 'NcString', isNullable: false, isSequence: false, description: 'Error message', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcMethodResultPropertyValue',
    description: 'Result when getting a property value',
    parentType: 'NcMethodResult',
    constraints: null,
    fields: [
      { name: 'value', typeName: null, isNullable: true, isSequence: false, description: 'Getter method value for the associated property', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcMethodResultLength',
    description: 'Length method result',
    parentType: 'NcMethodResult',
    constraints: null,
    fields: [
      { name: 'value', typeName: 'NcUint32', isNullable: true, isSequence: false, description: 'Sequence length result value. MUST be null if the sequence is null', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcMethodResultId',
    description: 'Result when adding a sequence item',
    parentType: 'NcMethodResult',
    constraints: null,
    fields: [
      { name: 'value', typeName: 'NcId', isNullable: false, isSequence: false, description: 'Id of the newly added item', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcMethodResultBlockMemberDescriptors',
    description: 'Result when getting block member descriptors',
    parentType: 'NcMethodResult',
    constraints: null,
    fields: [
      { name: 'value', typeName: 'NcBlockMemberDescriptor', isNullable: false, isSequence: true, description: 'Block member descriptors method value', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcMethodResultClassDescriptor',
    description: 'Result when getting a class descriptor',
    parentType: 'NcMethodResult',
    constraints: null,
    fields: [
      { name: 'value', typeName: 'NcClassDescriptor', isNullable: false, isSequence: false, description: 'Class descriptor method value', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcMethodResultDatatypeDescriptor',
    description: 'Result when getting a datatype descriptor',
    parentType: 'NcMethodResult',
    constraints: null,
    fields: [
      { name: 'value', typeName: 'NcDatatypeDescriptor', isNullable: false, isSequence: false, description: 'Datatype descriptor method value', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcDescriptor',
    description: 'Base descriptor',
    parentType: null,
    constraints: null,
    fields: [
      { name: 'description', typeName: 'NcString', isNullable: true, isSequence: false, description: 'Optional user facing description', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcBlockMemberDescriptor',
    description: 'Descriptor which is specific to a block member',
    parentType: 'NcDescriptor',
    constraints: null,
    fields: [
      { name: 'role', typeName: 'NcString', isNullable: false, isSequence: false, description: 'Role of member in its containing block', constraints: null },
      { name: 'oid', typeName: 'NcOid', isNullable: false, isSequence: false, description: 'OID of member', constraints: null },
      { name: 'constantOid', typeName: 'NcBoolean', isNullable: false, isSequence: false, description: 'TRUE iff member\'s OID is hardwired into device', constraints: null },
      { name: 'classId', typeName: 'NcClassId', isNullable: false, isSequence: false, description: 'Class ID', constraints: null },
      { name: 'userLabel', typeName: 'NcString', isNullable: true, isSequence: false, description: 'User label', constraints: null },
      { name: 'owner', typeName: 'NcOid', isNullable: false, isSequence: false, description: 'Containing block\'s OID', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcFieldDescriptor',
    description: 'Descriptor of a field of a struct datatype',
    parentType: 'NcDescriptor',
    constraints: null,
    fields: [
      { name: 'name', typeName: 'NcName', isNullable: false, isSequence: false, description: 'Name of the field', constraints: null },
      { name: 'typeName', typeName: 'NcName', isNullable: true, isSequence: false, description: 'Name of the field\'s datatype', constraints: null },
      { name: 'isNullable', typeName: 'NcBoolean', isNullable: false, isSequence: false, description: 'TRUE iff the field is nullable', constraints: null },
      { name: 'isSequence', typeName: 'NcBoolean', isNullable: false, isSequence: false, description: 'TRUE iff the field is a sequence', constraints: null },
      { name: 'constraints', typeName: 'NcParameterConstraints', isNullable: true, isSequence: false, description: 'Optional constraints on the field', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcEnumItemDescriptor',
    description: 'Descriptor of an enum item',
    parentType: 'NcDescriptor',
    constraints: null,
    fields: [
      { name: 'name', typeName: 'NcName', isNullable: false, isSequence: false, description: 'Name of the item', constraints: null },
      { name: 'value', typeName: 'NcUint16', isNullable: false, isSequence: false, description: 'Enum item numerical value', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcParameterDescriptor',
    description: 'Descriptor of a method parameter',
    parentType: 'NcDescriptor',
    constraints: null,
    fields: [
      { name: 'name', typeName: 'NcName', isNullable: false, isSequence: false, description: 'Name of the parameter', constraints: null },
      { name: 'typeName', typeName: 'NcName', isNullable: true, isSequence: false, description: 'Name of the parameter\'s datatype', constraints: null },
      { name: 'isNullable', typeName: 'NcBoolean', isNullable: false, isSequence: false, description: 'TRUE iff the parameter is nullable', constraints: null },
      { name: 'isSequence', typeName: 'NcBoolean', isNullable: false, isSequence: false, description: 'TRUE iff the parameter is a sequence', constraints: null },
      { name: 'constraints', typeName: 'NcParameterConstraints', isNullable: true, isSequence: false, description: 'Optional constraints on the parameter', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcEventDescriptor',
    description: 'Descriptor of a class event',
    parentType: 'NcDescriptor',
    constraints: null,
    fields: [
      { name: 'id', typeName: 'NcEventId', isNullable: false, isSequence: false, description: 'Event id with level and index', constraints: null },
      { name: 'name', typeName: 'NcName', isNullable: false, isSequence: false, description: 'Name of the event', constraints: null },
      { name: 'eventDatatype', typeName: 'NcName', isNullable: false, isSequence: false, description: 'Name of event data\'s datatype', constraints: null },
      { name: 'isDeprecated', typeName: 'NcBoolean', isNullable: false, isSequence: false, description: 'TRUE iff the event is deprecated', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcMethodDescriptor',
    description: 'Descriptor of a class method',
    parentType: 'NcDescriptor',
    constraints: null,
    fields: [
      { name: 'id', typeName: 'NcMethodId', isNullable: false, isSequence: false, description: 'Method id with level and index', constraints: null },
      { name: 'name', typeName: 'NcName', isNullable: false, isSequence: false, description: 'Name of the method', constraints: null },
      { name: 'resultDatatype', typeName: 'NcName', isNullable: false, isSequence: false, description: 'Name of method result\'s datatype', constraints: null },
      { name: 'parameters', typeName: 'NcParameterDescriptor', isNullable: false, isSequence: true, description: 'Parameter descriptors if any', constraints: null },
      { name: 'isDeprecated', typeName: 'NcBoolean', isNullable: false, isSequence: false, description: 'TRUE iff the method is deprecated', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcPropertyDescriptor',
    description: 'Descriptor of a class property',
    parentType: 'NcDescriptor',
    constraints: null,
    fields: [
      { name: 'id', typeName: 'NcPropertyId', isNullable: false, isSequence: false, description: 'Property id with level and index', constraints: null },
      { name: 'name', typeName: 'NcName', isNullable: false, isSequence: false, description: 'Name of the property', constraints: null },
      { name: 'typeName', typeName: 'NcName', isNullable: true, isSequence: false, description: 'Name of property\'s datatype', constraints: null },
      { name: 'isReadOnly', typeName: 'NcBoolean', isNullable: false, isSequence: false, description: 'TRUE iff property is read-only', constraints: null },
      { name: 'isNullable', typeName: 'NcBoolean', isNullable: false, isSequence: false, description: 'TRUE iff property is nullable', constraints: null },
      { name: 'isSequence', typeName: 'NcBoolean', isNullable: false, isSequence: false, description: 'TRUE iff property is a sequence', constraints: null },
      { name: 'isDeprecated', typeName: 'NcBoolean', isNullable: false, isSequence: false, description: 'TRUE iff the property is deprecated', constraints: null },
      { name: 'constraints', typeName: 'NcParameterConstraints', isNullable: true, isSequence: false, description: 'Optional constraints on top of the underlying data type', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcClassDescriptor',
    description: 'Descriptor of a class',
    parentType: 'NcDescriptor',
    constraints: null,
    fields: [
      { name: 'classId', typeName: 'NcClassId', isNullable: false, isSequence: false, description: 'Identity of the class', constraints: null },
      { name: 'name', typeName: 'NcName', isNullable: false, isSequence: false, description: 'Name of the class', constraints: null },
      { name: 'fixedRole', typeName: 'NcString', isNullable: true, isSequence: false, description: 'Role if the class has a fixed role (manager classes)', constraints: null },
      { name: 'properties', typeName: 'NcPropertyDescriptor', isNullable: false, isSequence: true, description: 'Property descriptors', constraints: null },
      { name: 'methods', typeName: 'NcMethodDescriptor', isNullable: false, isSequence: true, description: 'Method descriptors', constraints: null },
      { name: 'events', typeName: 'NcEventDescriptor', isNullable: false, isSequence: true, description: 'Event descriptors', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcDatatypeDescriptor',
    description: 'Base datatype descriptor',
    parentType: 'NcDescriptor',
    constraints: null,
    fields: [
      { name: 'name', typeName: 'NcName', isNullable: false, isSequence: false, description: 'Datatype name', constraints: null },
      { name: 'type', typeName: 'NcDatatypeType', isNullable: false, isSequence: false, description: 'Type: Primitive, Typedef, Struct, Enum', constraints: null },
      { name: 'constraints', typeName: 'NcParameterConstraints', isNullable: true, isSequence: false, description: 'Optional constraints on top of the underlying data type', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcDatatypeDescriptorPrimitive',
    description: 'Descriptor of a primitive datatype',
    parentType: 'NcDatatypeDescriptor',
    constraints: null,
    fields: [],
  },
  {
    type: 'Struct',
    name: 'NcDatatypeDescriptorTypeDef',
    description: 'Descriptor of a typedef datatype',
    parentType: 'NcDatatypeDescriptor',
    constraints: null,
    fields: [
      { name: 'parentType', typeName: 'NcName', isNullable: false, isSequence: false, description: 'Typedef target datatype name', constraints: null },
      { name: 'isSequence', typeName: 'NcBoolean', isNullable: false, isSequence: false, description: 'TRUE iff the typedef definition is a sequence of the parentType', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcDatatypeDescriptorStruct',
    description: 'Descriptor of a struct datatype',
    parentType: 'NcDatatypeDescriptor',
    constraints: null,
    fields: [
      { name: 'fields', typeName: 'NcFieldDescriptor', isNullable: false, isSequence: true, description: 'One item descriptor per field of the struct', constraints: null },
      { name: 'parentType', typeName: 'NcName', isNullable: true, isSequence: false, description: 'Optional base datatype name', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcDatatypeDescriptorEnum',
    description: 'Descriptor of an enum datatype',
    parentType: 'NcDatatypeDescriptor',
    constraints: null,
    fields: [
      { name: 'items', typeName: 'NcEnumItemDescriptor', isNullable: false, isSequence: true, description: 'One item descriptor per enum option', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcManufacturer',
    description: 'Manufacturer descriptor',
    parentType: null,
    constraints: null,
    fields: [
      { name: 'name', typeName: 'NcString', isNullable: false, isSequence: false, description: 'Manufacturer\'s name', constraints: null },
      { name: 'organizationId', typeName: 'NcOrganizationId', isNullable: true, isSequence: false, description: 'IEEE OUI or CID of manufacturer', constraints: null },
      { name: 'website', typeName: 'NcUri', isNullable: true, isSequence: false, description: 'URL of the manufacturer\'s website', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcProduct',
    description: 'Product descriptor',
    parentType: null,
    constraints: null,
    fields: [
      { name: 'name', typeName: 'NcString', isNullable: false, isSequence: false, description: 'Product name', constraints: null },
      { name: 'key', typeName: 'NcString', isNullable: false, isSequence: false, description: 'Manufacturer\'s unique key to product - model number or SKU', constraints: null },
      { name: 'revisionLevel', typeName: 'NcString', isNullable: false, isSequence: false, description: 'Manufacturer\'s product revision level code', constraints: null },
      { name: 'brandName', typeName: 'NcString', isNullable: true, isSequence: false, description: 'Brand name under which product is sold', constraints: null },
      { name: 'uuid', typeName: 'NcUuid', isNullable: true, isSequence: false, description: 'Unique id of this product', constraints: null },
      { name: 'description', typeName: 'NcString', isNullable: true, isSequence: false, description: 'Text description of product', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcDeviceOperationalState',
    description: 'Device operational state',
    parentType: null,
    constraints: null,
    fields: [
      { name: 'generic', typeName: 'NcDeviceGenericState', isNullable: false, isSequence: false, description: 'Generic operational state', constraints: null },
      { name: 'deviceSpecificDetails', typeName: 'NcString', isNullable: true, isSequence: false, description: 'Device specific details', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcTouchpoint',
    description: 'Base touchpoint class',
    parentType: null,
    constraints: null,
    fields: [
      { name: 'contextNamespace', typeName: 'NcString', isNullable: false, isSequence: false, description: 'Context namespace', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcTouchpointResource',
    description: 'Touchpoint resource',
    parentType: null,
    constraints: null,
    fields: [
      { name: 'resourceType', typeName: 'NcString', isNullable: false, isSequence: false, description: 'The type of the touchpoint resource', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcTouchpointNmos',
    description: 'Touchpoint class for NMOS resources',
    parentType: 'NcTouchpoint',
    constraints: null,
    fields: [
      { name: 'resource', typeName: 'NcTouchpointResourceNmos', isNullable: false, isSequence: false, description: 'Context namespace', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcTouchpointNmosChannelMapping',
    description: 'Touchpoint class for NMOS IS-08 resources',
    parentType: 'NcTouchpoint',
    constraints: null,
    fields: [
      { name: 'resource', typeName: 'NcTouchpointResourceNmosChannelMapping', isNullable: false, isSequence: false, description: 'Context namespace', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcTouchpointResourceNmos',
    description: 'Touchpoint resource class for NMOS resources',
    parentType: 'NcTouchpointResource',
    constraints: null,
    fields: [
      { name: 'id', typeName: 'NcUuid', isNullable: false, isSequence: false, description: 'NMOS resource UUID', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcTouchpointResourceNmosChannelMapping',
    description: 'Touchpoint resource class for NMOS IS-08 Audio Channel Mapping resources',
    parentType: 'NcTouchpointResourceNmos',
    constraints: null,
    fields: [
      { name: 'ioId', typeName: 'NcString', isNullable: false, isSequence: false, description: 'IS-08 Audio Channel Mapping input or output id', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcPropertyConstraints',
    description: 'Property constraints',
    parentType: null,
    constraints: null,
    fields: [
      { name: 'propertyId', typeName: 'NcPropertyId', isNullable: false, isSequence: false, description: 'The id of the property being constrained', constraints: null },
      { name: 'defaultValue', typeName: null, isNullable: true, isSequence: false, description: 'Optional default value', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcPropertyConstraintsNumber',
    description: 'Number property constraints class',
    parentType: 'NcPropertyConstraints',
    constraints: null,
    fields: [
      { name: 'maximum', typeName: null, isNullable: true, isSequence: false, description: 'Optional maximum', constraints: null },
      { name: 'minimum', typeName: null, isNullable: true, isSequence: false, description: 'Optional minimum', constraints: null },
      { name: 'step',    typeName: null, isNullable: true, isSequence: false, description: 'Optional step',    constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcPropertyConstraintsString',
    description: 'String property constraints',
    parentType: 'NcPropertyConstraints',
    constraints: null,
    fields: [
      { name: 'maxCharacters', typeName: 'NcUint32', isNullable: true, isSequence: false, description: 'Maximum characters allowed', constraints: null },
      { name: 'pattern', typeName: 'NcRegex', isNullable: true, isSequence: false, description: 'Regex pattern', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcParameterConstraints',
    description: 'Parameter constraints',
    parentType: null,
    constraints: null,
    fields: [
      { name: 'defaultValue', typeName: null, isNullable: true, isSequence: false, description: 'Optional default value', constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcParameterConstraintsNumber',
    description: 'Number parameter constraints class',
    parentType: 'NcParameterConstraints',
    constraints: null,
    fields: [
      { name: 'maximum', typeName: null, isNullable: true, isSequence: false, description: 'Optional maximum', constraints: null },
      { name: 'minimum', typeName: null, isNullable: true, isSequence: false, description: 'Optional minimum', constraints: null },
      { name: 'step',    typeName: null, isNullable: true, isSequence: false, description: 'Optional step',    constraints: null },
    ],
  },
  {
    type: 'Struct',
    name: 'NcParameterConstraintsString',
    description: 'String parameter constraints',
    parentType: 'NcParameterConstraints',
    constraints: null,
    fields: [
      { name: 'maxCharacters', typeName: 'NcUint32', isNullable: true, isSequence: false, description: 'Maximum characters allowed', constraints: null },
      { name: 'pattern', typeName: 'NcRegex', isNullable: true, isSequence: false, description: 'Regex pattern', constraints: null },
    ],
  },
];
