# JeevanLink — MVP prototype

A demoable prototype of the offline emergency mesh concept: a victim's phone
creates an SOS, it hops through two relay phones via store-and-forward, and
lands on a rescue command-center dashboard — with an acknowledgment that
travels back the same way.

## What's actually built vs. simulated

This is a **hackathon-grade prototype**, built to demonstrate the *logic and
UX* of the system end-to-end, not a production mesh radio stack. Being
upfront about the difference matters more than overclaiming it:

| Concept from the spec | In this prototype |
|---|---|
| SOS creation (voice, GPS, photo) | **Real.** Browser Speech-to-Text, `navigator.geolocation`, and camera/file capture actually run on-device. |
| On-device emergency parsing (people count, injury count, severity) | **Real, but heuristic** — keyword/regex based, not a trained NLP model. Labeled as such in the UI ("on-device read"). |
| Store-and-forward relay with dedup | **Real logic**, running over a fixed 4-node chain (Victim → Relay B → Relay C → Rescue) instead of real Bluetooth/Wi-Fi Direct radio. Each hop genuinely queues a packet if the next node is offline and flushes it on reconnect — you can watch this happen live (see demo script). |
| Bluetooth Low Energy / Wi-Fi Direct / Wi-Fi Aware peer discovery | **Simulated.** All "phones" are browser tabs talking to one Node.js server over Socket.io. Real device-to-device radio discovery is out of scope for this MVP and would be the next build phase (native Android/iOS with Nearby Connections API or similar). |
| Rescue dashboard, severity sorting, acknowledgment | **Real.** |
| Camera-based hazard detection (fire, collapsed structure, etc.) | **Not implemented.** The prototype attaches the photo to the SOS for the rescuer to view, but does not run any image classification — the spec itself warns against overclaiming this, so it's left as a labeled future step rather than faked. |

## Requirements

- Node.js 18+
- A Chromium-based browser (Chrome/Edge) for the victim page's voice capture —
  the Web Speech API isn't supported everywhere. Every other page works in
  any modern browser, and the victim page has a "type instead" fallback.

## Run it

```bash
npm install
npm start
```

Then open `http://localhost:3000` — it's a landing page linking to all four
roles. Open each in its own tab (or on separate devices on the same Wi-Fi,
pointing at your machine's LAN IP instead of `localhost`):

- `/victim.html` — Phone A, the victim
- `/relay.html?node=B` — Phone B, first relay hop
- `/relay.html?node=C` — Phone C, second relay hop
- `/dashboard.html` — Phone R, the rescue command center

## Demo script (the "wow" moment)

1. Open all four pages. Each one registers on the mesh — status dots turn
   green.
2. On **Phone A**, tap the SOS button, describe the emergency out loud (or
   tap "type instead"), review the on-device parsed severity/people/injured
   chips, then **Send SOS via mesh**.
3. **Relay B** logs "received → storing and forwarding," then a moment later
   **Relay C** does the same.
4. The **rescue dashboard** receives the packet, shows it sorted by severity
   with the full relay path (`A → B → C → R`), and you can **Acknowledge**
   it — watch the acknowledgment travel back through C and B to Phone A,
   which flips to "✅ Help request received."
5. To show **store-and-forward** specifically: on Relay C, flip "In radio
   range" off *before* sending a new SOS from Phone A. Watch it queue at
   Relay B ("Next hop is out of range — packets will queue here"). Then flip
   Relay C back on — the queued packet delivers immediately, and the
   dashboard receives it without you doing anything else.

## Architecture

```
Victim (A) --store&fwd--> Relay (B) --store&fwd--> Relay (C) --store&fwd--> Rescue (R)
     |                                                                          |
     '---------------------------- ack path, same route in reverse ------------'
```

`server.js` is the only backend file — an Express + Socket.io server that:
- tracks which of the 4 nodes are currently "in range" (a live socket
  connection, or manually toggled offline on a relay page),
- relays each SOS packet down the fixed chain with a simulated per-hop delay,
  queueing at any node whose next hop is offline and flushing that queue the
  moment the next hop reconnects,
- relays acknowledgments back up the same path,
- keeps an in-memory store of every SOS for the dashboard to bootstrap from
  on load.

Everything client-side is plain HTML/CSS/JS — no build step, no framework,
so it's easy to read, demo, and extend.

## Honest next steps (worth saying out loud to judges)

- Replace the simulated 4-node chain with real local peer discovery
  (Bluetooth LE / Wi-Fi Direct / Wi-Fi Aware on Android; MultipeerConnectivity
  on iOS) so range and topology are physical, not configured.
- Replace the regex-based parser with a small on-device NLP model.
- Add a real image-triage model, framed clearly as decision support, not a
  guaranteed classifier — matching the caution in the original spec.
- Add TTL/hop-limits and multi-path routing for a non-linear mesh with more
  than 4 nodes.
