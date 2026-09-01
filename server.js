// JeevanLink prototype server
// Simulates a 4-node mesh chain:  Victim(A) -> Relay(B) -> Relay(C) -> Rescue(R)
// Each hop is store-and-forward: if the next node is offline, the packet
// waits in that node's queue and is delivered the moment it reconnects.
// This mirrors sections 4-8 of the JeevanLink spec (mesh relay, discovery,
// store-and-forward, dedup, delayed reconnection, ack path).

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

const HOP_DELAY_MS = 1400; // simulated relay processing + radio hop time

// Fixed demo topology (linear chain, matches the spec's 5-person example)
const NEXT_HOP = { A: "B", B: "C", C: "R" };
const PREV_HOP = { B: "A", C: "B", R: "C" };

// live socket per node id
const sockets = {}; // nodeId -> socket
// online/offline flag per node id (offline = "out of radio range")
const online = { A: false, B: false, C: false, R: false };
// packets waiting for a node that is currently offline: nodeId -> [ {event, data} ]
const queues = { A: [], B: [], C: [], R: [] };
// full record of every SOS ever created, keyed by id
const sosStore = new Map();

function log(...args) {
  console.log(new Date().toISOString().slice(11, 19), ...args);
}

function sendOrQueue(nodeId, event, data) {
  if (online[nodeId] && sockets[nodeId]) {
    sockets[nodeId].emit(event, data);
  } else {
    queues[nodeId].push({ event, data });
    log(`queued ${event} for ${nodeId} (offline) — will deliver on reconnect`);
  }
}

function flushQueue(nodeId) {
  const pending = queues[nodeId];
  if (!pending.length) return;
  log(`flushing ${pending.length} queued packet(s) to ${nodeId}`);
  queues[nodeId] = [];
  pending.forEach(({ event, data }, i) => {
    setTimeout(() => sockets[nodeId] && sockets[nodeId].emit(event, data), i * 400);
  });
}

function broadcastTopology() {
  io.emit("topology:update", { online });
}

function forwardSOS(sos) {
  const from = sos.path[sos.path.length - 1];
  const to = NEXT_HOP[from];
  if (!to) return; // reached rescue, nothing further to do

  setTimeout(() => {
    sos.path.push(to);
    sos.status = to === "R" ? "delivered" : "in-transit";
    sendOrQueue(to, "sos:incoming", sos);
    log(`SOS ${sos.id} hop ${from} -> ${to} (${sos.severity})`);
    if (to !== "R") {
      forwardSOS(sos); // keep relaying down the chain
    } else {
      io.to("dashboards").emit("sos:new", sos);
    }
  }, HOP_DELAY_MS);
}

function forwardAck(sosId, from) {
  const to = PREV_HOP[from];
  if (!to) return;
  setTimeout(() => {
    sendOrQueue(to, "ack:relay", { sosId, node: from });
    log(`ACK ${sosId} hop ${from} -> ${to}`);
    if (to !== "A") {
      forwardAck(sosId, to);
    } else {
      sendOrQueue("A", "ack:delivered", { sosId });
    }
  }, HOP_DELAY_MS);
}

io.on("connection", (socket) => {
  let registeredNode = null;

  socket.on("register", ({ nodeId }) => {
    if (!["A", "B", "C", "R"].includes(nodeId)) return;
    registeredNode = nodeId;
    sockets[nodeId] = socket;
    online[nodeId] = true;
    if (nodeId === "R") socket.join("dashboards");
    log(`node ${nodeId} online`);
    broadcastTopology();
    flushQueue(nodeId);
    if (nodeId === "R") {
      socket.emit("sos:bootstrap", Array.from(sosStore.values()));
    }
  });

  socket.on("sos:create", (payload) => {
    const sos = {
      id: "JL-" + uuidv4().slice(0, 8).toUpperCase(),
      createdAt: Date.now(),
      path: ["A"],
      status: "in-transit",
      ackStatus: "pending",
      ...payload,
    };
    sosStore.set(sos.id, sos);
    log(`SOS ${sos.id} created (${sos.severity}, ${sos.people} people, ${sos.injured} injured)`);
    socket.emit("sos:created", sos);
    forwardSOS(sos);
  });

  socket.on("ack:send", ({ sosId }) => {
    const sos = sosStore.get(sosId);
    if (!sos) return;
    sos.ackStatus = "acknowledged";
    log(`Rescue acknowledged ${sosId}`);
    forwardAck(sosId, "R");
  });

  socket.on("node:set-online", ({ nodeId, value }) => {
    // manual "walked out of range / back in range" toggle for the demo
    if (!["A", "B", "C", "R"].includes(nodeId)) return;
    online[nodeId] = value;
    if (value && sockets[nodeId]) flushQueue(nodeId);
    broadcastTopology();
  });

  socket.on("disconnect", () => {
    if (registeredNode) {
      online[registeredNode] = false;
      delete sockets[registeredNode];
      log(`node ${registeredNode} offline (disconnected)`);
      broadcastTopology();
    }
  });
});

app.get("/api/state", (_req, res) => {
  res.json({ online, sos: Array.from(sosStore.values()) });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  log(`JeevanLink prototype server running on http://localhost:${PORT}`);
  log(`Victim:  http://localhost:${PORT}/victim.html`);
  log(`Relay B: http://localhost:${PORT}/relay.html?node=B`);
  log(`Relay C: http://localhost:${PORT}/relay.html?node=C`);
  log(`Rescue:  http://localhost:${PORT}/dashboard.html`);
});
