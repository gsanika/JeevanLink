const socket = io();

const NAMES = { A: "Victim", B: "Relay B", C: "Relay C", R: "Rescue (you)" };
const CHAIN = ["A", "B", "C", "R"];
const SEV_ORDER = { critical: 0, high: 1, medium: 2 };

const queueEl     = document.getElementById("queue");
const topoChain   = document.getElementById("topoChain");
const cCritical   = document.getElementById("cCritical");
const cHigh       = document.getElementById("cHigh");
const cMedium     = document.getElementById("cMedium");
const sCritical   = document.getElementById("sCritical");
const sHigh       = document.getElementById("sHigh");
const sMedium     = document.getElementById("sMedium");
const sAcked      = document.getElementById("sAcked");
const activeBadge = document.getElementById("activeBadge");
const queueTitle  = document.getElementById("queueTitle");

let sosList = [];

socket.on("connect", () => socket.emit("register", { nodeId: "R" }));

socket.on("topology:update", ({ online }) => {
  topoChain.innerHTML = CHAIN.map((n, i) => {
    const isOnline = online[n];
    const isSelf = n === "R";
    const connector = i < CHAIN.length - 1
      ? `<div class="topo-connector">mesh link</div>`
      : "";
    return `
      <div class="topo-node ${isSelf ? "self" : ""} ${isOnline ? "online" : ""}">
        <span class="dot ${isOnline ? "on" : ""}"></span>
        <div class="node-info">
          <div class="node-id">${n}</div>
          <div class="node-name">${NAMES[n]}</div>
        </div>
        ${isOnline ? `<span style="font-size:10px;color:var(--ok);">●</span>` : `<span style="font-size:10px;color:var(--text-3);">○</span>`}
      </div>${connector}
    `;
  }).join("");
});

socket.on("sos:bootstrap", (list) => {
  sosList = list;
  render();
});

socket.on("sos:new", (sos) => {
  const idx = sosList.findIndex((s) => s.id === sos.id);
  if (idx >= 0) sosList[idx] = sos;
  else sosList.push(sos);
  render();
  // Flash badge
  activeBadge.style.display = "inline-flex";
});

function timeAgo(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

function render() {
  const crit = sosList.filter((s) => s.severity === "critical").length;
  const high = sosList.filter((s) => s.severity === "high").length;
  const med  = sosList.filter((s) => s.severity === "medium").length;
  const acked = sosList.filter((s) => s.ackStatus === "acknowledged").length;

  // Sidebar counts
  cCritical.textContent = crit;
  cHigh.textContent     = high;
  cMedium.textContent   = sosList.length;
  // Stats bar
  if(sCritical) sCritical.textContent = crit;
  if(sHigh)     sHigh.textContent     = high;
  if(sMedium)   sMedium.textContent   = med;
  if(sAcked)    sAcked.textContent    = acked;

  const filter = (typeof window.getFilter === "function") ? window.getFilter() : "all";
  const filtered = sosList.filter(s => filter === "all" || s.severity === filter);

  if (queueTitle) queueTitle.textContent = filter === "all"
    ? `All SOS Alerts (${sosList.length})`
    : `${filter.charAt(0).toUpperCase() + filter.slice(1)} Alerts (${filtered.length})`;

  if (!filtered.length) {
    queueEl.innerHTML = `
      <div class="empty-state">
        <div class="icon">📡</div>
        <div class="title">${sosList.length ? "No alerts for this filter" : "Monitoring mesh network…"}</div>
        <div class="desc">${sosList.length ? "Try a different filter to see alerts." : "No SOS packets received yet. Waiting for incoming emergency signals."}</div>
      </div>`;
    return;
  }

  const sorted = [...filtered].sort((a, b) => {
    const sevDiff = (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3);
    if (sevDiff !== 0) return sevDiff;
    return a.createdAt - b.createdAt;
  });

  queueEl.innerHTML = "";
  sorted.forEach((sos) => queueEl.appendChild(renderCard(sos)));
}

function renderCard(sos) {
  const el = document.createElement("div");
  el.className = `sos-card ${sos.severity}`;

  const pathHtml = CHAIN.map((n, i) => {
    const reached = sos.path.includes(n);
    const arrow = i < CHAIN.length - 1 ? `<span class="arrow">→</span>` : "";
    return `<span class="hop ${reached ? "reached" : ""}">${n}</span>${arrow}`;
  }).join("");

  const ackDone = sos.ackStatus === "acknowledged";

  el.innerHTML = `
    <div class="card-header">
      <div class="left">
        <span class="badge ${sos.severity}">${sos.severity.toUpperCase()}</span>
        <span class="sos-id">${sos.id}</span>
      </div>
      <span class="ago">${timeAgo(sos.createdAt)}</span>
    </div>
    <div class="card-body">
      <div class="card-meta">
        <span class="pill">👤 ${sos.people} ${sos.people === 1 ? "person" : "people"}</span>
        ${sos.injured ? `<span class="pill" style="border-color:rgba(232,72,76,0.3);color:var(--critical-text);">🩹 ${sos.injured} injured</span>` : ""}
        ${ackDone ? `<span class="badge ok">✓ Acknowledged</span>` : `<span class="badge offline">Pending</span>`}
      </div>
      ${sos.message ? `<div class="card-message">${escapeHtml(sos.message)}</div>` : ""}
      <div class="card-location">
        <span>📍</span>
        <span>${sos.location ? `${sos.location.lat}, ${sos.location.lng}` : "location unavailable"}</span>
      </div>
      ${sos.photo ? `<img class="card-photo" src="${sos.photo}" alt="Emergency photo" />` : ""}
      <div class="path-row">
        <span style="color:var(--text-3);font-size:10px;margin-right:6px;text-transform:uppercase;letter-spacing:.05em;">relay path</span>
        ${pathHtml}
      </div>
    </div>
    <div class="card-footer">
      <button class="btn ack-btn ${ackDone ? "done ok" : "primary"}" data-id="${sos.id}">
        ${ackDone ? "✓ Help dispatched" : "🚑 Acknowledge — notify victim"}
      </button>
    </div>
  `;

  const btn = el.querySelector(".ack-btn");
  btn.addEventListener("click", () => {
    if (sos.ackStatus === "acknowledged") return;
    socket.emit("ack:send", { sosId: sos.id });
    sos.ackStatus = "acknowledged";
    render();
  });

  return el;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

setInterval(render, 15000);