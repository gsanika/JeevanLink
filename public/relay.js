const socket = io();

const NODE = new URLSearchParams(location.search).get("node") === "C" ? "C" : "B";
const NEXT_HOP = { A: "B", B: "C", C: "R" };
const PREV_HOP = { B: "A", C: "B", R: "C" };
const HOP_DELAY_MS = 1400;
const NAMES = { A: "Victim", B: "Relay B", C: "Relay C", R: "Rescue" };
const CHAIN = ["A", "B", "C", "R"];

// Set page identity
document.getElementById("nodeTitle").textContent = `PHONE ${NODE}`;
document.getElementById("pageTitle").textContent = `${NAMES[NODE]}`;
document.title = `JeevanLink — ${NAMES[NODE]}`;

// Neighbors chain
const neighborsLine = document.getElementById("neighborsLine");
neighborsLine.innerHTML = CHAIN.map((n, i) => {
  const isSelf = n === NODE;
  const arrow = i < CHAIN.length - 1 ? `<div class="nb-arrow">→</div>` : "";
  return `
    <div class="nb-node ${isSelf ? "self-node" : ""}">
      <div class="nb-dot">${n === "A" ? "📱" : n === "R" ? "🛡️" : "📶"}</div>
      <div class="nb-id">${n}</div>
      <div class="nb-name">${NAMES[n]}</div>
    </div>${arrow}
  `;
}).join("");

const meshDot     = document.getElementById("meshDot");
const meshLabel   = document.getElementById("meshLabel");
const statStatus  = document.getElementById("statStatus");
const statQueue   = document.getElementById("statQueue");
const statSpeed   = document.getElementById("statSpeed");
const rangeSwitch = document.getElementById("rangeSwitch");
const queueNote   = document.getElementById("queueNote");
const queueNoteText = document.getElementById("queueNoteText");
const feed        = document.getElementById("feed");
const feedCount   = document.getElementById("feedCount");
const toggleLabel = document.getElementById("toggleLabel");

let inRange = true;
let packetCount = 0;
const seen = new Set();

socket.on("connect", () => socket.emit("register", { nodeId: NODE }));

socket.on("topology:update", ({ online }) => {
  const self = online[NODE];
  meshDot.classList.toggle("on", self);
  meshLabel.textContent = self ? "on mesh" : "out of range";
  statStatus.textContent = self ? "online" : "offline";

  const nextHop = NEXT_HOP[NODE];
  if (nextHop && self && online[nextHop] === false) {
    if (queueNoteText) queueNoteText.textContent = `Next hop (${nextHop} · ${NAMES[nextHop]}) is offline — packets queuing here until it reconnects.`;
    queueNote.classList.add("show");
  } else {
    queueNote.classList.remove("show");
  }
});

rangeSwitch.addEventListener("click", () => {
  inRange = !inRange;
  rangeSwitch.classList.toggle("on", inRange);
  if (toggleLabel) toggleLabel.textContent = inRange ? "IN RANGE" : "OUT OF RANGE";
  socket.emit("node:set-online", { nodeId: NODE, value: inRange });
});

function updateCount() {
  if (feedCount) feedCount.textContent = `${packetCount} packet${packetCount !== 1 ? "s" : ""}`;
  if (statQueue) statQueue.textContent = String(packetCount);
  if (statSpeed) statSpeed.textContent = `${(HOP_DELAY_MS / 1000).toFixed(1)}s`;
}

function clearEmpty() {
  const empty = feed.querySelector(".feed-empty");
  if (empty) empty.remove();
}

function addEntry(sos) {
  clearEmpty();
  packetCount++;
  updateCount();
  const el = document.createElement("div");
  el.className = "feed-entry";
  el.id = `entry-${sos.id}`;
  const alreadySeen = seen.has(sos.id);
  seen.add(sos.id);
  el.innerHTML = `
    <div class="entry-top">
      <span class="entry-id">${sos.id}</span>
      <span class="entry-ts">${new Date(sos.createdAt || Date.now()).toLocaleTimeString()}</span>
    </div>
    <span class="badge ${sos.severity}" style="margin-bottom:6px;display:inline-flex;">${sos.severity.toUpperCase()}</span>
    <div class="entry-line">${alreadySeen ? "⚠️ Duplicate packet — already seen, not re-forwarded." : "📥 Received via mesh. New packet, not seen before."}</div>
  `;
  feed.prepend(el);
  return el;
}

socket.on("sos:incoming", (sos) => {
  const el = addEntry(sos);
  const nextHop = NEXT_HOP[NODE];
  const fwd = document.createElement("div");
  fwd.className = "entry-line forwarded";
  fwd.textContent = `⏳ Storing and forwarding to ${nextHop} · ${NAMES[nextHop]}…`;
  el.appendChild(fwd);

  setTimeout(() => {
    fwd.textContent = `✅ Forwarded to ${nextHop} · ${NAMES[nextHop]}`;
    fwd.classList.add("forwarded");
  }, HOP_DELAY_MS + 200);
});

socket.on("ack:relay", ({ sosId }) => {
  const el = document.getElementById(`entry-${sosId}`);
  const line = document.createElement("div");
  line.className = "entry-line ack";
  line.textContent = "↩ Acknowledgment relayed back toward victim.";
  if (el) {
    el.appendChild(line);
  } else {
    clearEmpty();
    const wrap = document.createElement("div");
    wrap.className = "feed-entry";
    wrap.innerHTML = `<div class="entry-top"><span class="entry-id">${sosId}</span></div><div class="entry-line ack">↩ ACK relayed back toward victim.</div>`;
    feed.prepend(wrap);
  }
});