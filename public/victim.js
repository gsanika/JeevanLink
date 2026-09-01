const socket = io();

const meshDot = document.getElementById("meshDot");
const meshLabel = document.getElementById("meshLabel");
const signalStatus = document.getElementById("signalStatus");
const meshStatus = document.getElementById("meshStatus");
const severityStatus = document.getElementById("severityStatus");
const responseStatus = document.getElementById("responseStatus");

const idleView = document.getElementById("idleView");
const reviewView = document.getElementById("reviewView");
const statusView = document.getElementById("statusView");

const sosBtn = document.getElementById("sosBtn");
const sosBtnHint = document.getElementById("sosBtnHint");
const typeInsteadBtn = document.getElementById("typeInsteadBtn");
const transcriptEl = document.getElementById("transcript");
const parsedChips = document.getElementById("parsedChips");
const locLine = document.getElementById("locLine");
const photoInput = document.getElementById("photoInput");
const photoThumb = document.getElementById("photoThumb");
const discardBtn = document.getElementById("discardBtn");
const sendBtn = document.getElementById("sendBtn");
const newSosBtn = document.getElementById("newSosBtn");

let currentLocation = null;
let currentPhotoDataUrl = null;
let recognizing = false;
let recognition = null;

// ---- mesh connection ----
socket.on("connect", () => socket.emit("register", { nodeId: "A" }));
socket.on("topology:update", ({ online }) => {
  const isOnline = online.A;
  meshDot.classList.toggle("on", isOnline);
  meshLabel.textContent = isOnline ? "mesh: connected" : "mesh: searching for nearby phones…";
  meshStatus.textContent = isOnline ? "connected" : "searching";
  signalStatus.textContent = isOnline ? "GPS live" : "GPS standby";
  responseStatus.textContent = isOnline ? "ready" : "waiting";
});

// ---- location ----
function locate() {
  if (!("geolocation" in navigator)) {
    locLine.textContent = "GPS unavailable — will send without coordinates";
    return;
  }
  locLine.textContent = "locating…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      currentLocation = { lat: +pos.coords.latitude.toFixed(4), lng: +pos.coords.longitude.toFixed(4) };
      locLine.textContent = `${currentLocation.lat}, ${currentLocation.lng}`;
      localStorage.setItem("jl_last_location", JSON.stringify(currentLocation));
    },
    () => {
      const last = localStorage.getItem("jl_last_location");
      if (last) {
        currentLocation = JSON.parse(last);
        locLine.textContent = `${currentLocation.lat}, ${currentLocation.lng} (last known)`;
      } else {
        locLine.textContent = "location unavailable";
      }
    },
    { timeout: 8000 }
  );
}

// ---- on-device heuristic emergency parser ----
function parseEmergency(text) {
  const t = (text || "").toLowerCase();
  let people = 1;
  const peopleMatch = t.match(/(\d+)\s*(people|persons|of us)/);
  if (peopleMatch) people = parseInt(peopleMatch[1], 10);

  let injured = 0;
  const injuredMatch = t.match(/(\d+)\s*(injured|hurt|wounded)/);
  if (injuredMatch) injured = parseInt(injuredMatch[1], 10);
  else if (/injur|hurt|wound|bleeding|unconscious/.test(t)) injured = Math.max(injured, 1);

  const criticalWords = ["trapped", "collapse", "unconscious", "buried", "can't breathe", "cant breathe", "bleeding heavily", "fire", "dying"];
  const highWords = ["injur", "hurt", "pain", "broken", "wound", "bleeding"];

  let severity = "medium";
  if (criticalWords.some((w) => t.includes(w))) severity = "critical";
  else if (highWords.some((w) => t.includes(w))) severity = "high";

  return { people, injured, severity };
}

function renderChips() {
  const parsed = parseEmergency(transcriptEl.value);
  severityStatus.textContent = parsed.severity;
  parsedChips.innerHTML = `
    <span class="badge ${parsed.severity}">${parsed.severity.toUpperCase()}</span>
    <span class="pill">${parsed.people} ${parsed.people === 1 ? "person" : "people"}</span>
    ${parsed.injured ? `<span class="pill">${parsed.injured} injured</span>` : ""}
  `;
  return parsed;
}

transcriptEl.addEventListener("input", renderChips);

// ---- recording (Web Speech API, with typed fallback) ----
function startRecording() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  showReview();
  transcriptEl.value = "";
  renderChips();
  transcriptEl.focus();

  if (!SR) {
    // no speech API available (e.g. non-Chromium browser) — typed fallback
    return;
  }
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-IN";
  recognizing = true;
  sosBtn.classList.add("recording");

  recognition.onresult = (e) => {
    let text = "";
    for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
    transcriptEl.value = text;
    renderChips();
  };
  recognition.onerror = () => stopRecording();
  recognition.onend = () => stopRecording();
  recognition.start();
}

function stopRecording() {
  recognizing = false;
  sosBtn.classList.remove("recording");
  if (recognition) {
    try { recognition.stop(); } catch (e) {}
  }
}

function showReview() {
  idleView.classList.add("hidden");
  reviewView.classList.remove("hidden");
  statusView.classList.add("hidden");
  responseStatus.textContent = "reviewing";
  locate();
}

function showIdle() {
  idleView.classList.remove("hidden");
  reviewView.classList.add("hidden");
  statusView.classList.add("hidden");
  responseStatus.textContent = "awaiting";
  stopRecording();
}

sosBtn.addEventListener("click", () => {
  if (recognizing) {
    stopRecording();
  } else {
    startRecording();
  }
});

typeInsteadBtn.addEventListener("click", () => {
  showReview();
});

discardBtn.addEventListener("click", showIdle);

photoInput.addEventListener("change", () => {
  const file = photoInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    currentPhotoDataUrl = reader.result;
    photoThumb.src = currentPhotoDataUrl;
    photoThumb.classList.remove("hidden");
  };
  reader.readAsDataURL(file);
});

// ---- send ----
let activeSosId = null;

sendBtn.addEventListener("click", () => {
  const parsed = parseEmergency(transcriptEl.value);
  const payload = {
    message: transcriptEl.value.trim() || "(no message — location + severity only)",
    people: parsed.people,
    injured: parsed.injured,
    severity: parsed.severity,
    location: currentLocation,
    photo: currentPhotoDataUrl,
  };
  socket.emit("sos:create", payload);
});

socket.on("sos:created", (sos) => {
  activeSosId = sos.id;
  reviewView.classList.add("hidden");
  statusView.classList.remove("hidden");
  responseStatus.textContent = "sending";
  document.getElementById("statusId").textContent = sos.id;
  document.getElementById("stepCreated").classList.add("done");
  document.getElementById("stepRelay").classList.add("active");
});

socket.on("ack:delivered", ({ sosId }) => {
  if (sosId !== activeSosId) return;
  responseStatus.textContent = "help en route";
  document.getElementById("stepRelay").classList.remove("active");
  document.getElementById("stepRelay").classList.add("done");
  document.getElementById("stepAck").classList.add("done");
});

newSosBtn.addEventListener("click", () => {
  activeSosId = null;
  currentPhotoDataUrl = null;
  photoThumb.classList.add("hidden");
  photoInput.value = "";
  ["stepCreated", "stepRelay", "stepAck"].forEach((id) => {
    document.getElementById(id).classList.remove("done", "active");
  });
  showIdle();
});
