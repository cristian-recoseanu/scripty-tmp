/**
 * NMOS Control Feature Set class and datatype descriptors.
 *
 * Sourced verbatim from:
 *   identification: https://github.com/AMWA-TV/nmos-control-feature-sets/tree/main/identification/models/classes
 *   monitoring:     https://github.com/AMWA-TV/nmos-control-feature-sets/tree/main/monitoring/models
 *   device-config:  https://github.com/AMWA-TV/nmos-control-feature-sets/tree/main/device-configuration/models
 */

import type { NcClassDescriptor, NcDatatypeDescriptor } from './types.js';

// ---------------------------------------------------------------------------
// Feature-set class descriptors
// ---------------------------------------------------------------------------

export const FEATURE_SET_CLASS_DESCRIPTORS: NcClassDescriptor[] = [

  // identification/models/classes/1.2.1.json — NcIdentBeacon [1,2,1]
  {
    classId: [1, 2, 1],
    name: 'NcIdentBeacon',
    fixedRole: null,
    description: 'NcIdentBeacon class descriptor',
    properties: [
      { id: { level: 3, index: 1 }, name: 'active', typeName: 'NcBoolean', isReadOnly: false, isNullable: false, isSequence: false, isDeprecated: false, description: 'Indicator active state', constraints: null },
    ],
    methods: [],
    events: [],
  },

  // monitoring/models/classes/1.2.2.json — NcStatusMonitor [1,2,2]
  {
    classId: [1, 2, 2],
    name: 'NcStatusMonitor',
    fixedRole: null,
    description: 'Baseline status monitoring class',
    properties: [
      { id: { level: 3, index: 1 }, name: 'overallStatus',        typeName: 'NcOverallStatus', isReadOnly: true,  isNullable: false, isSequence: false, isDeprecated: false, description: 'Overall status property', constraints: null },
      { id: { level: 3, index: 2 }, name: 'overallStatusMessage', typeName: 'NcString',        isReadOnly: true,  isNullable: true,  isSequence: false, isDeprecated: false, description: 'Overall status message property', constraints: null },
      { id: { level: 3, index: 3 }, name: 'statusReportingDelay', typeName: 'NcUint32',        isReadOnly: false, isNullable: false, isSequence: false, isDeprecated: false, description: 'Status reporting delay property (in seconds, default is 3s and 0 means no delay)', constraints: null },
    ],
    methods: [],
    events: [],
  },

  // monitoring/models/classes/1.2.2.1.json — NcReceiverMonitor [1,2,2,1]
  {
    classId: [1, 2, 2, 1],
    name: 'NcReceiverMonitor',
    fixedRole: null,
    description: 'Receiver monitor class descriptor',
    properties: [
      { id: { level: 4, index: 1  }, name: 'linkStatus',                                    typeName: 'NcLinkStatus',            isReadOnly: true,  isNullable: false, isSequence: false, isDeprecated: false, description: 'Link status property', constraints: null },
      { id: { level: 4, index: 2  }, name: 'linkStatusMessage',                             typeName: 'NcString',                isReadOnly: true,  isNullable: true,  isSequence: false, isDeprecated: false, description: 'Link status message property', constraints: null },
      { id: { level: 4, index: 3  }, name: 'linkStatusTransitionCounter',                   typeName: 'NcUint64',                isReadOnly: true,  isNullable: false, isSequence: false, isDeprecated: false, description: 'Link status transition counter property', constraints: null },
      { id: { level: 4, index: 4  }, name: 'connectionStatus',                              typeName: 'NcConnectionStatus',     isReadOnly: true,  isNullable: false, isSequence: false, isDeprecated: false, description: 'Connection status property', constraints: null },
      { id: { level: 4, index: 5  }, name: 'connectionStatusMessage',                       typeName: 'NcString',                isReadOnly: true,  isNullable: true,  isSequence: false, isDeprecated: false, description: 'Connection status message property', constraints: null },
      { id: { level: 4, index: 6  }, name: 'connectionStatusTransitionCounter',             typeName: 'NcUint64',                isReadOnly: true,  isNullable: false, isSequence: false, isDeprecated: false, description: 'Connection status transition counter property', constraints: null },
      { id: { level: 4, index: 7  }, name: 'externalSynchronizationStatus',                typeName: 'NcSynchronizationStatus', isReadOnly: true,  isNullable: false, isSequence: false, isDeprecated: false, description: 'External synchronization status property', constraints: null },
      { id: { level: 4, index: 8  }, name: 'externalSynchronizationStatusMessage',         typeName: 'NcString',                isReadOnly: true,  isNullable: true,  isSequence: false, isDeprecated: false, description: 'External synchronization status message property', constraints: null },
      { id: { level: 4, index: 9  }, name: 'externalSynchronizationStatusTransitionCounter', typeName: 'NcUint64',              isReadOnly: true,  isNullable: false, isSequence: false, isDeprecated: false, description: 'External synchronization status transition counter property', constraints: null },
      { id: { level: 4, index: 10 }, name: 'synchronizationSourceId',                      typeName: 'NcString',                isReadOnly: true,  isNullable: true,  isSequence: false, isDeprecated: false, description: 'Synchronization source id property', constraints: null },
      { id: { level: 4, index: 11 }, name: 'streamStatus',                                 typeName: 'NcStreamStatus',          isReadOnly: true,  isNullable: false, isSequence: false, isDeprecated: false, description: 'Stream status property', constraints: null },
      { id: { level: 4, index: 12 }, name: 'streamStatusMessage',                           typeName: 'NcString',                isReadOnly: true,  isNullable: true,  isSequence: false, isDeprecated: false, description: 'Stream status message property', constraints: null },
      { id: { level: 4, index: 13 }, name: 'streamStatusTransitionCounter',                 typeName: 'NcUint64',                isReadOnly: true,  isNullable: false, isSequence: false, isDeprecated: false, description: 'Stream status transition counter property', constraints: null },
      { id: { level: 4, index: 14 }, name: 'autoResetCountersAndMessages',                  typeName: 'NcBoolean',               isReadOnly: false, isNullable: false, isSequence: false, isDeprecated: false, description: 'Automatic reset counters and status messages property (default: true)', constraints: null },
    ],
    methods: [
      { id: { level: 4, index: 1 }, name: 'GetLostPacketCounters',  resultDatatype: 'NcMethodResultCounters', parameters: [], isDeprecated: false, description: 'Gets the lost packet counters' },
      { id: { level: 4, index: 2 }, name: 'GetLatePacketCounters',  resultDatatype: 'NcMethodResultCounters', parameters: [], isDeprecated: false, description: 'Gets the late packet counters' },
      { id: { level: 4, index: 3 }, name: 'ResetCountersAndMessages', resultDatatype: 'NcMethodResult',       parameters: [], isDeprecated: false, description: 'Resets ALL counters and status messages' },
    ],
    events: [],
  },

  // monitoring/models/classes/1.2.2.2.json — NcSenderMonitor [1,2,2,2]
  {
    classId: [1, 2, 2, 2],
    name: 'NcSenderMonitor',
    fixedRole: null,
    description: 'Sender monitor class descriptor',
    properties: [
      { id: { level: 4, index: 1  }, name: 'linkStatus',                                    typeName: 'NcLinkStatus',            isReadOnly: true,  isNullable: false, isSequence: false, isDeprecated: false, description: 'Link status property', constraints: null },
      { id: { level: 4, index: 2  }, name: 'linkStatusMessage',                             typeName: 'NcString',                isReadOnly: true,  isNullable: true,  isSequence: false, isDeprecated: false, description: 'Link status message property', constraints: null },
      { id: { level: 4, index: 3  }, name: 'linkStatusTransitionCounter',                   typeName: 'NcUint64',                isReadOnly: true,  isNullable: false, isSequence: false, isDeprecated: false, description: 'Link status transition counter property', constraints: null },
      { id: { level: 4, index: 4  }, name: 'transmissionStatus',                            typeName: 'NcTransmissionStatus',    isReadOnly: true,  isNullable: false, isSequence: false, isDeprecated: false, description: 'Transmission status property', constraints: null },
      { id: { level: 4, index: 5  }, name: 'transmissionStatusMessage',                     typeName: 'NcString',                isReadOnly: true,  isNullable: true,  isSequence: false, isDeprecated: false, description: 'Transmission status message property', constraints: null },
      { id: { level: 4, index: 6  }, name: 'transmissionStatusTransitionCounter',           typeName: 'NcUint64',                isReadOnly: true,  isNullable: false, isSequence: false, isDeprecated: false, description: 'Transmission status transition counter property', constraints: null },
      { id: { level: 4, index: 7  }, name: 'externalSynchronizationStatus',                typeName: 'NcSynchronizationStatus', isReadOnly: true,  isNullable: false, isSequence: false, isDeprecated: false, description: 'External synchronization status property', constraints: null },
      { id: { level: 4, index: 8  }, name: 'externalSynchronizationStatusMessage',         typeName: 'NcString',                isReadOnly: true,  isNullable: true,  isSequence: false, isDeprecated: false, description: 'External synchronization status message property', constraints: null },
      { id: { level: 4, index: 9  }, name: 'externalSynchronizationStatusTransitionCounter', typeName: 'NcUint64',              isReadOnly: true,  isNullable: false, isSequence: false, isDeprecated: false, description: 'External synchronization status transition counter property', constraints: null },
      { id: { level: 4, index: 10 }, name: 'synchronizationSourceId',                      typeName: 'NcString',                isReadOnly: true,  isNullable: true,  isSequence: false, isDeprecated: false, description: 'Synchronization source id property', constraints: null },
      { id: { level: 4, index: 11 }, name: 'essenceStatus',                                typeName: 'NcEssenceStatus',         isReadOnly: true,  isNullable: false, isSequence: false, isDeprecated: false, description: 'Essence status property', constraints: null },
      { id: { level: 4, index: 12 }, name: 'essenceStatusMessage',                          typeName: 'NcString',                isReadOnly: true,  isNullable: true,  isSequence: false, isDeprecated: false, description: 'Essence status message property', constraints: null },
      { id: { level: 4, index: 13 }, name: 'essenceStatusTransitionCounter',                typeName: 'NcUint64',                isReadOnly: true,  isNullable: false, isSequence: false, isDeprecated: false, description: 'Essence status transition counter property', constraints: null },
      { id: { level: 4, index: 14 }, name: 'autoResetCountersAndMessages',                  typeName: 'NcBoolean',               isReadOnly: false, isNullable: false, isSequence: false, isDeprecated: false, description: 'Automatic reset counters and status messages property (default: true)', constraints: null },
    ],
    methods: [
      { id: { level: 4, index: 1 }, name: 'GetTransmissionErrorCounters', resultDatatype: 'NcMethodResultCounters', parameters: [], isDeprecated: false, description: 'Gets the transmission error counters' },
      { id: { level: 4, index: 2 }, name: 'ResetCountersAndMessages',     resultDatatype: 'NcMethodResult',         parameters: [], isDeprecated: false, description: 'Resets ALL counters and status messages' },
    ],
    events: [],
  },

  // device-configuration/models/classes/1.3.3.json — NcBulkPropertiesManager [1,3,3]
  {
    classId: [1, 3, 3],
    name: 'NcBulkPropertiesManager',
    fixedRole: 'BulkPropertiesManager',
    description: 'NcBulkPropertiesManager class descriptor',
    properties: [],
    methods: [
      {
        id: { level: 3, index: 1 }, name: 'GetPropertiesByPath',
        resultDatatype: 'NcMethodResultBulkPropertiesHolder',
        parameters: [
          { name: 'path',               typeName: 'NcRolePath', isNullable: false, isSequence: false, description: 'The target role path', constraints: null },
          { name: 'recurse',            typeName: 'NcBoolean',  isNullable: false, isSequence: false, description: 'If true will return properties on specified path and all the nested paths', constraints: null },
          { name: 'includeDescriptors', typeName: 'NcBoolean',  isNullable: false, isSequence: false, description: 'If true, property holders returned will contain non-null property descriptors and for full backups the ClassManager role path will also be included', constraints: null },
        ],
        isDeprecated: false,
        description: 'Get bulk object properties by given path',
      },
      {
        id: { level: 3, index: 2 }, name: 'ValidateSetPropertiesByPath',
        resultDatatype: 'NcMethodResultObjectPropertiesSetValidation',
        parameters: [
          { name: 'dataSet',     typeName: 'NcBulkPropertiesHolder', isNullable: false, isSequence: false, description: 'The values offered (this may include read-only values and also paths which are not the target role path)', constraints: null },
          { name: 'path',        typeName: 'NcRolePath',             isNullable: false, isSequence: false, description: 'The target role path', constraints: null },
          { name: 'recurse',     typeName: 'NcBoolean',              isNullable: false, isSequence: false, description: 'If true will validate properties on target path and all the nested paths', constraints: null },
          { name: 'restoreMode', typeName: 'NcRestoreMode',          isNullable: false, isSequence: false, description: 'Defines the restore mode to be applied', constraints: null },
        ],
        isDeprecated: false,
        description: 'Validate bulk properties for setting by given paths',
      },
      {
        id: { level: 3, index: 3 }, name: 'SetPropertiesByPath',
        resultDatatype: 'NcMethodResultObjectPropertiesSetValidation',
        parameters: [
          { name: 'dataSet',     typeName: 'NcBulkPropertiesHolder', isNullable: false, isSequence: false, description: 'The values offered (this may include read-only values and also paths which are not the target role path)', constraints: null },
          { name: 'path',        typeName: 'NcRolePath',             isNullable: false, isSequence: false, description: 'The target role path', constraints: null },
          { name: 'recurse',     typeName: 'NcBoolean',              isNullable: false, isSequence: false, description: 'If true will set properties on target path and all the nested paths', constraints: null },
          { name: 'restoreMode', typeName: 'NcRestoreMode',          isNullable: false, isSequence: false, description: 'Defines the restore mode to be applied', constraints: null },
        ],
        isDeprecated: false,
        description: 'Set bulk properties by given paths',
      },
    ],
    events: [],
  },
];

// ---------------------------------------------------------------------------
// Feature-set datatype descriptors
// ---------------------------------------------------------------------------

export const FEATURE_SET_DATATYPE_DESCRIPTORS: NcDatatypeDescriptor[] = [

  // --- monitoring enums ---
  {
    type: 'Enum', name: 'NcOverallStatus', description: 'Overall status enum data type', constraints: null,
    items: [
      { name: 'Inactive',          value: 0, description: 'Inactive' },
      { name: 'Healthy',           value: 1, description: 'The overall status is healthy' },
      { name: 'PartiallyHealthy',  value: 2, description: 'The overall status is partially healthy' },
      { name: 'Unhealthy',         value: 3, description: 'The overall status is unhealthy' },
    ],
  },
  {
    type: 'Enum', name: 'NcConnectionStatus', description: 'Connection status enum data type', constraints: null,
    items: [
      { name: 'Inactive',         value: 0, description: 'Inactive' },
      { name: 'Healthy',          value: 1, description: 'Active and healthy' },
      { name: 'PartiallyHealthy', value: 2, description: 'Active and partially healthy' },
      { name: 'Unhealthy',        value: 3, description: 'Active and unhealthy' },
    ],
  },
  {
    type: 'Enum', name: 'NcLinkStatus', description: 'Link status enum data type', constraints: null,
    items: [
      { name: 'AllUp',    value: 1, description: 'All the associated network interfaces are up' },
      { name: 'SomeDown', value: 2, description: 'Some of the associated network interfaces are down' },
      { name: 'AllDown',  value: 3, description: 'All the associated network interfaces are down' },
    ],
  },
  {
    type: 'Enum', name: 'NcSynchronizationStatus', description: 'Synchronization status enum data type', constraints: null,
    items: [
      { name: 'NotUsed',          value: 0, description: 'Feature not in use' },
      { name: 'Healthy',          value: 1, description: 'Locked to a synchronization source' },
      { name: 'PartiallyHealthy', value: 2, description: 'Partially locked to a synchronization source' },
      { name: 'Unhealthy',        value: 3, description: 'Not locked to a synchronization source' },
    ],
  },
  {
    type: 'Enum', name: 'NcStreamStatus', description: 'Stream status enum data type', constraints: null,
    items: [
      { name: 'Inactive',         value: 0, description: 'Inactive' },
      { name: 'Healthy',          value: 1, description: 'Active and healthy' },
      { name: 'PartiallyHealthy', value: 2, description: 'Active and partially healthy' },
      { name: 'Unhealthy',        value: 3, description: 'Active and unhealthy' },
    ],
  },
  {
    type: 'Enum', name: 'NcTransmissionStatus', description: 'Transmission status enum data type', constraints: null,
    items: [
      { name: 'Inactive',         value: 0, description: 'Inactive' },
      { name: 'Healthy',          value: 1, description: 'Active and healthy' },
      { name: 'PartiallyHealthy', value: 2, description: 'Active and partially healthy' },
      { name: 'Unhealthy',        value: 3, description: 'Active and unhealthy' },
    ],
  },
  {
    type: 'Enum', name: 'NcEssenceStatus', description: 'Essence status enum data type', constraints: null,
    items: [
      { name: 'Inactive',         value: 0, description: 'Inactive' },
      { name: 'Healthy',          value: 1, description: 'Active and healthy' },
      { name: 'PartiallyHealthy', value: 2, description: 'Active and partially healthy' },
      { name: 'Unhealthy',        value: 3, description: 'Active and unhealthy' },
    ],
  },

  // --- monitoring structs ---
  {
    type: 'Struct', name: 'NcCounter', description: 'Counter data type', parentType: null, constraints: null,
    fields: [
      { name: 'name',        typeName: 'NcString', isNullable: false, isSequence: false, description: 'Counter name', constraints: null },
      { name: 'value',       typeName: 'NcUint64', isNullable: false, isSequence: false, description: 'Counter value', constraints: null },
      { name: 'description', typeName: 'NcString', isNullable: true,  isSequence: false, description: 'Optional counter description', constraints: null },
    ],
  },
  {
    type: 'Struct', name: 'NcMethodResultCounters', description: 'Counters method result', parentType: 'NcMethodResult', constraints: null,
    fields: [
      { name: 'value', typeName: 'NcCounter', isNullable: false, isSequence: true, description: 'Counters', constraints: null },
    ],
  },

  // --- device-configuration enums ---
  {
    type: 'Enum', name: 'NcPropertyRestoreNoticeType', description: 'Property restore notice type enumeration', constraints: null,
    items: [
      { name: 'Warning', value: 300, description: 'Warning property restore notice' },
      { name: 'Error',   value: 400, description: 'Error property restore notice' },
    ],
  },
  {
    type: 'Enum', name: 'NcRestoreMode', description: 'Restore mode enumeration', constraints: null,
    items: [
      { name: 'Modify',  value: 0, description: 'Restore mode is Modify' },
      { name: 'Rebuild', value: 1, description: 'Restore mode is Rebuild' },
    ],
  },
  {
    type: 'Enum', name: 'NcRestoreValidationStatus', description: 'Restore validation status enumeration', constraints: null,
    items: [
      { name: 'Ok',          value: 200, description: 'Restore was successful' },
      { name: 'Failed',      value: 400, description: 'Restore failed' },
      { name: 'NotFound',    value: 404, description: 'Restore failed because the role path is not found in the device model or the device cannot create the role path from the data set' },
      { name: 'DeviceError', value: 500, description: 'Restore failed due to an internal device error preventing the restore from happening' },
    ],
  },

  // --- device-configuration structs ---
  {
    type: 'Struct', name: 'NcPropertyHolder', description: 'Property holder descriptor', parentType: null, constraints: null,
    fields: [
      { name: 'id',         typeName: 'NcPropertyId',         isNullable: false, isSequence: false, description: 'Property id', constraints: null },
      { name: 'descriptor', typeName: 'NcPropertyDescriptor', isNullable: true,  isSequence: false, description: 'Property descriptor', constraints: null },
      { name: 'value',      typeName: null,                   isNullable: true,  isSequence: false, description: 'Property value', constraints: null },
    ],
  },
  {
    type: 'Struct', name: 'NcPropertyRestoreNotice', description: 'Property restore notice descriptor', parentType: null, constraints: null,
    fields: [
      { name: 'id',            typeName: 'NcPropertyId',               isNullable: false, isSequence: false, description: 'Property id', constraints: null },
      { name: 'name',          typeName: 'NcName',                     isNullable: false, isSequence: false, description: 'Property name', constraints: null },
      { name: 'noticeType',    typeName: 'NcPropertyRestoreNoticeType', isNullable: false, isSequence: false, description: 'Property restore notice type', constraints: null },
      { name: 'noticeMessage', typeName: 'NcString',                   isNullable: false, isSequence: false, description: 'Property restore notice message', constraints: null },
    ],
  },
  {
    type: 'Struct', name: 'NcObjectPropertiesSetValidation', description: 'Object properties set validation descriptor', parentType: null, constraints: null,
    fields: [
      { name: 'path',          typeName: 'NcRolePath',                isNullable: false, isSequence: false, description: 'Object role path', constraints: null },
      { name: 'status',        typeName: 'NcRestoreValidationStatus', isNullable: false, isSequence: false, description: 'Validation status', constraints: null },
      { name: 'notices',       typeName: 'NcPropertyRestoreNotice',   isNullable: false, isSequence: true,  description: 'Validation property notices', constraints: null },
      { name: 'statusMessage', typeName: 'NcString',                  isNullable: true,  isSequence: false, description: 'Validation status message', constraints: null },
    ],
  },
  {
    type: 'Struct', name: 'NcObjectPropertiesHolder', description: 'Object properties holder descriptor', parentType: null, constraints: null,
    fields: [
      { name: 'path',                  typeName: 'NcRolePath',        isNullable: false, isSequence: false, description: 'Object role path', constraints: null },
      { name: 'dependencyPaths',       typeName: 'NcRolePath',        isNullable: false, isSequence: true,  description: 'Sequence of role paths which are a dependency for this object', constraints: null },
      { name: 'allowedMembersClasses', typeName: 'NcClassId',         isNullable: false, isSequence: true,  description: 'Sequence of class ids allowed as members of the block', constraints: null },
      { name: 'values',                typeName: 'NcPropertyHolder',  isNullable: false, isSequence: true,  description: 'Object properties values', constraints: null },
      { name: 'isRebuildable',         typeName: 'NcBoolean',         isNullable: false, isSequence: false, description: 'Describes if the object is rebuildable', constraints: null },
    ],
  },
  {
    type: 'Struct', name: 'NcBulkPropertiesHolder', description: 'Bulk properties holder descriptor', parentType: null, constraints: null,
    fields: [
      { name: 'validationFingerprint', typeName: 'NcString',                 isNullable: true,  isSequence: false, description: 'Optional vendor specific fingerprinting mechanism used for validation purposes', constraints: null },
      { name: 'values',                typeName: 'NcObjectPropertiesHolder', isNullable: false, isSequence: true,  description: 'Object properties holders', constraints: null },
    ],
  },
  {
    type: 'Struct', name: 'NcMethodResultBulkPropertiesHolder', description: 'Bulk properties holder method result', parentType: 'NcMethodResult', constraints: null,
    fields: [
      { name: 'value', typeName: 'NcBulkPropertiesHolder', isNullable: false, isSequence: false, description: 'Bulk properties holder value', constraints: null },
    ],
  },
  {
    type: 'Struct', name: 'NcMethodResultObjectPropertiesSetValidation', description: 'Object properties set validation method result', parentType: 'NcMethodResult', constraints: null,
    fields: [
      { name: 'value', typeName: 'NcObjectPropertiesSetValidation', isNullable: false, isSequence: true, description: 'Object properties set path validations', constraints: null },
    ],
  },
];
