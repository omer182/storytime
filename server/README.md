# Storytime server

NFC figure scans -> Hebrew bedtime story, via Claude. Also serves the `../ui` frontend as static files.

## Flow

1. `POST /api/stories` -> new story, `status: "collecting"`
2. `POST /api/stories/:id/figures` `{ uid }` -> the ESP calls this on every scan. Always 200; drives the LED off `led`:
   - unknown tag -> `{ recognized: false, led: "red_wiggle" }`
   - already-added tag -> `{ recognized: true, duplicate: true, led: "blue_pulse", ... }`
   - new tag -> `{ recognized: true, duplicate: false, led: "green_pulse", ... }`
3. `POST /api/stories/:id/generate` `{ length?, generateImages? }` -> requires at least one figure each of category `character`, `location`, `mood`. Missing ones come back as `422 { missing: [...] }`. `length` (`short` | `medium` | `long`, default `medium`) controls the target word count. `generateImages` (default `true`) is a per-story opt-out of illustrations - still requires `GENERATE_IMAGES=true` and `OPENAI_API_KEY` server-side to do anything. On success, calls the configured LLM and saves the story text plus a short auto-generated `title` (the LLM is asked for a title on the first line, parsed off before saving - see `splitTitleAndBody` in `src/services/storyService.ts`; falls back to no title if the model doesn't follow that shape), then (if enabled both server-side and for this request) generates 3 illustrations - start/middle/end - and returns them as `images: string[]` (base64 data URLs) on this response only. Images are **not persisted** - not written to the db, not saved to disk - so a later `GET` of the same story has no `images` field; they only ever exist in the browser session that just generated them.
4. `GET /api/stories/:id` -> story + figures + text
5. `GET /api/stories` -> history list (generated stories only - a story still being collected, or abandoned mid-way, does not show up here)
6. `GET /api/figures` -> the full deck
7. `POST /api/figures` `{ uid, name, category, description }` -> register a new figure against a uid (or update an existing uid's details); `DELETE /api/figures/:uid` -> remove one. This is what the UI calls when you name a newly-scanned tag mid-story - see [Enrolling new figures](#enrolling-new-figures) below.

Full OpenAPI docs at `/docs` once running.

## Tests

```bash
npm test
```

System tests in `tests/system/` drive the real Express app end-to-end through HTTP (via `supertest`) — full story lifecycle, UID normalization/duplicate detection, the generate validation gate, and 404/400 error cases. They use an isolated temp SQLite file per run and `LLM_PROVIDER=mock` (see `src/llm/mockProvider.js`), so no API key or network is needed to run them.

## Run locally

```bash
cp .env.example .env    # paste your ANTHROPIC_API_KEY
npm install
npm run dev
```

Then open <http://localhost:3000/> for the UI, or <http://localhost:3000/docs> for Swagger.

## Run with Docker

`docker-compose.yml` lives at the **repo root** (`storytime/`, one level up from here), not in `server/` — that's deliberate, see the Deployment section below. From the repo root:

```bash
ANTHROPIC_API_KEY=sk-ant-... docker compose up --build
```

The db file persists on the host at `server/data/stories.db` via the mounted volume (`./server/data:/app/server/data`), so `docker compose down && docker compose up` (or a full container recreate) keeps all stories.

## Deployment (home server / Portainer)

This ships with **SQLite** (`better-sqlite3`), not a separate database server — the whole app is one container with an embedded db file. That's a deliberate fit for a single-stack home-server deploy: no Postgres/MySQL container to also manage, no network hop between app and db.

`.github/workflows/docker-build.yml` builds the image on every push to `main` and publishes it to **GHCR** (`ghcr.io/<owner>/<repo>`), tagged `latest` - matching how the other homeserver stacks are deployed. `.github/workflows/pr-checks.yml` runs the server build+tests, the UI type-check+build, and a Docker build test (no push) on every PR.

**Option A - pull the published image (matches your other stacks):**

1. Once the repo is public (or the `storytime` package's visibility is set to public under the repo's Packages settings - GHCR packages inherit repo visibility by default, and a private package needs a registry credential configured in Portainer to pull), Portainer → **Stacks** → **Add stack** → **Web editor**, and point `image:` at `ghcr.io/<your-github-username>/<repo-name>:latest` instead of using `build:`.
2. Add `ANTHROPIC_API_KEY` (and `OPENAI_API_KEY` + `LLM_PROVIDER=openai` if you're switching providers) as stack environment variables, and a volume for `/app/server/data` (see below).
3. Re-running the stack pulls the newest `latest` tag pushed by the Action - no rebuild needed on the server itself.

**Option B - build from the git repo directly in Portainer:**

1. Portainer → **Stacks** → **Add stack** → **Repository**, point it at this repo. Leave the compose path as `docker-compose.yml` (it's at the repo root, using `build:` against `server/Dockerfile`).
2. Add `ANTHROPIC_API_KEY` as a stack environment variable in Portainer's UI — the compose file reads it via `${ANTHROPIC_API_KEY}`. Add `OPENAI_API_KEY` and set `LLM_PROVIDER=openai` in the compose file/stack env too if you're switching providers.

**Either way, the data volume:** `./server/data:/app/server/data` is a **bind mount to a path relative to the stack's working directory** (wherever Portainer keeps the stack's files on the host). That's fine as-is — Portainer keeps that directory stable across redeploys/updates of the same stack, so the db file survives. If you'd rather pin it to a specific host path (e.g. a NAS share you back up separately), change that line to an absolute host path, e.g. `/volume1/docker/storytime/data:/app/server/data`. Redeploying the stack (pulling a new image, or rebuilding) does **not** touch the volume, so story history survives every update — only deleting the underlying host folder would lose it.

## Enrolling new figures

Figures (the NFC-tag deck) live in the `figures` table in SQLite, not a file — so they persist across redeploys via the same volume as story history, and don't need a code change or restart to add. On first run, the table is seeded once from `src/data/figures.json`'s placeholder deck (`PLACEHOLDER-CHAR-01`, etc.); after that the DB is the source of truth and the JSON file is no longer read.

Registering a real tag happens inline, while building a story - no separate mode:

1. Start a story and scan the new tag (the ESP32 will call `POST /api/stories/:id/figures` with its UID once the firmware exists; until then, the UI's own tap-to-scan deck or a direct `curl` to that endpoint works the same way).
2. An unrecognized UID comes back as `{ recognized: false }`. The UI catches that and opens a "תג לא מוכר" (unrecognized tag) modal on the spot: pick a category, give it a name, optional description.
3. Submitting the modal calls `POST /api/figures` to register it, then immediately re-submits the same UID to the story - so the new figure is both saved to the deck for next time *and* added to the story you're building right now.

The **"דמויות" (Figures)** tab lists everything currently in the deck with a delete button, for fixing a mis-scan or retiring a tag.

## Config (`.env`)

| Var | Default | Notes |
|---|---|---|
| `PORT` | `3000` | |
| `LLM_PROVIDER` | `anthropic` | `anthropic` \| `openai` \| `mock` |
| `LLM_MODEL` | `claude-haiku-4-5-20251001` | cheap + plenty good for bedtime stories, ~2c/story. Set to an OpenAI model (e.g. `gpt-4o`) when `LLM_PROVIDER=openai` |
| `ANTHROPIC_API_KEY` | — | required when `LLM_PROVIDER=anthropic` |
| `OPENAI_API_KEY` | — | required when `LLM_PROVIDER=openai`, **and** required for illustrations regardless of `LLM_PROVIDER` (Claude has no image generation) |
| `GENERATE_IMAGES` | `true` | set `false` to turn off illustrations even when `OPENAI_API_KEY` is set |
| `IMAGE_MODEL` | `gpt-image-1.5` | ~$0.03-0.05/image at medium quality -> ~$0.10-0.15/story for the 3 illustrations |
| `DB_PATH` | `server/data/stories.db` | |
| `FIGURES_PATH` | `server/src/data/figures.json` | only read once, to seed the `figures` table when it's empty (fresh DB) |
| `LOG_LEVEL` | `info` (`silent` when `LLM_PROVIDER=mock`) | `trace` \| `debug` \| `info` \| `warn` \| `error` \| `silent`. `debug` also logs LLM token usage per call |
| `LOG_PRETTY` | `true` | `false` for raw JSON lines (e.g. if you pipe logs into something that parses JSON) instead of the human-readable format |

No auth — this is designed for a closed home network only.

## Logs

Structured logging via [pino](https://getpino.io), wired up in `src/logger.ts`. Every request (via `pino-http`), every scan (recognized/duplicate/new/unrecognized), every figure enrollment/deletion, and every story generation is logged with context (`storyId`, `uid`, timings). `generateStory()` specifically logs the text-generation duration, the illustration-generation duration (or the failure, since images are best-effort and don't fail the request), and a total. LLM/image provider calls log duration and outcome at `info`/`error`; full token usage is at `debug`.

In Portainer, this all lands in the container's stdout, so **Containers → storytime → Logs** shows it live - no extra setup needed. Locally, `docker compose logs -f` or just watch the `npm run dev` terminal.

## Illustrations

`POST /api/stories/:id/generate` optionally generates 3 illustrations alongside the story text (`src/llm/imageProvider.ts`), gated on `GENERATE_IMAGES` and an `OPENAI_API_KEY` being set - independent of `LLM_PROVIDER`, since only OpenAI's image API is wired up.

1. The full generated story text and cast are sent to `gpt-4o`, which writes exactly 3 English image prompts (opening / a key middle moment / ending). The prompt requires every prompt to stick to characters and settings that literally appear in the story (no invented characters), to describe each recurring character's concrete appearance the same way every time (so they read as the same character across the 3 images), to end with an identical fixed style instruction ("Disney/Pixar-style 2D animated..."), and to never include any text, letters, or speech bubbles in the image.
2. The 3 images are generated **in parallel** via `IMAGE_MODEL` (`client.images.generate`) - this is what keeps a 3-image story generation to ~30-35s instead of ~80s+ sequential.
3. Images come back as base64 data URLs and are **never persisted** - not to SQLite, not to disk. They exist only in that one `POST /generate` response; the UI interleaves them into the story (start / middle / end) for that viewing, and a later `GET` of the same story has no images.

Consistency isn't perfect - each image call is independent, so minor drift (e.g. a character's color) can happen between the 3 images despite the repeated description. Good enough for a first pass; tightening this further would mean a different approach (e.g. image-to-image conditioning on a reference image) rather than prompt wording alone.
