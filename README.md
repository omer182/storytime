# Storytime

Generates short, personalized Hebrew bedtime stories for kids. Pick a cast — a character, a place, a mood, and optionally an object — and an LLM (Claude or OpenAI) writes a story around them.

There are two ways to build a story:

- **The physical book box** — a 3D-printed, book-shaped enclosure with an NFC reader and LED ring: scan figure tokens to build the cast. Hardware (enclosure, RC522 NFC reader, WS2812B LED ring, MAX98357A speaker amp, ESP32 firmware) is tracked separately from this repo; the firmware talks to the API described here.
- **The web UI** — the same flow, tap-to-select instead of tap-to-scan. Works standalone with no hardware, and is also where you add new figures to the deck (see below).

This repo is the software half of the project: backend + web UI.

## Layout

```
server/   Node/Express + TypeScript backend, SQLite storage, Swagger docs
ui/       TypeScript frontend (esbuild-bundled), served by the backend as static files
```

Both are independent TypeScript projects with their own `package.json`. The frontend compiles to a single bundled `ui/app.js`, which the backend serves alongside `index.html`/`styles.css` - the whole app is one process on one port.

## How it works

1. `POST /api/stories` starts a new story (`status: "collecting"`).
2. Each scan hits `POST /api/stories/:id/figures` with the tag's UID - the ESP32 will call this automatically the instant it reads a tag, and it always returns an `led` hint so the ring can react (`green_pulse` new / `blue_pulse` duplicate / `red_wiggle` unrecognized). The web UI's tap-to-scan deck grid hits the same endpoint, for use without hardware.
3. Once at least one character, one location, and one mood have been added, `POST /api/stories/:id/generate` calls the configured LLM (Claude Haiku 4.5 by default, ~2c/story) and saves the Hebrew story text.
4. Generated stories show up in history (`GET /api/stories`) - stories that were only started but never generated don't.
5. New figures (characters, places, moods, objects) are added from the web UI's "Add" tab, no code changes needed - see [Enrolling new figures](server/README.md#enrolling-new-figures).

Full API contract and OpenAPI docs: see [server/README.md](server/README.md) and `/docs` once the server is running.

## Quick start

```bash
npm install           # installs concurrently for the root dev script
npm run install:all   # installs server/ and ui/'s own dependencies
npm run dev           # runs the backend (tsx watch) and the UI bundler (esbuild --watch) together
```

Then open <http://localhost:3000/>. You'll need an API key for your chosen LLM provider (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`) in `server/.env` for story generation to actually work - see [server/README.md](server/README.md#run-locally) for the one-time setup, and [server/README.md](server/README.md#config-env) for where to get a key.

Editing `ui/src/app.ts` while `npm run dev` is running rebuilds `ui/app.js` automatically (via esbuild's watch mode) - just refresh the browser after saving. `server/src/**/*.ts` changes restart the backend automatically (via tsx watch).

## Tests

```bash
cd server && npm test
```

System tests drive the real backend over HTTP with a mocked LLM provider - no API key or network needed. See [server/README.md](server/README.md#tests).

## Deploying

Runs as a single Docker container - SQLite is an embedded file, not a separate database service. See [server/README.md](server/README.md#deployment-home-server--portainer) for the Portainer/home-server walkthrough.

```bash
ANTHROPIC_API_KEY=sk-ant-... OPENAI_API_KEY=sk-... docker compose up --build
```

## Status

- [x] Backend API + SQLite storage + Swagger docs
- [x] Web UI (mobile-first, Hebrew RTL)
- [x] Figure enrollment from the UI (no code changes to add a new figure/tag)
- [x] Multi-provider LLM support (Claude, OpenAI)
- [x] System tests
- [x] TypeScript throughout
- [x] Docker image + CI (GitHub Actions: PR checks, GHCR publish on push to main)
- [ ] ESP32 firmware (RC522 scan loop, LED gestures, MAX98357A sound effects) - not started yet
- [ ] Book-box enclosure - designed separately, not yet wired into this repo
