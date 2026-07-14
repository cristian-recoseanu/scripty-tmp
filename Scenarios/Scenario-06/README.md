# Scenario-06 — IS-12 Ingress → IS-12 Egress (bidirectional block sync)

**Document version:** `4`

Scenario-06 proves **same-protocol IS-12 relay**: the bridge is simultaneously an **IS-12 client**
(ingress, connected to a **remote device**) and an **IS-12 device/server** (egress, local NCP with
**IS-04 Node API**). The remote device exposes a nested block with **role `receivers`** and writable
`userLabel` (`1p6`); the local device exposes `root/egress` with `userLabel`. Both are kept in sync
through the UCE via **`relays`** in `bridge.yaml`.

## Topology

```
Remote IS-12 device (real device or fixture)           This bridge
root                                                  UCE
└── receivers (role, userLabel) ◄── IS-12 client ──► root/receivers-block.userLabel
                                                          │ relays
                                                          ▼
              IS-12 device/server + IS-04 Node API ◄── root/egress-block.userLabel
root
└── egress (userLabel)
```

## Role-path ingress mapping (no configured oids)

Remote **oids are volatile** — they may change across device restarts. Ingress mapping therefore
uses **role paths** only. At connect the adapter calls `NcBlock.FindMembersByPath` on the remote
root to resolve each path to the current runtime oid.

```yaml
# mapping/ingress.is12.yaml
instances:
  - location: root/receivers-block   # UCE node
    rolePath: receivers              # remote block role under root
```

Use `.` as `rolePath` when mapping properties on the remote **root block** itself.

Nested example: `stereo-gain/channel-gain` → left-gain worker under channel-gain block.

## Prerequisites

1. **Remote IS-12 device** with `root` → nested block **role `receivers`** and writable `userLabel`
   (`1p6`). For automated tests, use `fixtures/remote-device/` as an in-process stand-in.
2. Node.js 20+ and project dependencies (`npm ci`).

## Artefacts

| File | Role |
| --- | --- |
| `bridge.yaml` | IS-12 ingress + egress + `relays` linking UCE blocks |
| `model/` | UCE `receivers-block` and `egress-block` under `root` |
| `mapping/ingress.is12.yaml` | Remote role path → UCE `ReceiversBlock` |
| `mapping/egress.is12.yaml` | UCE → local `egress` block class projection |
| `fixtures/remote-device/` | Minimal remote device stand-in for tests / dev |

## Endpoints (local egress)

| Service | URL |
| --- | --- |
| IS-04 Node API | `http://localhost:9002/x-nmos/node/v1.3/` |
| IS-12 NCP (WebSocket) | `ws://localhost:9002/x-nmos/ncp/v1.0` |

## Property ↔ block map

| UCE location | Remote device (ingress) | Local device (egress) |
| --- | --- | --- |
| `root/receivers-block.userLabel` | role path `receivers`, `1p6` | — |
| `root/egress-block.userLabel` | — | `root/egress` block `1p6` |

## Run steps

### (a) Point ingress at your remote device

```bash
export IS12_REMOTE_WS_URL=ws://<remote-host>:<port>/x-nmos/ncp/v1.0
```

### (b) Run Scenario-06 bridge

```bash
node dist/app.js Scenarios/Scenario-06/bridge.yaml
```

### (c) Remote `receivers` → local `egress`

`Set` `userLabel` on the remote **`receivers`** block. `Get` `userLabel` on the local **`egress`**
block (oid **5** on the local device with the default tree).

### (d) Local `egress` → remote `receivers`

`Set` `userLabel` on the local **`egress`** block via `ws://localhost:9002/x-nmos/ncp/v1.0`.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `failed to resolve role path` | `rolePath` matches remote `Get` Role (`1p5`); path is relative to root |
| Wrong block synced | Fix `instances.rolePath` — never use numeric oids in mapping |
| No IS-04 REST API | `is04.nodeApi.enabled: true` in egress config |
| One direction only | `relays` in `bridge.yaml`; writable ingress mapping |

## Automated test

```bash
npm run test -- test/scenarios/Scenario-06.e2e.test.ts
```
