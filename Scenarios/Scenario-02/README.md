# Scenario-02 — MQTT Numeric → NcReceiverMonitor `linkStatus`

A richer worked example extending Scenario-01 to a **nested device model** with IS-04 Node API
and registry discovery. An MQTT topic carrying a **numeric** value (`1`, `2`, or `3`) is mapped
onto the `linkStatus` property (`NcLinkStatus`, `{level:4, index:1}`) of an **NcReceiverMonitor**
instance (`classId [1,2,2,1]`) that lives inside an intermediate `NcBlock` named
`receiver-monitors`, which is itself a member of the root block.

---

## Device model topology

```
root  (NcBlock [1,1], oid 1)
├── DeviceManager  (NcDeviceManager [1,3,1], oid 2)
├── ClassManager   (NcClassManager  [1,3,2], oid 3)
└── receiver-monitors  (NcBlock [1,1], oid 4)
      └── rx-monitor-01  (NcReceiverMonitor [1,2,2,1], oid 5)
               linkStatus  → NcLinkStatus {level:4, index:1}  (read-only)
```

`NcLinkStatus` enum values:

| Value | Meaning |
|-------|---------|
| `1`   | AllUp — all network interfaces are up |
| `2`   | SomeDown — some interfaces are down |
| `3`   | AllDown — all interfaces are down |

The flow is **ingress-driven**: MQTT publishes a numeric value → UCE updates `linkStatus` →
IS-12 sends a `PropertyChanged` notification to all subscribed controllers. There is no
write-back (the property is read-only to IS-12 controllers).

The monitor's **touchpoint** (`1p7`) references an IS-04 receiver UUID configured in
`mapping/egress.is12.json`. That receiver resource is hosted on an **external** IS-04 node —
this bridge does not advertise it on its own Node API.

---

## Prerequisites

- **Node.js 20+ LTS** (`nvm use` if you use nvm)
- A local **MQTT broker** (e.g. [Mosquitto](https://mosquitto.org/))
- (Optional) A local **NMOS registry** for IS-04 registration, e.g.
  [easy-nmos](https://github.com/rhastie/easy-nmos) via Docker:
  ```bash
  docker run -d --rm -p 8080:8080 rhastie/nmos-cpp-registry
  ```
- An IS-12 controller or `ws` CLI client to inspect the WebSocket endpoint

---

## Artefact layout

```
Scenarios/Scenario-02/
  bridge.yaml                   # master config
  model/
    entities.yaml               # RootBlock, ReceiverMonitorsBlock, ReceiverMonitor
    datatypes.yaml              # empty — no struct type_defs needed
    tree.yaml                   # root → receiver-monitors → rx-monitor-01 (linkStatus=1)
  mapping/
    ingress.mqtt.json           # MQTT topic → linkStatus, clamp 1..3
    egress.is12.json            # classId overrides + linkStatus → {level:4,index:1}
  README.md                     # this file
```

---

## Running the scenario

### 1. Start an MQTT broker

```bash
mosquitto -v
```

### 2. Build the bridge

```bash
npm run build
```

### 3. Run the bridge against this config

```bash
MQTT_BROKER_URL=mqtt://localhost:1883 \
  node dist/app.js Scenarios/Scenario-02/bridge.yaml
```

Expected startup output:

```
{"level":"info","msg":"Protocol Bridge 'scenario-02' starting…"}
{"level":"info","msg":"Model loaded","entities":3,"datatypes":0}
{"level":"info","msg":"Adapter 'mqtt-ingress' (mqtt) started"}
{"level":"info","msg":"Adapter 'is12-egress' (nmos-is12) started"}
{"level":"info","msg":"All adapters started — bridge is running"}
```

### 4. Connect an IS-12 controller

Open a WebSocket to `ws://localhost:9004/x-nmos/ncp/v1.0`.

> **Port note**: when IS-04 Node API is enabled the IS-12 WebSocket shares the IS-04
> HTTP port (9004). Both endpoints live on the same port — HTTP for IS-04 REST,
> WebSocket upgrade for IS-12 NCP.

Subscribe to all oids by sending:

```json
{ "messageType": 3, "subscriptions": [1, 2, 3, 4, 5] }
```

Expected subscription response:

```json
{ "messageType": 4, "subscriptions": [1, 2, 3, 4, 5] }
```

### 5. Traverse the device model

**GetMemberDescriptors on root block (oid 1):**

```json
{
  "messageType": 0,
  "commands": [{
    "handle": 1, "oid": 1,
    "methodId": { "level": 2, "index": 1 },
    "arguments": { "recurse": false }
  }]
}
```

Expected response includes `receiver-monitors` block with `classId [1,1]`, `owner 1`:

```json
{
  "messageType": 1,
  "responses": [{
    "handle": 1,
    "result": {
      "status": 200,
      "value": [
        { "oid": 2, "classId": [1,3,1], "role": "DeviceManager", "owner": 1 },
        { "oid": 3, "classId": [1,3,2], "role": "ClassManager",  "owner": 1 },
        { "oid": 4, "classId": [1,1],   "role": "receiver-monitors", "owner": 1 }
      ]
    }
  }]
}
```

**GetMemberDescriptors on receiver-monitors block (oid 4):**

```json
{
  "messageType": 0,
  "commands": [{
    "handle": 2, "oid": 4,
    "methodId": { "level": 2, "index": 1 },
    "arguments": { "recurse": false }
  }]
}
```

Expected response — `rx-monitor-01` with `classId [1,2,2,1]`, `owner 4`:

```json
{
  "messageType": 1,
  "responses": [{
    "handle": 2,
    "result": {
      "status": 200,
      "value": [
        { "oid": 5, "classId": [1,2,2,1], "role": "rx-monitor-01", "owner": 4 }
      ]
    }
  }]
}
```

### 6. Get the initial `linkStatus` value

```json
{
  "messageType": 0,
  "commands": [{
    "handle": 3, "oid": 5,
    "methodId": { "level": 1, "index": 1 },
    "arguments": { "id": { "level": 4, "index": 1 } }
  }]
}
```

Expected response — initial value `1` (AllUp):

```json
{
  "messageType": 1,
  "responses": [{ "handle": 3, "result": { "status": 200, "value": 1 } }]
}
```

### 7. Publish a numeric value via MQTT

```bash
# Set linkStatus to 2 (SomeDown)
mosquitto_pub -t devices/device-01/receivers/rx-1/link-status -m 2
```

The bridge processes the message, clamps to 1..3, and updates `root/receiver-monitors/rx-monitor-01.linkStatus`.

Your IS-12 client receives a **Notification** (messageType 2):

```json
{
  "messageType": 2,
  "notifications": [{
    "oid": 5,
    "eventId": { "level": 1, "index": 1 },
    "eventData": {
      "propertyId": { "level": 4, "index": 1 },
      "changeType": 0,
      "value": 2,
      "sequenceItemIndex": null
    }
  }]
}
```

### 8. Verify `linkStatus` has updated

```json
{
  "messageType": 0,
  "commands": [{
    "handle": 4, "oid": 5,
    "methodId": { "level": 1, "index": 1 },
    "arguments": { "id": { "level": 4, "index": 1 } }
  }]
}
```

Expected: `{ "status": 200, "value": 2 }`.

---

## Touchpoints (external IS-04 resources)

The receiver monitor touchpoint is configured in `mapping/egress.is12.json` and returned on
IS-12 `touchpoints` (`1p7`). The UUID refers to a receiver on **another** IS-04 node — it is
**not** served by this bridge's Node API.

| Monitor | Resource type | UUID (external) |
|---------|---------------|-----------------|
| `rx-monitor-01` | receiver | `6b73a87b-1234-0000-0000-000000000001` |

**Get touchpoints over IS-12** (oid 5 = `rx-monitor-01`):

```json
{
  "messageType": 0,
  "commands": [{
    "handle": 5, "oid": 5,
    "methodId": { "level": 1, "index": 1 },
    "arguments": { "id": { "level": 1, "index": 7 } }
  }]
}
```

Resolve the receiver body on the external IS-04 node:

```bash
curl -s http://<external-is04-host>/x-nmos/node/v1.3/receivers/6b73a87b-1234-0000-0000-000000000001
```

This bridge's Node API advertises only **node**, **device**, and **controls** (empty
`senders/` and `receivers/` collections).

---

## IS-04 registration (optional)

When a local NMOS registry is running on `localhost:8080`, the bridge automatically
registers the node and device and advertises the NCP control endpoint.

**GET the Node API self resource:**

```bash
curl http://localhost:9004/x-nmos/node/v1.3/self
```

**GET the device resource (includes NCP control):**

```bash
curl http://localhost:9004/x-nmos/node/v1.3/devices
```

The device's `controls` array contains:

```json
[{
  "type": "urn:x-nmos:control:ncp/v1.0",
  "href": "ws://localhost:9004/x-nmos/ncp/v1.0",
  "authorization": false
}]
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `No config path provided` | Missing CLI arg | Pass `Scenarios/Scenario-02/bridge.yaml` as the first arg |
| `MQTT connection refused` | Broker not running | Start Mosquitto with `mosquitto -v` |
| No IS-12 notification received | Not subscribed to oid 5 | Send a `Subscription` message including oid 5 |
| `linkStatus` not updating | Out-of-range published value | Publish `1`, `2`, or `3` (clamp handles edge values too) |
| IS-04 registration fails | Registry not reachable | Set `registration.enabled: false` in `bridge.yaml` or start the registry |
| Touchpoint UUID not found on IS-04 | Queried this bridge's Node API | Touchpoints reference an **external** node — query that host; UUID is in `mapping/egress.is12.json` |
| `WS connection refused` | Bridge not running or wrong port | Connect to **port 9004** (IS-04/IS-12 shared port) at `/x-nmos/ncp/v1.0` |
