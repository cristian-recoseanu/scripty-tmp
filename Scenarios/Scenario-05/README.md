# Scenario-05 — MQTT Ingress ↔ MQTT Egress (bidirectional topic relay)

**Document version:** `2`

Scenario-05 proves **same-protocol bidirectional relay**: the bridge subscribes on a **source MQTT
topic**, normalises the payload into the UCE, and **publishes on a destination MQTT topic**; writes on
the destination **set-topic** flow back through the UCE to the source topic. Ingress and egress use
**independent broker connections** — they may point at the same broker or different hosts.

## Topology

```
Broker A (source)                              Broker B (destination)
plant/source/value ◄── write-back ──┐          plant/dest/value (retained state)
       ▲                            │                 ▲
       │                            UCE               │
       └──── MQTT Ingress ──► root.value ◄── MQTT Egress
                                      ▲
                                      └── plant/dest/value/set (inbound writes)
```

## Prerequisites

- Node.js 20+ and project dependencies (`npm ci`)
- One or two MQTT brokers (e.g. Mosquitto)

## Environment variables

| Variable | Default | Role |
| --- | --- | --- |
| `MQTT_SOURCE_BROKER_URL` | `mqtt://localhost:1883` | Ingress connection |
| `MQTT_DEST_BROKER_URL` | `mqtt://localhost:1884` | Egress connection |

For a **single broker**, set both variables to the same URL.

## Run steps

### (a) Start broker(s)

```bash
# Single broker on 1883 — set MQTT_DEST_BROKER_URL=mqtt://localhost:1883 when running the bridge
docker run --rm -p 1883:1883 eclipse-mosquitto:2

# Or two brokers on 1883 and 1884 for cross-broker demo
```

### (b) Run the bridge

```bash
export MQTT_SOURCE_BROKER_URL=mqtt://localhost:1883
export MQTT_DEST_BROKER_URL=mqtt://localhost:1884
node dist/app.js Scenarios/Scenario-05/bridge.yaml
```

### (c) Source → destination

```bash
# Terminal 1 — watch destination state topic (on dest broker)
mosquitto_sub -h localhost -p 1884 -t plant/dest/value -v

# Terminal 2 — publish on source topic (on source broker)
mosquitto_pub -h localhost -p 1883 -t plant/source/value -m "hello-relay"
```

Expected: `plant/dest/value hello-relay` (retained) on the destination broker.

### (d) Destination → source (reverse)

```bash
# Terminal 1 — watch source topic (on source broker)
mosquitto_sub -h localhost -p 1883 -t plant/source/value -v

# Terminal 2 — write via destination set-topic (on dest broker)
mosquitto_pub -h localhost -p 1884 -t plant/dest/value/set -m "from-dest"
```

Expected: `plant/source/value from-dest` on the source broker; retained `plant/dest/value` on the
destination broker also shows `from-dest`.

## Property ↔ topic map

| UCE property | MQTT source (ingress) | MQTT destination (egress) |
| --- | --- | --- |
| `root.value` | `plant/source/value` (subscribe + write-back) | `plant/dest/value` (retained publish) |
| `root.value` (writes) | — | `plant/dest/value/set` (subscribe) |

State is published on `plant/dest/value`; controllers write on `plant/dest/value/set` (split-topic
pattern, same as Scenario-04). Echo suppression prevents feedback loops when the ingress adapter
write-backs to `plant/source/value`.

## Automated test

```bash
npm run test -- test/scenarios/Scenario-05.e2e.test.ts
```

Uses two mock broker endpoints to assert cross-broker independence and bidirectional end-to-end relay.
