# Cards Against Hackatoa

A free, multiplayer browser take on the classic fill-in-the-blank party card game.

🔗 **Live:** [cah.hackatoa.com](https://cah.hackatoa.com)   ·   ☕ **Support:** [Buy Me a Coffee](https://buymeacoffee.com/hackatoa)

## Overview

Create or join a room by code and play with friends in real time. No account, no install — just share the room code and go.

## Features

- Real-time multiplayer rooms (join by code)
- Configurable rounds and settings
- Global leaderboard
- 6-language localization

## Tech Stack

HTML · vanilla JS · Node.js (Socket.IO) · Docker

## Development

```bash
npm install
npm start
```

## Deployment

Docker on the homelab games host; GHCR + Watchtower auto-deploy.

Copy `.env.example` to `.env` next to `docker-compose.yml` on the host and set
`DATABASE_URL` before starting — it's no longer hardcoded in the compose file.

## Support

If this project is useful to you, consider supporting development:

☕ **[Buy Me a Coffee](https://buymeacoffee.com/hackatoa)**

---

Part of the **[Hackatoa](https://hackatoa.com)** ecosystem — self-hosted apps, browser games, and bots. · [All repositories »](https://github.com/Hackatoan)
