/**
 * E7.T5 — Zod schemas + derived TypeScript types for the bridge config.
 *
 * All runtime config objects flowing through the app are produced by these
 * zod parsers — no `any` leaks downstream.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const BaseTypeSchema = z.enum(['string', 'bool', 'numeric', 'object']);

const ConstraintsSchema = z
  .object({
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional(),
    pattern: z.string().optional(),
    minItems: z.number().int().nonnegative().optional(),
    maxItems: z.number().int().nonnegative().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Datatypes (model/datatypes.yaml)
// ---------------------------------------------------------------------------

export const FieldDefSchema = z
  .object({
    id: z.string().min(1),
    type: BaseTypeSchema,
    is_array: z.boolean().optional(),
    type_def: z.string().optional(),
    nullable: z.boolean().optional(),
    constraints: ConstraintsSchema.optional(),
    description: z.string().optional(),
  })
  .strict();

export const DatatypeDefSchema = z
  .object({
    type_def: z.string().min(1),
    fields: z.array(FieldDefSchema),
    description: z.string().optional(),
  })
  .strict();

export const DatatypesFileSchema = z.object({
  datatypes: z.array(DatatypeDefSchema).min(0),
});

export type ParsedDatatypeDef = z.infer<typeof DatatypeDefSchema>;
export type ParsedDatatypesFile = z.infer<typeof DatatypesFileSchema>;

// ---------------------------------------------------------------------------
// Entities (model/entities.yaml)
// ---------------------------------------------------------------------------

export const ArgDefSchema = z
  .object({
    id: z.string().min(1),
    type: BaseTypeSchema,
    is_array: z.boolean().optional(),
    type_def: z.string().optional(),
    description: z.string().optional(),
  })
  .strict();

export const ReturnDefSchema = z
  .object({
    type: BaseTypeSchema.nullable(),
    is_array: z.boolean().optional(),
    type_def: z.string().optional(),
    description: z.string().optional(),
  })
  .strict();

export const PropertyDefSchema = z
  .object({
    id: z.string().min(1),
    type: BaseTypeSchema,
    is_array: z.boolean().optional(),
    type_def: z.string().optional(),
    read_only: z.boolean().optional(),
    observable: z.boolean().optional(),
    nullable: z.boolean().optional(),
    constraints: ConstraintsSchema.optional(),
    description: z.string().optional(),
  })
  .strict();

export const MethodDefSchema = z
  .object({
    id: z.string().min(1),
    args: z.array(ArgDefSchema),
    return_value: ReturnDefSchema,
    description: z.string().optional(),
  })
  .strict();

export const EntityDefSchema = z
  .object({
    entity_name: z.string().min(1),
    properties: z.array(PropertyDefSchema),
    methods: z.array(MethodDefSchema),
    description: z.string().optional(),
  })
  .strict();

export const EntitiesFileSchema = z.object({
  entities: z.array(EntityDefSchema).min(1),
});

export type ParsedEntityDef = z.infer<typeof EntityDefSchema>;
export type ParsedEntitiesFile = z.infer<typeof EntitiesFileSchema>;

// ---------------------------------------------------------------------------
// Tree (model/tree.yaml) — recursive
// ---------------------------------------------------------------------------

export const TreePropertyValueSchema = z
  .object({
    id: z.string().min(1),
    value: z.unknown(),
  })
  .strict();

export type ParsedTreeNode = {
  location: string;
  entity_def: string;
  properties: z.infer<typeof TreePropertyValueSchema>[];
  children: ParsedTreeNode[];
};

export const TreeNodeSchema: z.ZodType<ParsedTreeNode> = z.lazy(() =>
  z
    .object({
      location: z.string().min(1),
      entity_def: z.string().min(1),
      properties: z.array(TreePropertyValueSchema),
      children: z.array(TreeNodeSchema),
    })
    .strict(),
);

// ---------------------------------------------------------------------------
// Master bridge config (bridge.yaml) — E7.T2
// ---------------------------------------------------------------------------

const InstanceSchema = z
  .object({
    name: z.string().min(1),
    logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  })
  .strict();

const ModelRefSchema = z
  .object({
    entities: z.string().min(1),
    datatypes: z.string().min(1),
    tree: z.string().min(1),
  })
  .strict();

const IngressSchema = z
  .object({
    id: z.string().min(1),
    protocol: z.string().min(1),
    config: z.record(z.unknown()),
    mapping: z.string().min(1),
  })
  .strict();

const EgressSchema = z
  .object({
    id: z.string().min(1),
    protocol: z.string().min(1),
    config: z.record(z.unknown()),
    mapping: z.string().min(1),
  })
  .strict();

export const BridgeConfigSchema = z
  .object({
    instance: InstanceSchema,
    model: ModelRefSchema,
    /** Exactly one ingress (object, not array). */
    ingress: IngressSchema,
    /** One or more egress endpoints. */
    egress: z.array(EgressSchema).min(1),
  })
  .strict();

export type ParsedBridgeConfig = z.infer<typeof BridgeConfigSchema>;
export type ParsedIngressConfig = z.infer<typeof IngressSchema>;
export type ParsedEgressConfig = z.infer<typeof EgressSchema>;
