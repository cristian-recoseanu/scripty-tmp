/**
 * Resolve MS-05 role paths to runtime oids on a remote IS-12 device.
 *
 * Oids are volatile; ingress mapping uses stable role paths only. Resolution
 * happens at connect (and reconnect) via NcBlock.FindMembersByPath on the root block.
 */

import { NC_BLOCK_METHOD } from './ms05/NcObjectMethods.js';
import { NcMethodStatus } from './ms05/types.js';

import type { Is12IngressClient } from './Is12IngressClient.js';
import type { NcBlockMemberDescriptor } from './ms05/types.js';

/** Split a slash-separated role path into MS-05 NcRolePath segments. */
export function parseRolePath(rolePath: string): string[] {
  return rolePath.split('/').map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Resolve a role path relative to `rootOid` to a single member oid.
 * Returns undefined when the path is missing or ambiguous.
 */
export async function resolveRolePathToOid(
  client: Is12IngressClient,
  rootOid: number,
  rolePath: string,
): Promise<number | undefined> {
  const trimmed = rolePath.trim();
  if (trimmed === '.' || trimmed === '@') {
    return rootOid;
  }

  const path = parseRolePath(rolePath);
  if (path.length === 0) return undefined;

  const resp = await client.command({
    oid: rootOid,
    methodId: NC_BLOCK_METHOD.FindMembersByPath,
    arguments: { path },
  });
  const result = resp.responses[0]?.result;
  if (result?.status !== NcMethodStatus.Ok) return undefined;

  const members = (result as { value?: NcBlockMemberDescriptor[] }).value;
  if (members === undefined || members.length === 0) return undefined;
  if (members.length > 1) return undefined;
  return members[0]!.oid;
}

/** Resolve many role paths; skips paths that fail to resolve. */
export async function resolveRolePaths(
  client: Is12IngressClient,
  rootOid: number,
  rolePaths: readonly string[],
): Promise<Map<string, number>> {
  const resolved = new Map<string, number>();
  for (const rolePath of rolePaths) {
    const oid = await resolveRolePathToOid(client, rootOid, rolePath);
    if (oid !== undefined) {
      resolved.set(rolePath, oid);
    }
  }
  return resolved;
}
