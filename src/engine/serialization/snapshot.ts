/**
 * Snapshot & restore — E4.T4.
 *
 * snapshot(tree)  → SerializedNode (deterministic JSON shape from E3.T7)
 * restore(json)   → InstanceNodeImpl tree ready to be set as root on a new InstanceTree
 *
 * The restore path recreates InstanceNodeImpl nodes from SerializedNode data.
 * Because descriptors (PropertyDescriptor / MethodDescriptor) are not stored in the
 * serialized format (they come from EntityDefinitions, loaded separately), this
 * restore operation rebuilds nodes with **no descriptors** — the property values
 * are stored as plain object-slot properties with type inferred from the value.
 * Full descriptor-aware restore (with EntityRegistry) is an E7 concern.
 *
 * No protocol-specific identifiers may appear in this file.
 */

import type { ModelValue, SerializedNode } from '../model/ObjectNode.js';
import { InstanceNodeImpl } from '../model/ObjectNodeImpl.js';
import { InstanceTree } from '../model/ObjectTree.js';

// ---------------------------------------------------------------------------
// snapshot — E4.T4
// ---------------------------------------------------------------------------

/**
 * Serializes the full instance tree to a deterministic SerializedNode.
 * Returns null if the tree has no root.
 */
export function snapshot(tree: InstanceTree): SerializedNode | null {
  return tree.toJSON();
}

// ---------------------------------------------------------------------------
// restore — E4.T4
// ---------------------------------------------------------------------------

/**
 * Rebuilds an InstanceTree from a SerializedNode snapshot.
 *
 * Each node is reconstructed with:
 *  - identity derived from the serialized `location`, `entity_def`, and computed `path`
 *  - no PropertyDescriptors / MethodDescriptors (schema-less restore)
 *  - property values re-applied via direct internal _values reconstruction
 *
 * Schema-aware restore (validating against EntityRegistry) belongs to E7.T3.
 */
export function restore(root: SerializedNode): InstanceTree {
  const tree = new InstanceTree();
  const rootNode = _restoreNode(root, '');
  tree.setRoot(rootNode);
  return tree;
}

function _restoreNode(node: SerializedNode, parentPath: string): InstanceNodeImpl {
  const path = parentPath.length > 0 ? `${parentPath}/${node.location}` : node.location;
  const impl = new InstanceNodeImpl(
    { location: node.location, entity_def: node.entity_def, path },
    [],
    [],
  );
  // Restore property values via setProperty (no descriptors — use _raw setter)
  for (const prop of node.properties) {
    _setValueDirect(impl, prop.id, prop.value);
  }
  for (const child of node.children) {
    const childNode = _restoreNode(child, path);
    impl.addChild(childNode);
  }
  return impl;
}

/**
 * Injects a value directly into an InstanceNodeImpl without descriptor validation.
 * Used only during restore where there are no registered descriptors.
 */
function _setValueDirect(node: InstanceNodeImpl, id: string, value: ModelValue): void {
  node._getRawValues().set(id, value);
}
