# Scenario-03 — MQTT Per-Domain-Status → NcReceiverMonitor + NcSenderMonitor

Extends Scenario-02 with an additional intermediate block and **per-domain-status MQTT topics**
for both a **BCP-008-01 NcReceiverMonitor** and a **BCP-008-02 NcSenderMonitor**.
`overallStatus` is **derived** from domain statuses (not MQTT-driven). IS-04 Node API is
enabled for **node/device/controls** discovery (IS-12 WebSocket URI); registry registration
is **disabled**. Sender and receiver resources referenced by monitor **touchpoints** are
hosted on an **external** IS-04 node — this bridge only exposes their UUIDs on IS-12.

---

## Device model topology

```
root (NcBlock [1,1] — entity type Block)
├── DeviceManager / ClassManager
├── receiver-monitors (NcBlock [1,1] — entity type Block)
│     └── rx-monitor-01 (NcReceiverMonitor [1,2,2,1])
└── sender-monitors (NcBlock [1,1] — entity type Block)
      └── tx-monitor-01 (NcSenderMonitor [1,2,2,2])
```

All block nodes share the same UCE entity type (`Block`); IS-12 member **roles** come from
tree locations (`receiver-monitors`, `sender-monitors`, etc.), not from entity names.

---

## MQTT topic map

### Receiver (`rx-monitor-01`)

| Topic | Property | Type |
|-------|----------|------|
| `devices/device-01/receivers/rx-1/link-status` | `linkStatus` | numeric 1–3 |
| `devices/device-01/receivers/rx-1/connection-status` | `connectionStatus` | numeric 0–3 |
| `devices/device-01/receivers/rx-1/external-sync-status` | `externalSynchronizationStatus` | numeric 0–3 |
| `devices/device-01/receivers/rx-1/stream-status` | `streamStatus` | numeric 0–3 |
| `devices/device-01/receivers/rx-1/sync-source-id` | `synchronizationSourceId` | string |

### Sender (`tx-monitor-01`)

| Topic | Property | Type |
|-------|----------|------|
| `devices/device-01/senders/tx-1/link-status` | `linkStatus` | numeric 1–3 |
| `devices/device-01/senders/tx-1/transmission-status` | `transmissionStatus` | numeric 0–3 |
| `devices/device-01/senders/tx-1/external-sync-status` | `externalSynchronizationStatus` | numeric 0–3 |
| `devices/device-01/senders/tx-1/essence-status` | `essenceStatus` | numeric 0–3 |
| `devices/device-01/senders/tx-1/sync-source-id` | `synchronizationSourceId` | string |

All status properties are read-only on IS-12; ingress drives updates and the adapter emits
`PropertyChanged` notifications. When a domain status changes, **derived `overallStatus`**
(3p1) is recomputed and notified per BCP-008-01/02.

---

## Touchpoints (external IS-04 resources)

Monitor touchpoints are configured in `mapping/egress.is12.yaml` and returned on IS-12
`touchpoints` (`1p7`). These UUIDs refer to sender/receiver resources on **another** IS-04
node — they are **not** served by this bridge's Node API.

| Monitor | Resource type | UUID (external) |
|---------|---------------|-----------------|
| `rx-monitor-01` | receiver | `6b73a87b-1234-0000-0000-000000000001` |
| `tx-monitor-01` | sender | `9bfe1101-5513-45fa-ae3b-7e668e317bd5` |

Verify touchpoints over IS-12 after starting the bridge (subscribe + Get, or use your IS-12 client).
Resolve the actual sender/receiver bodies on the external IS-04 node:

```bash
curl -s http://<external-is04-host>/x-nmos/node/v1.3/receivers/6b73a87b-1234-0000-0000-000000000001
curl -s http://<external-is04-host>/x-nmos/node/v1.3/senders/9bfe1101-5513-45fa-ae3b-7e668e317bd5
```

This bridge's Node API advertises only **node**, **device**, and **controls** (empty
`senders/` and `receivers/` collections).

---

## Prerequisites

- Node.js 20+ LTS
- MQTT broker (e.g. Mosquitto)

---

## Running

```bash
npm run build
MQTT_BROKER_URL=mqtt://localhost:1883 \
  node dist/app.js Scenarios/Scenario-03/bridge.yaml
```

- **IS-04 Node API**: `http://localhost:9005/x-nmos/node/v1.3/`
- **IS-12 WebSocket**: `ws://localhost:9005/x-nmos/ncp/v1.0` (shared port)

### Example: activate receiver stream path

With both `connectionStatus` and `streamStatus` set to `1` (Healthy), derived `overallStatus`
becomes `1` (Healthy):

```bash
mosquitto_pub -t devices/device-01/receivers/rx-1/connection-status -m 1
mosquitto_pub -t devices/device-01/receivers/rx-1/stream-status -m 1
```

### Example: sender transmission + essence

```bash
mosquitto_pub -t devices/device-01/senders/tx-1/transmission-status -m 1
mosquitto_pub -t devices/device-01/senders/tx-1/essence-status -m 1
```

---

## Compliance testing

Internal tests mirror **BCP0080101Test.py** (receiver) and **BCP0080201Test.py** (sender)
for statically verifiable behaviour. IS-05 activation/deactivation tests require a full
IS-05 stack and are documented as manual/out-of-scope for this bridge.

```bash
npm run validate
```

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| `overallStatus` stays Inactive | Receiver: set both `connectionStatus` and `streamStatus` ≠ 0. Sender: set both `transmissionStatus` and `essenceStatus` ≠ 0. |
| Touchpoint UUID not found on IS-04 | Touchpoints reference resources on an **external** node — query that host, not this bridge. UUIDs are set in `mapping/egress.is12.yaml`. |
| No IS-12 notifications | Subscribe to monitor oids; publish to the correct MQTT topic from the table above. |
| Wrong port in nmos-testing | Use **9005** for both HTTP and WebSocket when IS-04 Node API is enabled. |
