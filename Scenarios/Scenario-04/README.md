# Scenario-04 — IS-12 Ingress → MQTT Egress (bidirectional `userLabel`)

**Document version:** `2`

Scenario-04 proves the **reverse** of the Phase-1 vertical slice: the bridge is an **IS-12
client** (ingress) connected to a **remote IS-12 device** on the network, and an **MQTT
publisher** (egress) projecting UCE state onto MQTT topics.

## Topology

```
Remote IS-12 device (NCP server on the network)
        │
        │  WebSocket — this bridge is the IS-12 *client*
        ▼
IS-12 Ingress ──► UCE root.userLabel ──► MQTT Egress ──► bridge/root/userLabel (retained)
        ▲                    │                              │
        │                    └◄── bridge/root/userLabel/set ◄┘
        └──────── write-back Set (client) when MQTT set-topic changes UCE
```

Changing `userLabel` on **either** side propagates to the other:

- Change on the **remote device** (via any IS-12 controller) → retained MQTT topic update.
- Publish on **`bridge/root/userLabel/set`** → remote device `userLabel` updated via client `Set`.

## Prerequisites

1. **A remote IS-12 device** already running and reachable — e.g. another bridge instance
   with IS-12 egress (Scenario-01 works as a stand-in), or any compliant NCP device exposing
   a writable root `userLabel` (`1p6`). Scenario-04's ingress connects **to** it; this
   bridge does **not** host the device.
2. **MQTT broker** (e.g. Mosquitto on `localhost:1883`).
3. Node.js 20+ and project dependencies installed (`npm ci`).

## Artefacts

| File | Role |
| --- | --- |
| `bridge.yaml` | Main config — IS-12 ingress + MQTT egress |
| `model/entities.yaml` | UCE `Block` with writable `userLabel` |
| `model/tree.yaml` | Single `root` node |
| `mapping/ingress.is12.yaml` | Class-projection map: remote `userLabel` ↔ UCE |
| `mapping/egress.mqtt.yaml` | Outbound topic + inbound set-topic bindings |

## Property ↔ topic map

| UCE property | MQTT outbound (state) | MQTT inbound (set) | IS-12 (remote device) |
| --- | --- | --- | --- |
| `root.userLabel` | `bridge/root/userLabel` (retained) | `bridge/root/userLabel/set` | `1p6` on root OID |

> **Topic strategy:** this scenario uses **split topics** (retained state + `/set` command topic),
> similar to MQTT ingress `writeStrategy: command`. A **single-topic** mapping (same path for
> `match` and `reverse.topicTemplate`, as in Scenario-01) is also supported on MQTT egress; the
> adapter suppresses echoes from its own outbound publishes when read and write share a topic.

## Run steps

### (a) Start the remote IS-12 device and MQTT broker

```bash
# Terminal 1 — MQTT broker
docker run --rm -p 1883:1883 eclipse-mosquitto:2

# Terminal 2 — upstream IS-12 device (example: Scenario-01 bridge as device)
cd /path/to/scripty
node dist/app.js Scenarios/Scenario-01/bridge.yaml
# Note the WS port (default 9001) and path (/x-nmos/ncp/v1.0)
```

### (b) Run Scenario-04 bridge

```bash
export IS12_DEVICE_WS_URL=ws://localhost:9001/x-nmos/ncp/v1.0
export MQTT_BROKER_URL=mqtt://localhost:1883
node dist/app.js Scenarios/Scenario-04/bridge.yaml
```

### (c) Change `userLabel` on the remote device → observe MQTT

Use any IS-12 controller against the **remote device** (not this bridge) to `Set` root
`userLabel` (`1p6`). Subscribe to the retained topic:

```bash
mosquitto_sub -h localhost -t bridge/root/userLabel -v
```

You should see the new value on `bridge/root/userLabel`.

### (d) Publish on set-topic → observe remote device change

```bash
mosquitto_pub -h localhost -t bridge/root/userLabel/set -m "hello-from-mqtt"
```

`Get` root `userLabel` (`1p6`) on the **remote device** — it should read `hello-from-mqtt`.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Ingress `degraded` / reconnecting | `IS12_DEVICE_WS_URL` reachable; remote device WS path matches |
| MQTT publish missing | Broker URL; egress `publish.retain`; mapping `reverse.topicTemplate` |
| Feedback loop / duplicate Sets | Origin tagging — each adapter skips its own bus ops; echo suppression on MQTT inbound |
| `userLabel` not writable on device | Remote device must allow `Set` on `1p6`; ingress mapping must not set `readOnly: true` |

## Automated test

```bash
npm run test -- test/scenarios/Scenario-04.e2e.test.ts
```

The e2e test stands up an in-process IS-12 **device** stand-in and a mock MQTT broker,
then asserts both sync directions against the committed Scenario-04 artefacts.
