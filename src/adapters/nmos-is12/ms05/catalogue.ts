/**
 * E11.T1 — MS-05 datatype/class catalogue generation.
 *
 * Builds NcDatatypeDescriptor and NcClassDescriptor sets from the engine's
 * DatatypeRegistry and EntityRegistry. The catalogue is static within a run
 * (registries are immutable after load) and owned entirely by the adapter.
 */

import type { BaseType, DatatypeDefinition, FieldDef } from '../../../engine/types/Datatype.js';
import type { DatatypeRegistry } from '../../../engine/types/DatatypeRegistry.js';
import type { EntityDefinition, PropertyDef, MethodDef, ArgDef } from '../../../engine/types/EntityDefinition.js';
import type { EntityRegistry } from '../../../engine/types/EntityRegistry.js';

import { FEATURE_SET_CLASS_DESCRIPTORS, FEATURE_SET_DATATYPE_DESCRIPTORS } from './featureSetCatalogue.js';
import { STANDARD_CLASS_DESCRIPTORS, STANDARD_DATATYPE_DESCRIPTORS } from './standardCatalogue.js';
import type {
  NcDatatypeDescriptor,
  NcClassDescriptor,
  NcPropertyDescriptor,
  NcMethodDescriptor,
  NcParameterDescriptor,
  NcFieldDescriptor,
} from './types.js';

// ---------------------------------------------------------------------------
// UCE BaseType → MS-05 primitive type name
// ---------------------------------------------------------------------------

const BASE_TYPE_MAP: Record<BaseType, string> = {
  numeric: 'NcFloat64',
  string: 'NcString',
  bool: 'NcBoolean',
  object: 'NcObject', // overridden when a type_def is present
};

function ucePrimitiveToMs05(type: BaseType): string {
  return BASE_TYPE_MAP[type];
}

// ---------------------------------------------------------------------------
// Field → NcFieldDescriptor
// ---------------------------------------------------------------------------

function fieldToDescriptor(field: FieldDef): NcFieldDescriptor {
  const typeName =
    field.type === 'object' && field.type_def !== undefined
      ? field.type_def
      : ucePrimitiveToMs05(field.type);
  return {
    name: field.id,
    typeName,
    isNullable: field.nullable ?? false,
    isSequence: field.is_array ?? false,
    constraints: null,
    description: '',
  };
}

// ---------------------------------------------------------------------------
// DatatypeDefinition → NcDatatypeDescriptor
// ---------------------------------------------------------------------------

function datatypeToDescriptor(def: DatatypeDefinition): NcDatatypeDescriptor {
  return {
    type: 'Struct',
    name: def.type_def,
    description: '',
    fields: def.fields.map(fieldToDescriptor),
    parentType: null,
    constraints: null,
  };
}

// ---------------------------------------------------------------------------
// Built-in primitive descriptors (one per UCE BaseType)
// ---------------------------------------------------------------------------

function builtInPrimitives(): NcDatatypeDescriptor[] {
  const primitives: Array<[string, string]> = [
    ['NcFloat64', 'IEEE 754 64-bit float (UCE numeric)'],
    ['NcString', 'UTF-8 string (UCE string)'],
    ['NcBoolean', 'Boolean (UCE bool)'],
  ];
  return primitives.map(([name, description]) => ({
    type: 'Primitive' as const,
    name,
    description,
    constraints: null,
  }));
}

// ---------------------------------------------------------------------------
// PropertyDef → NcPropertyDescriptor
// ---------------------------------------------------------------------------

function propertyToDescriptor(prop: PropertyDef, index: number): NcPropertyDescriptor {
  const typeName =
    prop.type === 'object' && prop.type_def !== undefined
      ? prop.type_def
      : ucePrimitiveToMs05(prop.type);
  return {
    id: { level: 3, index: index + 1 }, // level 3 = user-defined class properties
    name: prop.id,
    typeName,
    isReadOnly: prop.read_only ?? false,
    isNullable: prop.nullable ?? false,
    isSequence: prop.is_array ?? false,
    isDeprecated: false,
    description: '',
    constraints: null,
  };
}

// ---------------------------------------------------------------------------
// ArgDef → NcParameterDescriptor
// ---------------------------------------------------------------------------

function argToDescriptor(arg: ArgDef): NcParameterDescriptor {
  const typeName =
    arg.type === 'object' && arg.type_def !== undefined
      ? arg.type_def
      : ucePrimitiveToMs05(arg.type);
  return {
    name: arg.id,
    typeName,
    isNullable: false,
    isSequence: arg.is_array ?? false,
    description: '',
    constraints: null,
  };
}

// ---------------------------------------------------------------------------
// MethodDef → NcMethodDescriptor
// ---------------------------------------------------------------------------

function methodToDescriptor(method: MethodDef, index: number): NcMethodDescriptor {
  // NcMethodDescriptor.resultDatatype is NcName (isNullable: false) per MS-05-02.
  // Methods with no specific return value (return_value.type === null) still wrap
  // their result in NcMethodResult (status code only), so we use that as the datatype.
  const resultDatatype =
    method.return_value.type === null
      ? 'NcMethodResult'
      : method.return_value.type === 'object' && method.return_value.type_def !== undefined
        ? method.return_value.type_def
        : ucePrimitiveToMs05(method.return_value.type);
  return {
    id: { level: 3, index: index + 1 },
    name: method.id,
    resultDatatype,
    parameters: method.args.map(argToDescriptor),
    isDeprecated: false,
    description: '',
  };
}

// ---------------------------------------------------------------------------
// EntityDefinition → NcClassDescriptor
// ---------------------------------------------------------------------------

function entityToDescriptor(def: EntityDefinition, classId: readonly number[]): NcClassDescriptor {
  return {
    classId,
    name: def.entity_name,
    fixedRole: null,
    description: '',
    properties: def.properties.map(propertyToDescriptor),
    methods: def.methods.map(methodToDescriptor),
    events: [],
  };
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export interface Catalogue {
  /** All NcDatatypeDescriptors: built-in primitives + user type_defs. */
  readonly datatypes: ReadonlyMap<string, NcDatatypeDescriptor>;
  /** All NcClassDescriptors: one per EntityDefinition. */
  readonly classes: ReadonlyMap<string, NcClassDescriptor>;
}

/**
 * Build a Catalogue from the engine's DatatypeRegistry and EntityRegistry.
 * classId assignment: [1, N] where N is the 1-based position in entity_names().
 */
export function buildCatalogue(
  datatypeRegistry: DatatypeRegistry,
  entityRegistry: EntityRegistry,
): Catalogue {
  // Datatypes: standard first, then user-defined type_defs (user entries override if same name)
  const datatypes = new Map<string, NcDatatypeDescriptor>();

  for (const std of STANDARD_DATATYPE_DESCRIPTORS) {
    datatypes.set(std.name, std);
  }

  // Also include legacy built-in primitives that may not be in standard set
  for (const prim of builtInPrimitives()) {
    if (!datatypes.has(prim.name)) datatypes.set(prim.name, prim);
  }

  for (const fs of FEATURE_SET_DATATYPE_DESCRIPTORS) {
    datatypes.set(fs.name, fs);
  }

  for (const name of datatypeRegistry.names()) {
    const def = datatypeRegistry.get(name);
    datatypes.set(def.type_def, datatypeToDescriptor(def));
  }

  // Classes: standard classes first, then user-defined (classId = [1, 2, index+1] to avoid clash)
  const classes = new Map<string, NcClassDescriptor>();

  for (const std of STANDARD_CLASS_DESCRIPTORS) {
    classes.set(std.name, std);
  }

  for (const fs of FEATURE_SET_CLASS_DESCRIPTORS) {
    classes.set(fs.name, fs);
  }

  const names = entityRegistry.names();
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (name === undefined) continue;
    const def = entityRegistry.get(name);
    const classId = [1, 0, i + 1] as const; // authority key 0 = vendor-defined (MS-05-02 §4)
    classes.set(def.entity_name, entityToDescriptor(def, classId));
  }

  return { datatypes, classes };
}
