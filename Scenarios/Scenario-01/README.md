# Scenario-01 — MQTT → IS-12 Basic Scenario

Demonstrates a bidirectional sync of a single string value between an MQTT
broker and an IS-12/MS-05-02 device model.

| Side      | Protocol | Topic / Property                        |
|-----------|----------|-----------------------------------------|
| Ingress   | MQTT     | `devices/device-01/label` (UTF-8 string)|
| Egress    | IS-12    | Root block `userLabel` (NcObject 1p6)   |

A value published to the MQTT topic is propagated to the IS-12 device model,
and a write to `userLabel` via IS-12 is published back to the MQTT topic.

---

## Prerequisites

| Requirement          | Details                                                     |
|----------------------|-------------------------------------------------------------|
| Node.js              | 20 LTS or later                                             |
| MQTT broker          | Any MQTT v3.1.1/v5 broker (e.g. Mosquitto, EMQX, HiveMQ)  |
| Environment variable | `MQTT_BROKER_URL` — MQTT connection URL (default below)     |

Install dependencies from the repository root:

```bash
npm install
```

---

## Environment Variables

| Variable         | Default                   | Description                       |
|------------------|---------------------------|-----------------------------------|
| `MQTT_BROKER_URL`| `mqtt://localhost:1883`   | MQTT broker connection URL        |
| `IS12_WS_PORT`   | `9001` (hardcoded in yaml)| IS-12 WebSocket listen port       |

---

## Running the Scenario

> **Prerequisites:** build the project first with `npm run build` (from the repo root).
> The compiled entry point is `dist/app.js`.

### 1. Start a local MQTT broker (example with Mosquitto)

```bash
mosquitto -p 1883
```

### 2. Set environment variables (optional — defaults shown)

```bash
export MQTT_BROKER_URL=mqtt://localhost:1883
```

### 3. Build and run the bridge

```bash
# From the repo root
npm run build
node dist/app.js Scenarios/Scenario-01/bridge.yaml
```

Alternatively, use the `BRIDGE_CONFIG` environment variable:

```bash
BRIDGE_CONFIG=Scenarios/Scenario-01/bridge.yaml node dist/app.js
```

The bridge logs structured JSON to stdout. Expected startup output (pretty-printed):

```json
{ "level": "info", "msg": "Protocol Bridge 'scenario-01' starting\u2026" }
{ "level": "info", "msg": "Model loaded", "entities": 1, "datatypes": 0 }
{ "level": "info", "adapterId": "mqtt-ingress", "msg": "Adapter 'mqtt-ingress' (mqtt) started" }
{ "level": "info", "adapterId": "is12-egress",  "msg": "Adapter 'is12-egress' (nmos-is12) started" }
{ "level": "info", "msg": "All adapters started \u2014 bridge is running" }
```

Stop with **Ctrl-C** — the bridge catches `SIGINT`/`SIGTERM` and shuts down cleanly.

---

## Verification

### Automated integration test

Covers T1–T5 without an external MQTT broker:

```bash
npx vitest run test/scenarios/Scenario-01.test.ts --reporter=verbose
```

Expected: **20 tests pass**.

### Manual MQTT → IS-12 round-trip

**Step 1** — publish a value to the MQTT topic:

```bash
mosquitto_pub -h localhost -t devices/device-01/label -r -m "hello-world"
```

**Step 2** — connect a WebSocket client and send an IS-12 `Get userLabel` command.
The entire JSON object below is the message to send (note the outer `messageType` envelope —
do **not** send just the inner `commands` array):

```bash
wscat -c ws://localhost:9001
```

Once connected, paste this single message:

```json
{"messageType":0,"commands":[{"handle":1,"oid":1,"methodId":{"level":1,"index":1},"arguments":{"id":{"level":1,"index":6}}}]}
```

Expected response:

```json
{"messageType":1,"responses":[{"handle":1,"result":{"status":200,"value":"hello-world"}}]}
```

### Manual IS-12 → MQTT write-back

**Step 1** — subscribe to the topic in one terminal:

```bash
mosquitto_sub -h localhost -t devices/device-01/label
```

**Step 2** — connect a WebSocket client and send an IS-12 `Set userLabel` command:

```bash
wscat -c ws://localhost:9001
```

Once connected, paste this single message:

```json
{"messageType":0,"commands":[{"handle":2,"oid":1,"methodId":{"level":1,"index":2},"arguments":{"id":{"level":1,"index":6},"value":"updated-label"}}]}
```

Expected response on the WebSocket:

```json
{"messageType":1,"responses":[{"handle":2,"result":{"status":200}}]}
```

Expected output in the `mosquitto_sub` terminal:

```
updated-label
```

---

## IS-12 / MS-05-02 Device Model

The egress adapter spawns a spec-compliant device model:

| OID | Role            | ClassId       |
|-----|-----------------|---------------|
| 1   | Root block      | `[1, 1]`      |
| 3   | DeviceManager   | `[1, 3, 1]`   |
| 4   | ClassManager    | `[1, 3, 2]`   |
| 5+  | User nodes      | `[1, 1, ...]` |

- `NcDeviceManager` and `NcClassManager` are always present (MS-05-02 §7).
- All objects expose the standard NcObject level-1 properties (classId 1p1
  through runtimePropertyConstraints 1p8) and the `PropertyChanged` (1e1)
  event.
- `userLabel` (1p6) on every object is writable and propagates changes back
  to the MQTT topic via the ingress write-back rule.

---

## Artefact Layout

```
Scenarios/Scenario-01/
├── bridge.yaml                  # Top-level wiring config
├── README.md                    # This file
├── model/
│   ├── entities.yaml            # RootBlock entity definition
│   ├── datatypes.yaml           # Empty (no struct types needed)
│   └── tree.yaml                # Root instance with initial label=""
└── mapping/
    ├── ingress.mqtt.json        # MQTT topic → root.label rule + write-back
    └── egress.is12.json         # RootBlock.label → IS-12 userLabel (1p6)
```
