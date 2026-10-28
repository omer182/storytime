# Storytime

An AI bedtime-story app. Pick a cast - a character, a place, a mood, and optionally an object - choose how long the story should be, and an LLM writes a short, personalized Hebrew story around them. Optionally, it also paints three storybook illustrations to go with it.

It's a mobile-first web app (Hebrew, right-to-left) backed by a small Node/Express API. Everything runs as one container.

## Layout

```
server/   Node/Express + TypeScript backend, SQLite storage, Swagger docs
ui/       TypeScript frontend (esbuild-bundled), served by the backend as static files
```

Both are independent TypeScript projects with their own `package.json`. The frontend compiles to a single bundled `ui/app.js`, which the backend serves alongside `index.html`/`styles.css` - the whole app is one process on one port.

## How it works

1. **Start a story.** `POST /api/stories` creates an empty story (`status: "collecting"`).
2. **Pick the cast.** In the UI you choose from the deck of figures, one category at a time (`POST /api/stories/:id/figures`). A story needs at least one **character**, one **place**, and one **mood**; **objects** are optional.
3. **Generate.** Pick a story length (short / medium / long, via a slider) and whether to include illustrations (off by default - it's the costlier part). `POST /api/stories/:id/generate` asks the configured LLM (OpenAI `gpt-4.1` by default; Claude is supported too) for the Hebrew story plus a short title, and saves it. If illustrations were requested, three Disney/Pixar-style pictures - opening, middle, ending - are then generated in parallel via OpenAI's image API, staying strictly on the actual plot and cast. See [Illustrations](server/README.md#illustrations).
4. **Read it, and read it again.** Generated stories show up in history (`GET /api/stories`), with the opening illustration as their cover. Stories that were started but never generated don't. Illustrations are saved next to the database (about 380KB per illustrated story), so a story keeps its pictures when you open it again later.

Figures can have a thumbnail (`ui/figure-images/`) and, for places, an optional real photograph that the illustrations are painted over, so a story can happen in an actual room. See [Managing the deck](server/README.md#managing-the-deck).

Full API contract and OpenAPI docs: see [server/README.md](server/README.md) and `/docs` once the server is running.

## Quick start

```bash
npm install           # installs concurrently for the root dev script
npm run install:all   # installs server/ and ui/'s own dependencies
npm run dev           # runs the backend (tsx watch) and the UI bundler (esbuild --watch) together
```

Then open <http://localhost:3000/>. You'll need an API key for your chosen LLM provider (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`) in `server/.env` for story generation to actually work - see [server/README.md](server/README.md#run-locally) for the one-time setup, and [server/README.md](server/README.md#config-env) for all the options. Illustrations always need `OPENAI_API_KEY`, whichever LLM writes the story.

Editing `ui/src/app.ts` while `npm run dev` is running rebuilds `ui/app.js` automatically (via esbuild's watch mode) - just refresh the browser after saving. `server/src/**/*.ts` changes restart the backend automatically (via tsx watch).

## Tests

```bash
cd server && npm test
```

System tests drive the real backend over HTTP with a mocked LLM provider - no API key or network needed. See [server/README.md](server/README.md#tests).

## Deploying

Runs as a single Docker container - SQLite is an embedded file, not a separate database service, so there's nothing else to stand up. Every push to `main`/`master` builds and publishes the image to **GHCR** via [.github/workflows/docker-build.yml](.github/workflows/docker-build.yml), tagged `latest`: `ghcr.io/<owner>/<repo>:latest`.

### Docker Compose (local or any Docker host)

From the repo root, builds the image locally from source:

```bash
OPENAI_API_KEY=sk-... docker compose up --build
```

### Portainer (home server)

Pulls the pre-built image from GHCR instead of building on the server. Portainer → **Stacks** → **Add stack** → **Web editor**, paste:

```yaml
services:
  storytime:
    image: ghcr.io/<your-github-username>/storytime:latest
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - LLM_PROVIDER=${LLM_PROVIDER}
      - LLM_MODEL=${LLM_MODEL}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - GENERATE_IMAGES=${GENERATE_IMAGES}
      - DB_PATH=/app/server/data/stories.db
      - LOG_LEVEL=${LOG_LEVEL}
    volumes:
      - ./data:/app/server/data
    restart: unless-stopped
```

Then, in the stack's **Environment variables** section (not in the YAML itself - keeps keys out of the stack definition), add:

| Variable | Example |
|---|---|
| `LLM_PROVIDER` | `openai` (or `anthropic`) |
| `LLM_MODEL` | `gpt-4.1` (or `claude-haiku-4-5-20251001`) |
| `OPENAI_API_KEY` | `sk-...` (also required for illustrations, regardless of `LLM_PROVIDER`) |
| `ANTHROPIC_API_KEY` | `sk-ant-...` (only if `LLM_PROVIDER=anthropic`) |
| `GENERATE_IMAGES` | `true` (or `false` to turn off illustrations) |
| `LOG_LEVEL` | `info` (`debug` for full LLM/image call detail, `warn` for quieter logs) |

Deploy the stack. To update later, just re-pull: **Stacks → storytime → Pull and redeploy** (or re-run the same "Add stack" with **Update the stack**) - no rebuild needed, it grabs whatever the Action most recently pushed to `latest`.

Logs (every request, figure added, story generation with timing) show up live in **Containers → storytime → Logs** - see [server/README.md](server/README.md#logs).

Full walkthrough (registry visibility, volume/host-path notes, building from the git repo directly in Portainer instead of pulling the image) is in [server/README.md](server/README.md#deployment-home-server--portainer).

## Status

- [x] Backend API + SQLite storage + Swagger docs
- [x] Web UI (mobile-first, Hebrew RTL)
- [x] Deck of figures with thumbnails, managed from the UI and API
- [x] Multi-provider LLM support (OpenAI, Claude)
- [x] AI-generated illustrations (3 per story, plot-locked, saved with the story and shown in history)
- [x] Real-place reference photos for illustrations
- [x] Structured logging (pino) - requests, figures added, generation timing
- [x] System tests
- [x] TypeScript throughout
- [x] Docker image + CI (GitHub Actions: PR checks, GHCR publish on push to main)
