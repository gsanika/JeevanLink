/**
 * ============================================================
 * JEEVANLINK - ADVANCED EMERGENCY NETWORK PROTOTYPE
 * ============================================================
 *
 * Demo topology:
 *
 *       A (Victim)
 *          |
 *          v
 *       B (Relay)
 *          |
 *          v
 *       C (Relay)
 *          |
 *          v
 *       R (Rescue Center)
 *
 * Core concept:
 *
 *  SOS -> Relay -> Relay -> Rescue
 *
 * If a relay is offline:
 *
 *  SOS -> Relay -> [QUEUE]
 *                    |
 *              reconnect
 *                    |
 *                    v
 *                 Relay
 *
 * This is a prototype/simulation of the JeevanLink
 * store-and-forward architecture.
 *
 * ============================================================
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

/* ============================================================
   CONFIGURATION
============================================================ */

const PORT = process.env.PORT || 3000;

const HOP_DELAY_MS = 1400;
const QUEUE_FLUSH_DELAY_MS = 500;

const MAX_TTL = 8;
const SOS_EXPIRY_MS = 30 * 60 * 1000;

const VALID_NODES = ["A", "B", "C", "R"];

const NODE_INFO = {
  A: {
    name: "Victim Device",
    type: "victim",
  },
  B: {
    name: "Relay B",
    type: "relay",
  },
  C: {
    name: "Relay C",
    type: "relay",
  },
  R: {
    name: "Rescue Center",
    type: "rescue",
  },
};

/*
 * Fixed demonstration topology.
 */
const NEXT_HOP = {
  A: "B",
  B: "C",
  C: "R",
};

const PREV_HOP = {
  B: "A",
  C: "B",
  R: "C",
};

/* ============================================================
   RUNTIME STATE
============================================================ */

/*
 * nodeId -> socket
 */
const sockets = {};

/*
 * Online/offline state.
 */
const online = {
  A: false,
  B: false,
  C: false,
  R: false,
};

/*
 * Node health information.
 */
const nodeHealth = {};

for (const nodeId of VALID_NODES) {
  nodeHealth[nodeId] = {
    nodeId,
    name: NODE_INFO[nodeId].name,
    type: NODE_INFO[nodeId].type,

    online: false,

    battery: nodeId === "R" ? 100 : Math.floor(65 + Math.random() * 30),

    packetsReceived: 0,
    packetsForwarded: 0,
    packetsQueued: 0,

    lastSeen: null,

    signal: nodeId === "R" ? 100 : Math.floor(70 + Math.random() * 25),

    status: "offline",
  };
}

/*
 * nodeId -> queued operations
 *
 * Example:
 *
 * queues.C = [
 *   {
 *      type: "SOS",
 *      sosId: "JL-ABC123",
 *      from: "B"
 *   }
 * ]
 */
const queues = {
  A: [],
  B: [],
  C: [],
  R: [],
};

/*
 * All SOS incidents.
 */
const sosStore = new Map();

/*
 * Deduplication store.
 *
 * packetKey -> timestamp
 */
const seenPackets = new Map();

/*
 * Event history.
 */
const eventLog = [];

/*
 * Responder database for demo.
 */
const responders = [
  {
    id: "RESP-01",
    name: "Alpha Rescue Unit",
    type: "Ambulance",
    status: "available",
    location: {
      lat: 18.5204,
      lng: 73.8567,
    },
    eta: 5,
    currentIncident: null,
  },

  {
    id: "RESP-02",
    name: "Bravo Fire Unit",
    type: "Fire & Rescue",
    status: "available",
    location: {
      lat: 18.525,
      lng: 73.84,
    },
    eta: 8,
    currentIncident: null,
  },

  {
    id: "RESP-03",
    name: "Charlie Medical Team",
    type: "Medical",
    status: "available",
    location: {
      lat: 18.51,
      lng: 73.87,
    },
    eta: 10,
    currentIncident: null,
  },

  {
    id: "RESP-04",
    name: "Delta Response Unit",
    type: "Emergency Response",
    status: "available",
    location: {
      lat: 18.53,
      lng: 73.865,
    },
    eta: 12,
    currentIncident: null,
  },
];

/* ============================================================
   UTILITY FUNCTIONS
============================================================ */

function timestamp() {
  return new Date().toISOString();
}

function log(...args) {
  console.log(
    new Date().toISOString().slice(11, 19),
    ...args
  );
}

function addEvent(type, message, data = {}) {
  const event = {
    id: uuidv4(),
    type,
    message,
    timestamp: Date.now(),
    ...data,
  };

  eventLog.unshift(event);

  /*
   * Keep only the latest 500 events.
   */
  if (eventLog.length > 500) {
    eventLog.length = 500;
  }

  io.emit("system:event", event);

  return event;
}

function isValidNode(nodeId) {
  return VALID_NODES.includes(nodeId);
}

function broadcastTopology() {
  io.emit("topology:update", {
    online: { ...online },
    nodes: Object.values(nodeHealth),
  });
}

function broadcastState() {
  io.emit("state:update", getState());
}

function getState() {
  const sos = Array.from(sosStore.values());

  return {
    online: { ...online },

    nodes: Object.values(nodeHealth),

    sos,

    responders,

    queues: Object.fromEntries(
      Object.entries(queues).map(([node, queue]) => [
        node,
        queue.length,
      ])
    ),

    metrics: getMetrics(),
  };
}

/* ============================================================
   METRICS
============================================================ */

function getMetrics() {
  const incidents = Array.from(sosStore.values());

  const total = incidents.length;

  const critical = incidents.filter(
    (s) => s.severity === "critical"
  ).length;

  const high = incidents.filter(
    (s) => s.severity === "high"
  ).length;

  const delivered = incidents.filter(
    (s) => s.status === "delivered"
  ).length;

  const acknowledged = incidents.filter(
    (s) => s.ackStatus === "acknowledged"
  ).length;

  const resolved = incidents.filter(
    (s) => s.status === "resolved"
  ).length;

  const queuedPackets = Object.values(queues).reduce(
    (sum, queue) => sum + queue.length,
    0
  );

  const onlineRelays = ["B", "C"].filter(
    (node) => online[node]
  ).length;

  return {
    totalIncidents: total,

    activeIncidents: incidents.filter(
      (s) =>
        s.status !== "resolved" &&
        s.status !== "expired"
    ).length,

    critical,
    high,

    delivered,
    acknowledged,
    resolved,

    queuedPackets,

    onlineRelays,

    networkAvailability:
      Math.round(
        (Object.values(online).filter(Boolean).length /
          VALID_NODES.length) *
          100
      ),

    totalPacketsForwarded:
      Object.values(nodeHealth).reduce(
        (sum, node) =>
          sum + node.packetsForwarded,
        0
      ),

    totalPacketsReceived:
      Object.values(nodeHealth).reduce(
        (sum, node) =>
          sum + node.packetsReceived,
        0
      ),
  };
}

/* ============================================================
   PACKET DEDUPLICATION
============================================================ */

function packetKey(sosId, nodeId, direction = "SOS") {
  return `${direction}:${sosId}:${nodeId}`;
}

function hasSeenPacket(key) {
  return seenPackets.has(key);
}

function markPacketSeen(key) {
  seenPackets.set(key, Date.now());
}

/*
 * Cleanup old packet IDs.
 */
setInterval(() => {
  const now = Date.now();

  for (const [key, time] of seenPackets.entries()) {
    if (now - time > SOS_EXPIRY_MS) {
      seenPackets.delete(key);
    }
  }
}, 60 * 1000);

/* ============================================================
   NODE MANAGEMENT
============================================================ */

function setNodeOnline(nodeId, value) {
  if (!isValidNode(nodeId)) return;

  online[nodeId] = Boolean(value);

  nodeHealth[nodeId].online = Boolean(value);

  nodeHealth[nodeId].status = value
    ? "online"
    : "offline";

  nodeHealth[nodeId].lastSeen = Date.now();

  if (value) {
    addEvent(
      "NODE_ONLINE",
      `${NODE_INFO[nodeId].name} is online`,
      {
        nodeId,
      }
    );

    flushQueue(nodeId);
  } else {
    addEvent(
      "NODE_OFFLINE",
      `${NODE_INFO[nodeId].name} went offline`,
      {
        nodeId,
      }
    );
  }

  broadcastTopology();
  broadcastState();
}

/* ============================================================
   QUEUE SYSTEM
============================================================ */

/*
 * Add an operation to a node's queue.
 */
function queueOperation(nodeId, operation) {
  if (!queues[nodeId]) {
    queues[nodeId] = [];
  }

  queues[nodeId].push(operation);

  nodeHealth[nodeId].packetsQueued++;

  addEvent(
    "PACKET_QUEUED",
    `Packet queued at ${NODE_INFO[nodeId].name}`,
    {
      nodeId,
      sosId: operation.sosId,
    }
  );

  broadcastState();
}

/*
 * Flush everything waiting for a node.
 */
function flushQueue(nodeId) {
  if (!online[nodeId]) {
    return;
  }

  const pending = queues[nodeId];

  if (!pending.length) {
    return;
  }

  queues[nodeId] = [];

  log(
    `Flushing ${pending.length} packet(s) to ${nodeId}`
  );

  pending.forEach((operation, index) => {
    setTimeout(() => {
      processQueuedOperation(
        nodeId,
        operation
      );
    }, index * QUEUE_FLUSH_DELAY_MS);
  });

  broadcastState();
}

function processQueuedOperation(
  nodeId,
  operation
) {
  if (!online[nodeId]) {
    /*
     * Node went offline again.
     */
    queueOperation(nodeId, operation);
    return;
  }

  if (operation.type === "SOS") {
    deliverSOSHop(
      operation.sosId,
      operation.from,
      nodeId
    );
  }

  if (operation.type === "ACK") {
    deliverAckHop(
      operation.sosId,
      operation.from,
      nodeId
    );
  }
}

/* ============================================================
   SOS CREATION
============================================================ */

function createSOS(payload) {
  const severity =
    payload.severity || "medium";

  const sos = {
    id:
      "JL-" +
      uuidv4()
        .slice(0, 8)
        .toUpperCase(),

    createdAt: Date.now(),

    updatedAt: Date.now(),

    type:
      payload.type ||
      "general",

    message:
      payload.message ||
      "Emergency assistance required",

    people:
      Number(payload.people) || 1,

    injured:
      Number(payload.injured) || 0,

    severity,

    location:
      payload.location || null,

    photo:
      payload.photo || null,

    voice:
      Boolean(payload.voice),

    status: "created",

    ackStatus: "pending",

    dispatchStatus: "unassigned",

    responderId: null,

    responderStatus: null,

    /*
     * Path is only updated when a hop is
     * ACTUALLY delivered.
     */
    path: ["A"],

    ttl: MAX_TTL,

    events: [],

    expired: false,
  };

  addSOSHistory(
    sos,
    "SOS_CREATED",
    "Emergency request created"
  );

  sosStore.set(sos.id, sos);

  return sos;
}

/* ============================================================
   SOS HISTORY
============================================================ */

function addSOSHistory(
  sos,
  type,
  message,
  extra = {}
) {
  const event = {
    id: uuidv4(),

    type,

    message,

    timestamp: Date.now(),

    ...extra,
  };

  sos.events.push(event);

  sos.updatedAt = Date.now();

  io.emit("sos:event", {
    sosId: sos.id,
    event,
  });
}

/* ============================================================
   SOS FORWARDING
============================================================ */

/*
 * Start forwarding from the latest node.
 *
 * IMPORTANT:
 *
 * We DO NOT modify sos.path until the destination
 * actually receives the packet.
 */
function forwardSOS(sosId, fromNode) {
  const sos = sosStore.get(sosId);

  if (!sos) return;

  if (sos.expired) return;

  if (sos.ttl <= 0) {
    sos.status = "expired";

    addSOSHistory(
      sos,
      "TTL_EXPIRED",
      "Emergency packet exceeded maximum hop limit"
    );

    broadcastState();

    return;
  }

  const toNode = NEXT_HOP[fromNode];

  if (!toNode) {
    /*
     * Rescue center reached.
     */
    deliverAtRescue(sos);

    return;
  }

  const key = packetKey(
    sos.id,
    toNode,
    "SOS"
  );

  /*
   * Deduplication.
   */
  if (hasSeenPacket(key)) {
    addSOSHistory(
      sos,
      "DEDUPLICATED",
      `Duplicate packet ignored at ${toNode}`,
      {
        nodeId: toNode,
      }
    );

    return;
  }

  /*
   * Decrease TTL for next hop.
   */
  sos.ttl--;

  if (!online[toNode] || !sockets[toNode]) {
    /*
     * CRITICAL:
     *
     * Do NOT change path.
     * Do NOT continue forwarding.
     *
     * Store packet here.
     */
    queueOperation(toNode, {
      type: "SOS",
      sosId: sos.id,
      from: fromNode,
      createdAt: Date.now(),
    });

    sos.status = "queued";

    addSOSHistory(
      sos,
      "STORED",
      `Next relay ${toNode} unavailable. Packet stored.`,
      {
        from: fromNode,
        to: toNode,
      }
    );

    io.emit("sos:queued", {
      sos,
      nodeId: toNode,
    });

    broadcastState();

    return;
  }

  /*
   * Node is online.
   *
   * Simulate radio hop delay.
   */
  setTimeout(() => {
    deliverSOSHop(
      sos.id,
      fromNode,
      toNode
    );
  }, HOP_DELAY_MS);
}

/*
 * Actually deliver an SOS to the next node.
 */
function deliverSOSHop(
  sosId,
  fromNode,
  toNode
) {
  const sos = sosStore.get(sosId);

  if (!sos) return;

  if (sos.expired) return;

  /*
   * If node disappeared while packet was waiting,
   * queue it again.
   */
  if (!online[toNode] || !sockets[toNode]) {
    queueOperation(toNode, {
      type: "SOS",
      sosId,
      from: fromNode,
      createdAt: Date.now(),
    });

    return;
  }

  const key = packetKey(
    sos.id,
    toNode,
    "SOS"
  );

  if (hasSeenPacket(key)) {
    return;
  }

  markPacketSeen(key);

  /*
   * THIS is where path is updated.
   */
  if (
    sos.path[sos.path.length - 1] !==
    toNode
  ) {
    sos.path.push(toNode);
  }

  sos.status =
    toNode === "R"
      ? "delivered"
      : "in-transit";

  nodeHealth[toNode].packetsReceived++;
  nodeHealth[fromNode].packetsForwarded++;

  addSOSHistory(
    sos,
    "HOP_DELIVERED",
    `${fromNode} → ${toNode}`,
    {
      from: fromNode,
      to: toNode,
    }
  );

  /*
   * Tell frontend node that it received packet.
   */
  sockets[toNode].emit(
    "sos:incoming",
    sos
  );

  io.emit("sos:path", {
    sosId: sos.id,
    from: fromNode,
    to: toNode,
    path: sos.path,
  });

  addEvent(
    "SOS_HOP",
    `SOS ${sos.id}: ${fromNode} → ${toNode}`,
    {
      sosId: sos.id,
      from: fromNode,
      to: toNode,
    }
  );

  /*
   * Rescue reached.
   */
  if (toNode === "R") {
    deliverAtRescue(sos);

    return;
  }

  /*
   * Continue ONLY after successful delivery.
   */
  forwardSOS(
    sos.id,
    toNode
  );

  broadcastState();
}

/* ============================================================
   RESCUE DELIVERY
============================================================ */

function deliverAtRescue(sos) {
  sos.status = "delivered";

  sos.ackStatus = "pending";

  addSOSHistory(
    sos,
    "RESCUE_RECEIVED",
    "Emergency received by rescue center"
  );

  io.to("dashboards").emit(
    "sos:new",
    sos
  );

  io.emit("sos:delivered", sos);

  addEvent(
    "SOS_DELIVERED",
    `SOS ${sos.id} reached rescue center`,
    {
      sosId: sos.id,
      severity: sos.severity,
    }
  );

  broadcastState();
}

/* ============================================================
   ACKNOWLEDGEMENT SYSTEM
============================================================ */

function sendAck(sosId) {
  const sos = sosStore.get(sosId);

  if (!sos) {
    return;
  }

  sos.ackStatus = "acknowledged";

  addSOSHistory(
    sos,
    "RESCUE_ACK",
    "Rescue center acknowledged the emergency"
  );

  addEvent(
    "ACK_CREATED",
    `Rescue acknowledged ${sos.id}`,
    {
      sosId,
    }
  );

  /*
   * Start reverse route.
   */
  forwardAck(
    sos.id,
    "R"
  );

  broadcastState();
}

function forwardAck(
  sosId,
  fromNode
) {
  const sos = sosStore.get(sosId);

  if (!sos) return;

  const toNode = PREV_HOP[fromNode];

  if (!toNode) {
    return;
  }

  const key = packetKey(
    sos.id,
    toNode,
    "ACK"
  );

  if (hasSeenPacket(key)) {
    return;
  }

  if (!online[toNode] || !sockets[toNode]) {
    queueOperation(toNode, {
      type: "ACK",
      sosId,
      from: fromNode,
      createdAt: Date.now(),
    });

    addSOSHistory(
      sos,
      "ACK_STORED",
      `Acknowledgement waiting at ${fromNode}; next node ${toNode} unavailable`,
      {
        from: fromNode,
        to: toNode,
      }
    );

    broadcastState();

    return;
  }

  setTimeout(() => {
    deliverAckHop(
      sosId,
      fromNode,
      toNode
    );
  }, HOP_DELAY_MS);
}

function deliverAckHop(
  sosId,
  fromNode,
  toNode
) {
  const sos = sosStore.get(sosId);

  if (!sos) return;

  if (!online[toNode] || !sockets[toNode]) {
    queueOperation(toNode, {
      type: "ACK",
      sosId,
      from: fromNode,
      createdAt: Date.now(),
    });

    return;
  }

  const key = packetKey(
    sos.id,
    toNode,
    "ACK"
  );

  if (hasSeenPacket(key)) {
    return;
  }

  markPacketSeen(key);

  sockets[toNode].emit(
    "ack:relay",
    {
      sosId,
      node: fromNode,
      from: fromNode,
      to: toNode,
    }
  );

  addSOSHistory(
    sos,
    "ACK_HOP",
    `${fromNode} → ${toNode}`,
    {
      from: fromNode,
      to: toNode,
    }
  );

  addEvent(
    "ACK_HOP",
    `ACK ${sos.id}: ${fromNode} → ${toNode}`,
    {
      sosId: sos.id,
      from: fromNode,
      to: toNode,
    }
  );

  /*
   * Victim reached.
   */
  if (toNode === "A") {
    sos.ackStatus = "delivered";

    addSOSHistory(
      sos,
      "ACK_DELIVERED",
      "Victim received rescue acknowledgement"
    );

    sockets.A.emit(
      "ack:delivered",
      {
        sosId,
        message:
          "Rescue center received your emergency and is responding.",
      }
    );

    io.emit(
      "sos:ack-delivered",
      {
        sosId,
      }
    );

    broadcastState();

    return;
  }

  /*
   * Continue backwards.
   */
  forwardAck(
    sosId,
    toNode
  );

  broadcastState();
}

/* ============================================================
   INCIDENT LIFECYCLE
============================================================ */

function updateIncidentStatus(
  sosId,
  status
) {
  const sos = sosStore.get(sosId);

  if (!sos) {
    return null;
  }

  const allowed = [
    "created",
    "queued",
    "in-transit",
    "delivered",
    "acknowledged",
    "dispatched",
    "en-route",
    "arrived",
    "rescue-in-progress",
    "resolved",
    "expired",
  ];

  if (!allowed.includes(status)) {
    return null;
  }

  sos.status = status;

  addSOSHistory(
    sos,
    "STATUS_CHANGED",
    `Incident status changed to ${status}`,
    {
      status,
    }
  );

  io.emit(
    "sos:status",
    {
      sosId,
      status,
      sos,
    }
  );

  broadcastState();

  return sos;
}

/* ============================================================
   RESPONDER SYSTEM
============================================================ */

function dispatchResponder(
  sosId,
  responderId
) {
  const sos = sosStore.get(sosId);

  const responder = responders.find(
    (r) => r.id === responderId
  );

  if (!sos || !responder) {
    return null;
  }

  if (
    responder.status !== "available"
  ) {
    return null;
  }

  responder.status = "assigned";
  responder.currentIncident = sosId;

  sos.responderId = responderId;

  sos.responderStatus = "assigned";

  sos.dispatchStatus = "assigned";

  addSOSHistory(
    sos,
    "RESPONDER_ASSIGNED",
    `${responder.name} assigned`,
    {
      responderId,
    }
  );

  updateIncidentStatus(
    sosId,
    "dispatched"
  );

  io.emit(
    "responder:assigned",
    {
      sos,
      responder,
    }
  );

  addEvent(
    "RESPONDER_ASSIGNED",
    `${responder.name} assigned to ${sos.id}`,
    {
      sosId,
      responderId,
    }
  );

  broadcastState();

  return {
    sos,
    responder,
  };
}

/* ============================================================
   DEMO RESPONDER PROGRESSION
============================================================ */

function progressResponder(
  sosId,
  status
) {
  const sos = sosStore.get(sosId);

  if (!sos || !sos.responderId) {
    return null;
  }

  const responder =
    responders.find(
      (r) =>
        r.id === sos.responderId
    );

  if (!responder) {
    return null;
  }

  const validStatuses = [
    "en-route",
    "arrived",
    "rescue-in-progress",
    "resolved",
  ];

  if (!validStatuses.includes(status)) {
    return null;
  }

  responder.status =
    status === "resolved"
      ? "available"
      : status;

  if (status === "resolved") {
    responder.currentIncident = null;
  }

  sos.responderStatus = status;

  updateIncidentStatus(
    sosId,
    status
  );

  addSOSHistory(
    sos,
    "RESPONDER_STATUS",
    `${responder.name}: ${status}`,
    {
      responderId: responder.id,
      status,
    }
  );

  io.emit(
    "responder:update",
    {
      sos,
      responder,
    }
  );

  broadcastState();

  return {
    sos,
    responder,
  };
}

/* ============================================================
   SOCKET.IO
============================================================ */

io.on("connection", (socket) => {
  let registeredNode = null;

  log(
    `socket connected: ${socket.id}`
  );

  /*
   * Register a node.
   */
  socket.on(
    "register",
    ({ nodeId }) => {
      if (!isValidNode(nodeId)) {
        socket.emit(
          "error:message",
          {
            message:
              "Invalid node ID",
          }
        );

        return;
      }

      registeredNode = nodeId;

      sockets[nodeId] = socket;

      setNodeOnline(
        nodeId,
        true
      );

      socket.emit(
        "node:registered",
        {
          nodeId,
          info: NODE_INFO[nodeId],
        }
      );

      /*
       * Rescue center receives all historical incidents.
       */
      if (nodeId === "R") {
        socket.join(
          "dashboards"
        );

        socket.emit(
          "sos:bootstrap",
          Array.from(
            sosStore.values()
          )
        );
      }

      /*
       * Send complete state.
       */
      socket.emit(
        "state:bootstrap",
        getState()
      );
    }
  );

  /*
   * Victim creates SOS.
   */
  socket.on(
    "sos:create",
    (payload = {}) => {
      /*
       * Only registered victim A should create
       * SOS in this topology.
       */
      if (
        registeredNode &&
        registeredNode !== "A"
      ) {
        socket.emit(
          "error:message",
          {
            message:
              "Only victim node A can create SOS.",
          }
        );

        return;
      }

      const sos =
        createSOS(payload);

      log(
        `SOS ${sos.id} created`,
        `severity=${sos.severity}`,
        `people=${sos.people}`,
        `injured=${sos.injured}`
      );

      socket.emit(
        "sos:created",
        sos
      );

      io.emit(
        "sos:created-global",
        sos
      );

      addEvent(
        "SOS_CREATED",
        `New ${sos.severity} emergency ${sos.id}`,
        {
          sosId: sos.id,
          severity: sos.severity,
        }
      );

      /*
       * Start route.
       */
      forwardSOS(
        sos.id,
        "A"
      );

      broadcastState();
    }
  );

  /*
   * Rescue center acknowledges.
   */
  socket.on(
    "ack:send",
    ({ sosId }) => {
      sendAck(sosId);
    }
  );

  /*
   * Manually change node connectivity.
   */
  socket.on(
    "node:set-online",
    ({ nodeId, value }) => {
      if (!isValidNode(nodeId)) {
        return;
      }

      online[nodeId] =
        Boolean(value);

      nodeHealth[nodeId].online =
        Boolean(value);

      nodeHealth[nodeId].status =
        value
          ? "online"
          : "offline";

      nodeHealth[nodeId].lastSeen =
        Date.now();

      if (value) {
        addEvent(
          "NODE_RECONNECTED",
          `${NODE_INFO[nodeId].name} reconnected`,
          {
            nodeId,
          }
        );

        flushQueue(nodeId);
      } else {
        addEvent(
          "NODE_OUT_OF_RANGE",
          `${NODE_INFO[nodeId].name} is now out of range`,
          {
            nodeId,
          }
        );
      }

      broadcastTopology();
      broadcastState();
    }
  );

  /*
   * Simulate battery update.
   */
  socket.on(
    "node:battery",
    ({ nodeId, battery }) => {
      if (!isValidNode(nodeId)) {
        return;
      }

      const value = Math.max(
        0,
        Math.min(
          100,
          Number(battery)
        )
      );

      nodeHealth[nodeId].battery =
        value;

      if (value < 15) {
        nodeHealth[nodeId].status =
          "low-battery";
      }

      io.emit(
        "node:health",
        nodeHealth[nodeId]
      );

      broadcastState();
    }
  );

  /*
   * Heartbeat.
   */
  socket.on(
    "heartbeat",
    () => {
      if (!registeredNode) {
        return;
      }

      nodeHealth[
        registeredNode
      ].lastSeen = Date.now();

      socket.emit(
        "heartbeat:ack",
        {
          timestamp: Date.now(),
        }
      );
    }
  );

  /*
   * Disconnect.
   */
  socket.on(
    "disconnect",
    () => {
      if (
        registeredNode &&
        sockets[
          registeredNode
        ] === socket
      ) {
        delete sockets[
          registeredNode
        ];

        setNodeOnline(
          registeredNode,
          false
        );
      }

      log(
        `socket disconnected: ${socket.id}`
      );
    }
  );
});

/* ============================================================
   REST API
============================================================ */

/*
 * Health check.
 */
app.get(
  "/api/health",
  (_req, res) => {
    res.json({
      ok: true,

      service:
        "JeevanLink Emergency Network",

      timestamp:
        timestamp(),

      uptime:
        process.uptime(),

      version:
        "2.0.0",
    });
  }
);

/*
 * Complete system state.
 */
app.get(
  "/api/state",
  (_req, res) => {
    res.json(
      getState()
    );
  }
);

/*
 * Metrics.
 */
app.get(
  "/api/metrics",
  (_req, res) => {
    res.json(
      getMetrics()
    );
  }
);

/*
 * Nodes.
 */
app.get(
  "/api/nodes",
  (_req, res) => {
    res.json(
      Object.values(
        nodeHealth
      )
    );
  }
);

/*
 * Incidents.
 */
app.get(
  "/api/incidents",
  (_req, res) => {
    res.json(
      Array.from(
        sosStore.values()
      )
    );
  }
);

/*
 * Single incident.
 */
app.get(
  "/api/incidents/:id",
  (req, res) => {
    const sos =
      sosStore.get(
        req.params.id
      );

    if (!sos) {
      return res
        .status(404)
        .json({
          error:
            "Incident not found",
        });
    }

    res.json(sos);
  }
);

/*
 * Event log.
 */
app.get(
  "/api/events",
  (_req, res) => {
    res.json(
      eventLog
    );
  }
);

/*
 * Responders.
 */
app.get(
  "/api/responders",
  (_req, res) => {
    res.json(
      responders
    );
  }
);

/*
 * Assign responder.
 */
app.post(
  "/api/incidents/:id/dispatch",
  (req, res) => {
    const result =
      dispatchResponder(
        req.params.id,
        req.body.responderId
      );

    if (!result) {
      return res
        .status(400)
        .json({
          error:
            "Unable to dispatch responder",
        });
    }

    res.json(result);
  }
);

/*
 * Update responder status.
 */
app.post(
  "/api/incidents/:id/responder-status",
  (req, res) => {
    const result =
      progressResponder(
        req.params.id,
        req.body.status
      );

    if (!result) {
      return res
        .status(400)
        .json({
          error:
            "Unable to update responder status",
        });
    }

    res.json(result);
  }
);

/*
 * Acknowledge SOS through REST.
 */
app.post(
  "/api/incidents/:id/ack",
  (req, res) => {
    const sos =
      sosStore.get(
        req.params.id
      );

    if (!sos) {
      return res
        .status(404)
        .json({
          error:
            "Incident not found",
        });
    }

    sendAck(
      req.params.id
    );

    res.json(
      sos
    );
  }
);

/*
 * Manual incident status.
 */
app.post(
  "/api/incidents/:id/status",
  (req, res) => {
    const sos =
      updateIncidentStatus(
        req.params.id,
        req.body.status
      );

    if (!sos) {
      return res
        .status(400)
        .json({
          error:
            "Invalid incident/status",
        });
    }

    res.json(sos);
  }
);

/* ============================================================
   DEMO CONTROLS
============================================================ */

/*
 * Reset entire demo.
 *
 * Useful during hackathon presentation.
 */
app.post(
  "/api/demo/reset",
  (_req, res) => {
    sosStore.clear();

    seenPackets.clear();

    eventLog.length = 0;

    for (const node of VALID_NODES) {
      queues[node] = [];

      online[node] = false;

      nodeHealth[node].online =
        false;

      nodeHealth[node].status =
        "offline";

      nodeHealth[node].packetsReceived =
        0;

      nodeHealth[node].packetsForwarded =
        0;

      nodeHealth[node].packetsQueued =
        0;
    }

    for (const responder of responders) {
      responder.status =
        "available";

      responder.currentIncident =
        null;
    }

    io.emit(
      "demo:reset"
    );

    broadcastTopology();
    broadcastState();

    res.json({
      success: true,
      message:
        "JeevanLink demo reset successfully",
    });
  }
);

/*
 * Demo topology endpoint.
 */
app.get(
  "/api/topology",
  (_req, res) => {
    res.json({
      nodes: VALID_NODES,

      links: [
        {
          from: "A",
          to: "B",
        },
        {
          from: "B",
          to: "C",
        },
        {
          from: "C",
          to: "R",
        },
      ],

      online,
    });
  }
);

/* ============================================================
   AUTOMATIC INCIDENT EXPIRATION
============================================================ */

setInterval(() => {
  const now = Date.now();

  for (const sos of sosStore.values()) {
    if (
      sos.status !== "resolved" &&
      sos.status !== "expired" &&
      now - sos.createdAt >
        SOS_EXPIRY_MS
    ) {
      sos.expired = true;

      updateIncidentStatus(
        sos.id,
        "expired"
      );

      addSOSHistory(
        sos,
        "EXPIRED",
        "Emergency request expired"
      );
    }
  }
}, 60 * 1000);

/* ============================================================
   START SERVER
============================================================ */

server.listen(
  PORT,
  () => {
    log(
      `JeevanLink server running at http://localhost:${PORT}`
    );

    log(
      `Victim:   http://localhost:${PORT}/victim.html`
    );

    log(
      `Relay B:  http://localhost:${PORT}/relay.html?node=B`
    );

    log(
      `Relay C:  http://localhost:${PORT}/relay.html?node=C`
    );

    log(
      `Rescue:   http://localhost:${PORT}/dashboard.html`
    );

    log(
      `Topology: A → B → C → R`
    );
  }
);