# Operation Iron Front — Prototype v0.1

A browser-based multiplayer tactical shooter prototype for 2–7 players.

## Included
- Room creation and joining with six-character room codes
- Lobby player list and host controls
- Free-for-all and team mode settings
- First-person and third-person camera selection
- A low-poly, war-damaged urban arena
- Basic WASD movement, mouse aim, shooting, health, kills/deaths, reload
- Touch movement and fire controls for mobile testing
- Five-minute match timer and match report

## Requirements
- Node.js 18 or newer
- Internet access in the browser for the Three.js CDN (or download Three.js locally for offline use)

## Run locally
1. Extract the ZIP.
2. Open a terminal in the extracted `operation_iron_front` folder.
3. Run `npm install`
4. Run `npm start`
5. Open `http://localhost:8080`

For multiple devices, they must be able to reach the host computer's LAN IP and port 8080, and the firewall must allow it. For internet play, deploy the server to a public host with HTTPS/WSS and configure the host's port. Do not expose an unprotected development server to the public internet.

## Important prototype limitations
This is an early prototype, not a production-ready commercial shooter. The server synchronizes player movement and validates some combat rules, but the client still chooses the hit target; this is not cheat-resistant. There is no account system, persistent progression, matchmaking, voice chat, or production-grade anti-cheat. Team mode currently respawns eliminated players; free-for-all elimination is intended as a last-operator-standing mode. A production release needs server-side hit detection, robust movement validation, proper collision and map navigation, secure hosting, load testing, and accessibility/device testing.

The map is an original fictional environment inspired by damaged urban architecture. It does not recreate a specific real-world battle location.
