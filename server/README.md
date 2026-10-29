# Storytime server

Pick a cast, get a Hebrew bedtime story (and optionally three illustrations), via OpenAI or Claude. Also serves the `../ui` frontend as static files.

## Flow

1. `POST /api/stories` -> new story, `status: "collecting"`
2. `POST /api/stories/:id/figures` `{ uid }` -> add a figure from the deck to the story's cast. Always 200:
   - `uid` not in the deck -> `{ recognized: false }`
   - already in this story -> `{ recognized: true, duplicate: true, figure, figures }` (nothing added)
   - otherwise -> `{ recognized: true, duplicate: false, figure, figures }`, where `figures` is the story's updated cast

   A figure's `uid` is just its unique id in the deck. It is normalized (uppercased, spaces/colons/dashes stripped - see `src/utils/uid.ts`) before it is looked up.

   `DELETE /api/stories/:id/figures/:entryId` takes a figure back out of the cast.
3. `POST /api/stories/:id/generate` `{ length?, generateImages? }` -> requires at least one figure each of category `character`, `location`, `mood` (`object` is optional). Missing ones come back as `422 { missing: [...] }`. `length` (`short` | `medium` | `long`, default `medium`) controls the target word count. `generateImages` (default `true`) is a per-story opt-out of illustrations - still requires `GENERATE_IMAGES=true` and `OPENAI_API_KEY` server-side to do anything. On success, calls the configured LLM and saves the story text plus a short auto-generated `title` (the LLM is asked for a title on the first line, parsed off before saving - see `splitTitleAndBody` in `src/services/storyService.ts`; falls back to no title if the model doesn't follow that shape). The response returns as soon as the text is written, with `imagesPending: true` if illustrations are on - see [Illustrations](#illustrations).
4. `GET /api/stories/:id/images` -> `{ status: "pending" | "done" | "none", images: (string | null)[] }`, polled by the client while illustrations render; each entry is the URL of a saved scene (`null` = not ready yet / couldn't be drawn). `GET /api/stories/:id/images/<0|1|2|cover>.webp` serves the saved files themselves.
5. `GET /api/stories/:id` -> story + figures + text, plus `images` (scene URLs) once the story's illustrations are saved
6. `GET /api/stories` -> history list (generated stories only - a story still being collected, or abandoned mid-way, does not show up here), each with a `coverUrl` (`null` when the story has no illustrations)
7. `PATCH /api/stories/:id/favorite` `{ favorite: boolean }` -> mark or unmark a story as a favorite (reflected in `GET /api/stories` and `GET /api/stories/:id`)
8. `GET /api/figures` -> the full deck
9. `POST /api/figures` `{ name, category, description?, uid? }` -> add a figure to the deck and get it back, including its `uid` (generated if you don't pass one; passing an existing `uid` updates that figure instead); `DELETE /api/figures/:uid` -> remove one. See [Managing the deck](#managing-the-deck) below.

Full OpenAPI docs at `/docs` once running.

## Tests

```bash
npm test
```

System tests in `tests/system/` drive the real Express app end-to-end through HTTP (via `supertest`) — full story lifecycle, uid normalization/duplicate detection, the generate validation gate, and 404/400 error cases. They use an isolated temp SQLite file per run and `LLM_PROVIDER=mock` (see `src/llm/mockProvider.ts`), so no API key or network is needed to run them.

## Run locally

```bash
cp .env.example .env    # paste your OPENAI_API_KEY
npm install
npm run dev
```

Then open <http://localhost:3000/> for the UI, or <http://localhost:3000/docs> for Swagger.

## Run with Docker

`docker-compose.yml` lives at the **repo root** (`storytime/`, one level up from here), not in `server/` — that's deliberate, see the Deployment section below. From the repo root:

```bash
OPENAI_API_KEY=sk-... docker compose up --build
```

The db file persists on the host at `server/data/stories.db` via the mounted volume (`./server/data:/app/server/data`), so `docker compose down && docker compose up` (or a full container recreate) keeps all stories.

## Deployment (home server / Portainer)

This ships with **SQLite** (`better-sqlite3`), not a separate database server — the whole app is one container with an embedded db file. That's a deliberate fit for a single-stack home-server deploy: no Postgres/MySQL container to also manage, no network hop between app and db.

`.github/workflows/docker-build.yml` builds the image on every push to `main` and publishes it to **GHCR** (`ghcr.io/<owner>/<repo>`), tagged `latest` - matching how the other homeserver stacks are deployed. `.github/workflows/pr-checks.yml` runs the server build+tests, the UI type-check+build, and a Docker build test (no push) on every PR.

**Option A - pull the published image (matches your other stacks):**

1. Once the repo is public (or the `storytime` package's visibility is set to public under the repo's Packages settings - GHCR packages inherit repo visibility by default, and a private package needs a registry credential configured in Portainer to pull), Portainer → **Stacks** → **Add stack** → **Web editor**, and point `image:` at `ghcr.io/<your-github-username>/<repo-name>:latest` instead of using `build:`.
2. Add `OPENAI_API_KEY` as a stack environment variable (and `ANTHROPIC_API_KEY` + `LLM_PROVIDER=anthropic` if you'd rather have Claude write the stories - illustrations still need `OPENAI_API_KEY`), and a volume for `/app/server/data` (see below).
3. Re-running the stack pulls the newest `latest` tag pushed by the Action - no rebuild needed on the server itself.

**Option B - build from the git repo directly in Portainer:**

1. Portainer → **Stacks** → **Add stack** → **Repository**, point it at this repo. Leave the compose path as `docker-compose.yml` (it's at the repo root, using `build:` against `server/Dockerfile`).
2. Add `OPENAI_API_KEY` as a stack environment variable in Portainer's UI — the compose file reads it via `${OPENAI_API_KEY}`. The compose file pins `LLM_PROVIDER=openai` and `LLM_MODEL=gpt-4.1`; edit those lines (and add `ANTHROPIC_API_KEY`) if you want Claude to write the stories instead.

**Either way, the data volume:** `./server/data:/app/server/data` is a **bind mount to a path relative to the stack's working directory** (wherever Portainer keeps the stack's files on the host). That's fine as-is — Portainer keeps that directory stable across redeploys/updates of the same stack, so the db file survives. If you'd rather pin it to a specific host path (e.g. a NAS share you back up separately), change that line to an absolute host path, e.g. `/volume1/docker/storytime/data:/app/server/data`. Redeploying the stack (pulling a new image, or rebuilding) does **not** touch the volume, so story history survives every update — only deleting the underlying host folder would lose it.

## Managing the deck

The deck of figures (characters, places, moods, objects) lives in the `figures` table in SQLite, not a file — so it persists across redeploys via the same volume as story history, and doesn't need a code change or restart to edit. The starter deck is bundled in `src/data/figures.json`; on boot, any starter figure that has never been seeded into this database is added, and anything already seeded is left alone - so a figure you renamed or deleted in the UI stays that way, while newly shipped starter figures still reach an old database.

The **"דמויות" (Figures)** tab in the UI lists everything currently in the deck. Its **"＋ הוסיפו דמות חדשה"** button opens a small form - category, name, optional description - and the new figure shows up in the cast picker straight away. Each row also has a delete button for retiring a figure.

The same thing over the API (handy from the Swagger UI at `/docs`):

```json
POST /api/figures
{ "name": "דוב ישנוני", "category": "character", "description": "דוב גדול ועדין שאוהב לישון" }
```

`category` is one of `character`, `location`, `mood`, `object`. The response includes the generated `uid` (shown in small type under each figure's name in the Figures tab). You can also pass your own `uid` - any unique string - which is how you update an existing figure's details.

**Thumbnails.** A figure's picture in the picker is `ui/figure-images/<NORMALIZED-UID>.jpg` (or `.png`), where the normalized uid is uppercase with no dashes (`BEAR-01` -> `BEAR01.jpg`). A figure with no image shows its category's emoji instead - so a figure you add from the UI works straight away, and gets a picture only if you drop a file named after its uid into that folder.

## Config (`.env`)

| Var | Default | Notes |
|---|---|---|
| `PORT` | `3000` | |
| `LLM_PROVIDER` | `openai` | `openai` \| `anthropic` \| `mock` |
| `LLM_MODEL` | `gpt-4.1` | follows the storytelling brief closely and answers in ~10s. Set to a Claude model (e.g. `claude-haiku-4-5-20251001`) when `LLM_PROVIDER=anthropic` |
| `OPENAI_API_KEY` | — | required when `LLM_PROVIDER=openai`, **and** required for illustrations regardless of `LLM_PROVIDER` (Claude has no image generation) |
| `ANTHROPIC_API_KEY` | — | required when `LLM_PROVIDER=anthropic` |
| `GENERATE_IMAGES` | `true` | set `false` to turn off illustrations even when `OPENAI_API_KEY` is set |
| `IMAGE_MODEL` | `gpt-image-1.5` | the image model used for the 3 illustrations |
| `IMAGE_QUALITY` | `low` | `low` \| `medium` \| `high`. `low` renders in about half the time and costs less per image; `medium` gives a flatter, softer storybook look for more money and time |
| `DB_PATH` | `server/data/stories.db` | |
| `IMAGES_PATH` | `images/` next to `DB_PATH` | where story illustrations are saved - see [Illustrations](#illustrations) |
| `FIGURES_PATH` | `server/src/data/figures.json` | the bundled starter deck - read at boot to add any starter figure not yet seeded into the `figures` table |
| `REFERENCE_PHOTOS_PATH` | `server/data/reference-photos` | see [Reference photos](#reference-photos-illustrating-a-real-place) |
| `LOG_LEVEL` | `info` (`silent` when `LLM_PROVIDER=mock`) | `trace` \| `debug` \| `info` \| `warn` \| `error` \| `silent`. `debug` also logs LLM token usage per call |
| `LOG_PRETTY` | `true` | `false` for raw JSON lines (e.g. if you pipe logs into something that parses JSON) instead of the human-readable format |

No auth — this is designed for a closed home network only.

## Logs

Structured logging via [pino](https://getpino.io), wired up in `src/logger.ts`. Every request (via `pino-http`), every figure added to a story (new/duplicate/not in the deck), every deck change, and every story generation is logged with context (`storyId`, `uid`, timings). `generateStory()` specifically logs the text-generation duration, the illustration-generation duration (or the failure, since images are best-effort and don't fail the request), and a total. LLM/image provider calls log duration and outcome at `info`/`error`; full token usage is at `debug`.

In Portainer, this all lands in the container's stdout, so **Containers → storytime → Logs** shows it live - no extra setup needed. Locally, `docker compose logs -f` or just watch the `npm run dev` terminal.

## Illustrations

`POST /api/stories/:id/generate` optionally generates 3 illustrations alongside the story text (`src/llm/imageProvider.ts`), gated on `GENERATE_IMAGES` and an `OPENAI_API_KEY` being set - independent of `LLM_PROVIDER`, since only OpenAI's image API is wired up. With `LLM_PROVIDER=mock` an offline stand-in (`src/llm/mockImageProvider.ts`) draws solid-colour placeholders instead, so tests and local runs cover the whole save-and-serve path without a network call.

1. The full generated story text and cast are sent to `gpt-4o`, which writes exactly 3 English image prompts (opening / a key middle moment / ending). The prompt requires every prompt to stick to characters and settings that literally appear in the story (no invented characters), to describe each recurring character's concrete appearance the same way every time (so they read as the same character across the 3 images), to end with an identical fixed style instruction ("Disney/Pixar-style 2D animated..."), and to never include any text, letters, or speech bubbles in the image.
2. The 3 images are generated **in parallel** via `IMAGE_MODEL` - this is what keeps a 3-image story to ~17s instead of ~50s+ sequential.
3. `POST /generate` does **not** wait for them. It returns the story text as soon as it is written (~9s) with `imagesPending: true`, and the illustrations keep rendering in the background; the client polls `GET /api/stories/:id/images` until `status` is `done`, and each scene is reported as it lands.
4. A scene the safety system refuses walks a retry ladder (same prompt again, a wholesomeness clause, an LLM rewrite that de-brands the characters, and finally a characters-free view of the setting) before that one scene is given up on as `null`. The other two are unaffected.
5. Each scene is **saved to disk as it lands** (`src/services/illustrationStore.ts`): `<IMAGES_PATH>/<storyId>/0.webp`, `1.webp`, `2.webp` (1024×1024 WebP, about 120KB each), plus a 384px-wide `cover.webp` (~20KB) made from the first scene that succeeded, for the history list - roughly 380KB per illustrated story. The default `IMAGES_PATH` sits next to the db, on the same mounted data volume, so pictures survive restarts and redeploys. The `stories.images` column records which files were saved, and is written only once they are all in place; if that write fails, the files are removed rather than left behind. It is also cleared when a story is regenerated, so new text never shows the old pictures. The polling job itself is memory-only (15 minute TTL): a restart mid-render leaves that story text-only. Stories generated before illustrations were saved stay text-only.

Consistency isn't perfect - each image call is independent, so minor drift (e.g. a character's color) can happen between the 3 images despite the repeated description.

### Reference photos (illustrating a real place)

A location figure can have a real photograph of itself in `server/data/reference-photos/`, named after its **normalized uid** (no dashes) - e.g. `PLACEHOLDERLOC10.jpg` for חדר הילדים. `.jpg`, `.jpeg`, `.png` and `.webp` are accepted.

When a story's location has one, every scene is produced with `client.images.edit` using that photo as the base instead of `images.generate`: the room keeps its real layout, furniture and light, and is repainted in the storybook style with the characters set inside it. With no photo present nothing changes and the illustrations are imagined from the prompt as before.

The directory is under `data/` because that is the volume mounted in `docker-compose.yml`, so photos survive a redeploy, are not baked into the image, and are not served by the static `ui/` handler. It is gitignored - photographs of your own home do not belong in the repo. Override the location with `REFERENCE_PHOTOS_PATH`.

Note the figure's catalog thumbnail is separate: that still comes from `ui/figure-images/<NORMALIZED-UID>.jpg`, so a real place wants the photo saved in both places.
