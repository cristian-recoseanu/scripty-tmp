# Protocol Bridge

A configurable **Node.js + TypeScript** application that ingests data from one protocol, normalises it
into a **protocol-neutral internal model**, and re-emits it through one or more other protocols.

> **Phase 1** uses **MQTT** as the example Ingress and **NMOS IS-12 / MS-05** as the example Egress —
> but these are just configuration. The core knows nothing about any specific protocol.

For the full design see [`docs/Architecture.md`](docs/Architecture.md); for the implementation backlog
see [`docs/TaskList.md`](docs/TaskList.md).

---

## Concepts

The system is built around three roles:

- **Ingress** — the source-facing adapter that brings external data **into** the engine
  (e.g. an MQTT subscriber). It translates raw wire payloads into normalised operations.
- **UCE (Unified Communication Engine)** — the **protocol-neutral core** and single source of truth.
  It holds an object tree (objects with typed properties, methods and nested children), a flexible
  type system, a serialization layer, and an internal message bus. It depends on **no** protocol.
- **Egress** — the consumer-facing adapter that projects the engine **outward**
  (e.g. an NMOS IS-12 WebSocket server). Multiple Egress endpoints can run at once (fan-out).

```
  Ingress source ──►  Ingress Adapter ──►   UCE (object tree + types + bus)  ──►  Egress Adapter ──► consumers
  (e.g. MQTT)         (e.g. MQTT)      ◄──   single source of truth          ◄──  (e.g. IS-12)
       write-back ◄───────────────────────────────────────────────────────────────────┘
```

**Synchronization is bidirectional by design.** A change to a property — from _either_ side — is
propagated to every adapter that maps it, with origin tagging and echo suppression to prevent feedback
loops. An IS-12 `Set`, for example, updates the UCE and is written back to the mapped MQTT topic while
also notifying other IS-12 controllers.

### Architectural rule (enforced)

The engine **never** depends on an adapter or any protocol package. This one-way dependency
(`adapters → engine`, never the reverse) is enforced automatically by `dependency-cruiser`
(`npm run arch:check`), so new protocols can be added as pure adapters with no engine changes.

---

## Requirements

- **Node.js 20+ LTS** (see [`.nvmrc`](.nvmrc) — run `nvm use` if you use nvm)
- **npm** (ships with Node)

## Getting started

```bash
# 1. Use the pinned Node version (optional, if you use nvm)
nvm use

# 2. Install dependencies
npm install

# 3. Type-check and build
npm run build
```

## Running

```bash
# Run the built application
npm start

# Or run in watch mode during development (no build step needed)
npm run dev
```

> Phase 1 wiring (config loading, tree building, adapter startup) is implemented incrementally — see
> the epics in [`docs/TaskList.md`](docs/TaskList.md). The entry point is [`src/app.ts`](src/app.ts).

## Testing

The project uses [Vitest](https://vitest.dev/) with v8 coverage.

```bash
# Run the full test suite once
npm test

# Re-run tests on change
npm run test:watch

# Run tests with coverage (engine target ≥90%, adapters ≥80%)
npm run coverage
```

## Quality gates

A single command mirrors the CI pipeline and is the recommended local check before committing:

```bash
npm run validate     # typecheck → lint → arch:check → coverage
```

Individual gates:

| Command                | Purpose                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| `npm run typecheck`    | TypeScript strict type-checking (no emit)                        |
| `npm run lint`         | ESLint (typescript-eslint, import hygiene, no-floating-promises) |
| `npm run format:check` | Prettier formatting check (`npm run format` to fix)              |
| `npm run arch:check`   | Enforces the engine → adapter independence boundary              |
| `npm run coverage`     | Tests + coverage thresholds                                      |

A **husky** pre-commit hook runs `lint-staged` to lint and format staged files automatically.

---

## Project structure

```
src/
  engine/            # Protocol-neutral core (UCE) — no protocol imports allowed
    types/           # Datatype, DatatypeRegistry, constraints, primitives
    model/           # ObjectNode, ObjectTree, descriptors
    bus/             # UceBus + Operation definitions
    serialization/   # toJSON / snapshot / marshalling
  adapters/          # The only protocol-aware components
    mqtt/            # Ingress example: MQTT
    nmos-is12/       # Egress example: IS-12 / MS-05
  mapping/           # Config-driven Ingress/Egress translation DSLs + transforms
  config/            # YAML/JSON config loading + schema validation
  observability/     # Structured logging, metrics, health
  app.ts             # Bootstrap entry point
test/                # Unit + integration tests (mirrors src/ layout)
docs/                # Architecture.md, TaskList.md
```

## Technology stack

| Concern                  | Choice                                        |
| ------------------------ | --------------------------------------------- |
| Runtime / language       | Node.js 20+ LTS, TypeScript 5.x (strict, ESM) |
| Ingress (Phase 1)        | `mqtt` (MQTT.js)                              |
| Egress (Phase 1)         | `ws` (WebSocket)                              |
| Schema validation        | `ajv` (JSON Schema) + `zod` (runtime guards)  |
| Config                   | `yaml`                                        |
| Logging                  | `pino`                                        |
| Testing                  | `vitest`                                      |
| Lint / format            | `eslint` + `prettier`                         |
| Architecture enforcement | `dependency-cruiser`                          |
