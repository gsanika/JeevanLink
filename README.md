# JeevanLink — Emergency Mesh Network Prototype

> An offline emergency mesh network concept: a victim's phone creates an SOS that hops through relay phones via store-and-forward messaging and lands on a rescue command-center dashboard — with acknowledgments traveling back the same way.

![Status](https://img.shields.io/badge/status-MVP%20Prototype-orange)
![Node.js](https://img.shields.io/badge/node-18+-green)
![License](https://img.shields.io/badge/license-MIT-blue)

## Overview

JeevanLink is a **hackathon-grade prototype** demonstrating the logic and UX of an emergency mesh network end-to-end. It's designed to work when cellular networks are unavailable during disasters, enabling emergency communications through a chain of nearby phones.

### Key Features

- 🚨 **Real SOS Creation** — Browser Speech-to-Text, GPS geolocation, and camera/file capture
- 📍 **On-Device Emergency Parsing** — Heuristic-based extraction of people count, injury count, and severity
- 📦 **Store-and-Forward Relay** — Messages queue and forward through a 4-node chain with deduplication
- ✅ **Rescue Dashboard** — Real-time severity sorting and acknowledgment tracking
- 🔄 **Two-Way Messaging** — Acknowledgments travel back through the relay chain to the victim

---

## What's Built vs. Simulated

| Feature | Implementation |
|---------|-----------------|
| **SOS creation** (voice, GPS, photo) | ✅ Real — Browser APIs run on-device |
| **Emergency parsing** (people, injuries, severity) | ✅ Real, but heuristic — keyword/regex based (labeled in UI) |
| **Store-and-forward relay with dedup** | ✅ Real logic — runs over fixed 4-node chain instead of radio |
| **Peer discovery** (BLE, Wi-Fi Direct, Wi-Fi Aware) | ⚠️ Simulated — all "phones" are browser tabs via Socket.io |
| **Rescue dashboard & acknowledgments** | ✅ Real |
| **Hazard detection** (fire, collapsed structure) | ❌ Not implemented — photo is attached for rescuer review |

---

## Requirements

- **Node.js** 18+
- **Browser** — Chromium-based (Chrome/Edge) for voice capture on the victim page
  - Other pages work in any modern browser
  - Victim page includes a "type instead" fallback for unsupported browsers

---

## Getting Started

### Installation

```bash
npm install
npm start
```

### Running the Demo

1. Open `http://localhost:3000` — a landing page linking to all four roles
2. Open each role in its own tab (or separate devices on the same Wi-Fi):
   - **Phone A (Victim)**: `/victim.html`
   - **Phone B (Relay 1)**: `/relay.html?node=B`
   - **Phone C (Relay 2)**: `/relay.html?node=C`
   - **Rescue (Command Center)**: `/dashboard.html`

---

## Demo Walkthrough

Follow these steps to see the full emergency mesh in action:

1. **Register Nodes**
   - Open all four pages
   - Each registers on the mesh — status dots turn green

2. **Create Emergency Alert**
   - On **Phone A**, tap the SOS button
   - Describe the emergency out loud (or tap "type instead")
   - Review parsed severity/people/injured chips
   - Tap **Send SOS via mesh**

3. **Watch the Relay**
   - **Relay B** logs "received → storing and forwarding"
   - A moment later, **Relay C** does the same
   - **Rescue dashboard** receives and displays the alert sorted by severity with full relay path (`A → B → C → R`)

4. **Send Acknowledgment**
   - Tap **Acknowledge** on the rescue dashboard
   - Watch the acknowledgment travel back through C and B to Phone A
   - Phone A flips to "✅ Help request received"

5. **Test Store-and-Forward**
   - On **Relay C**, toggle "In radio range" **off**
   - Send a new SOS from Phone A
   - Watch it queue at Relay B ("Next hop is out of range — packets will queue here")
   - Toggle Relay C **back on**
   - Queued packet delivers immediately without additional action

---

## Architecture

```
Victim (A) --store&fwd--> Relay (B) --store&fwd--> Relay (C) --store&fwd--> Rescue (R)
     |                                                                          |
     '---------------------------- ack path, same route in reverse -----------'
```

### Backend

**`server.js`** — Express + Socket.io server that:
- Tracks node connectivity status ("in range" = live socket or manually toggled)
- Relays SOS packets down the 4-node chain with per-hop delay simulation
- Queues packets at offline nodes and flushes on reconnection
- Relays acknowledgments back up the same path
- Maintains in-memory SOS store for dashboard bootstrapping

### Frontend

Pure HTML/CSS/JavaScript — no build step, no framework:
- Easy to read, demo, and extend
- Runs directly in the browser
- Real-time Socket.io communication

---

## Project Structure

```
JeevanLink/
├── server.js              # Backend server (Express + Socket.io)
├── package.json          # Dependencies
├── public/
│   ├── index.html        # Landing page
│   ├── victim.html       # Victim phone interface
│   ├── relay.html        # Relay node interface
│   ├── dashboard.html    # Rescue command center
│   ├── styles.css        # Global styling
│   └── script.js         # Shared client logic
└── README.md             # This file
```

---

## Next Steps (Production Roadmap)

To move from prototype to production:

1. **Replace simulated peer discovery** with real local protocols:
   - Android: Bluetooth LE, Wi-Fi Direct, Wi-Fi Aware
   - iOS: MultipeerConnectivity
   - Result: Range and topology become physical, not configured

2. **Replace regex parser** with a small on-device NLP model for better emergency extraction

3. **Add image-triage model** for hazard detection (fire, structural collapse, etc.)
   - Frame as decision support, not a guaranteed classifier
   - Match the caution from the original spec

4. **Implement advanced routing**:
   - TTL/hop-limits to prevent infinite loops
   - Multi-path routing for non-linear meshes
   - Support more than 4 nodes

---

## Use Cases

- **Natural Disasters** — Earthquakes, floods, storms cutting cellular networks
- **Remote Areas** — Emergency communications in regions with no coverage
- **Mass Gatherings** — Events where cellular networks are congested
- **First Responder Coordination** — Quick communication when infrastructure fails

---

## Technical Stack

- **Frontend**: HTML5, CSS3, vanilla JavaScript
- **Backend**: Node.js, Express, Socket.io
- **APIs**: Web Speech API, Geolocation API, Camera API

---

## Contributing

This is an active prototype. Contributions welcome for:
- UI/UX improvements
- Performance optimization
- Real peer discovery integration
- Model integration (NLP, image classification)

---

## License

MIT

---

**Built as an MVP to demonstrate emergency mesh network concepts. Not production-ready for life-critical systems without extensive testing and regulatory compliance.**
