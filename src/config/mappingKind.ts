/**
 * E21.T1 — Mapping validation dispatch by (protocol, kind).
 */

export type MappingValidationKind = 'ingress-rules' | 'egress-class-projection';

/** Select which mapping schema/validator applies to an adapter instance. */
export function mappingValidationKind(
  protocol: string,
  kind: 'ingress' | 'egress',
): MappingValidationKind {
  if (protocol === 'mqtt' && kind === 'ingress') return 'ingress-rules';
  if (protocol === 'mqtt' && kind === 'egress') return 'ingress-rules';
  if (protocol === 'nmos-is12' && kind === 'ingress') return 'egress-class-projection';
  if (protocol === 'nmos-is12' && kind === 'egress') return 'egress-class-projection';
  throw new Error(
    `No mapping validation kind for protocol '${protocol}' kind '${kind}'`,
  );
}
