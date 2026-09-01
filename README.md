# JeevanLink Interactive Frontend

A polished, interactive vanilla HTML/CSS/JS frontend for the JeevanLink hackathon MVP. It preserves the existing Node.js + Socket.IO backend protocol.

## Run

```bash
npm install
npm start
```

Open http://localhost:3000

## Demo flow

1. Open `/victim.html`.
2. Open `/relay.html?node=B` and `/relay.html?node=C`.
3. Open `/dashboard.html`.
4. Create an SOS from the victim screen.
5. Watch it move A → B → C → R.
6. Acknowledge it in the command center and watch the ACK return.
7. For store-and-forward, turn Relay C **OUT OF RANGE**, create another SOS, then bring C back.

## Prototype note

The relay transport is still simulated by the existing server. The UI does not claim Bluetooth/Wi-Fi Direct is implemented. Native peer-to-peer transport is the next engineering phase.
