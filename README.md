# Cards Against Hackatoa

A Cards Against Humanity-style party game for the browser. No czar — everyone votes each round. Custom cards, wild cards, image cards, and a community pack library.

**Live:** [cah.hackatoa.com](https://cah.hackatoa.com) · Part of [games.hackatoa.com](https://games.hackatoa.com)

---

## How to play

1. One player creates a room and shares the 6-character code
2. Everyone joins, host configures packs and options
3. Each round everyone plays cards from their hand
4. All submissions are shown anonymously — vote for your favourite (can't vote for your own)
5. Most votes wins the round. Ties broken randomly
6. First to the score goal wins

## Features

- **5 built-in packs** — Classic, Tech, Homelab, Gaming, Internet
- **Wild cards** — 2 per hand; click one and type anything
- **Image cards** — upload a JPG/PNG as a white card (up to 4MB)
- **Custom cards** — add your own black and white cards per session
- **Community packs** — save your cards to a shared library; load anyone's packs into your game
- **Rando Cardrissian** — AI bot that plays and votes randomly
- **Round timer** — 30/60/90/120s options; auto-submits/auto-votes on expiry

## Stack

- Node.js + Express + Socket.io
- SQLite (`better-sqlite3`) for community packs
- Multer for image uploads
- Vanilla JS / CSS front-end, no framework

## Self-hosting

```bash
docker run -d \
  --name cah \
  -p 3029:3029 \
  -v cah-data:/data \
  ghcr.io/hackatoan/cah:latest
```

Or with Docker Compose:

```yaml
services:
  cah:
    image: ghcr.io/hackatoan/cah:latest
    ports:
      - "3029:3029"
    volumes:
      - cah-data:/data
    restart: unless-stopped
volumes:
  cah-data:
```

Uploaded images and the community pack database are stored in `/data` (mount a volume to persist).

## Development

```bash
npm install
node server.js
# open http://localhost:3029
```
