# scripty-tmp (Talk My Protocol)

[![CI](https://github.com/cristian-recoseanu/scripty-tmp/actions/workflows/unit-tests.yml/badge.svg)](https://github.com/cristian-recoseanu/scripty-tmp/actions/workflows/unit-tests.yml)

A configurable **Node.js + TypeScript** framework for mapping data between protocols. It ingests
from one or more **Ingress** adapters, normalises updates into a **protocol-neutral internal model**,
and re-emits them through one or more **Egress** adapters.

> **Phase 1** uses **MQTT** as the example Ingress and **NMOS IS-12 / MS-05** as the example Egress —
> but these are configuration only. The core knows nothing about any specific protocol.

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

- **Node.js 20+ LTS**
- **npm** (ships with Node)

## Getting started

```bash
npm install
npm run build
```

## Running

```bash
# Run the built application (requires a bridge config path)
npm start -- Scenarios/Scenario-01/bridge.yaml

# Print build version / provenance (requires a prior `npm run build`)
node dist/app.js --version

# Or run in watch mode during development (no build step needed)
npm run dev -- Scenarios/Scenario-01/bridge.yaml
```

The entry point is [`src/app.ts`](src/app.ts). Worked examples live under [`Scenarios/`](Scenarios/):

| Scenario | Description |
| -------- | ----------- |
| [Scenario-01](Scenarios/Scenario-01/README.md) | Minimal MQTT → IS-12 string mapping |
| [Scenario-02](Scenarios/Scenario-02/README.md) | MQTT numeric → `NcReceiverMonitor` `linkStatus` |
| [Scenario-03](Scenarios/Scenario-03/README.md) | Dual monitors, per-domain-status MQTT, derived `overallStatus` |

Each scenario includes its own `bridge.yaml`, model, mappings, and runbook.

## Testing

The project uses [Vitest](https://vitest.dev/) with v8 coverage.

```bash
npm test              # run once
npm run test:watch    # re-run on change
npm run coverage      # tests + coverage thresholds
```

## Quality gates

A single command mirrors the CI pipeline and is the recommended local check before committing:

```bash
npm run validate     # typecheck → lint → arch:check → coverage
npm run audit:check  # fail on high+ severity npm advisories
npm run sbom         # CycloneDX SBOM → sbom.json
```

Individual gates:

| Command                | Purpose                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| `npm run build`        | Compile to `dist/` and write `dist/build-info.json` (version stamp) |
| `npm run typecheck`    | TypeScript strict type-checking (no emit)                        |
| `npm run lint`         | ESLint (typescript-eslint, import hygiene, no-floating-promises) |
| `npm run format:check` | Prettier formatting check (`npm run format` to fix)              |
| `npm run arch:check`   | Enforces the engine → adapter independence boundary              |
| `npm run coverage`     | Tests + coverage thresholds                                      |
| `npm run audit:check`  | Dependency audit — fails on high+ severity CVEs                  |
| `npm run sbom`         | Generate CycloneDX SBOM for supply-chain visibility              |

A **husky** pre-commit hook runs `lint-staged` to lint and format staged files automatically.

### Releases

Push a semver tag (`v*`) to trigger the release workflow: it builds a stamped artifact, generates an SBOM,
writes a changelog from commits since the previous tag, and publishes a GitHub Release with the tarball
and `sbom.json` attached.

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
Scenarios/           # Worked bridge examples (model, mappings, bridge.yaml, README)
test/                # Unit + integration tests (mirrors src/ layout)
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
