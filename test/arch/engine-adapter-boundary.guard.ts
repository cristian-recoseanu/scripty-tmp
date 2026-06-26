/**
 * ARCHITECTURAL BOUNDARY GUARD FIXTURE
 *
 * This file INTENTIONALLY contains an import that violates the rule:
 *   engine/** must not import from adapters/**
 *
 * It exists only to be checked by `npm run arch:check:guard`, which asserts that
 * dependency-cruiser detects exactly this violation.
 *
 * DO NOT reference this file from any source or other test — it must only be
 * processed by the arch:check:guard script in CI to confirm the rule fires.
 *
 * @see .dependency-cruiser.cjs — rule: no-engine-to-adapters
 */

// The import below is the deliberate violation; the path does not need to resolve at runtime.
// depcruise reads it statically.
import type {} from '../../src/adapters/mqtt/index.js';

export {};
