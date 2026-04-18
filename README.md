# Deep Research

A deep-research React app. Ask a topic → agent plans, searches, scrapes, cites, and writes a full markdown report with every source as a downloadable file.

Built on the Cloudflare Agents SDK with the new `Think` primitive. One Durable Object per session. React front end + Workers back end, deployed as a single Worker via Workers Assets.

## What it does

1. You type a topic
2. Agent decomposes it into sub-questions → writes `plan.md`
3. Runs Google searches (Bright Data SERP)
4. Scrapes the 5–15 best URLs (Bright Data Web Unlocker)
5. Saves each useful source as `sources/<slug>.md`
6. Keeps running notes in `notes.md`
7. Writes a cited final report to `report.md`

The UI has three panes:

- **Chat** — talk to the agent, see tool calls stream live
- **Workspace** — the file tree, updating in real time as the agent writes
- **Viewer** — click any file for an inline markdown preview + one-click download

## Stack

| | |
|---|---|
| **Agent** | `@cloudflare/think` (the new `Think` primitive) |
| **Filesystem** | `@cloudflare/shell` `Workspace` (DO SQLite + R2 spillover) |
| **Framework** | `agents` (`routeAgentRequest`, `callable`) |
| **Web tools** | Bright Data SERP + Web Unlocker |
| **UI** | React 19 + Vite + Tailwind 4 + react-markdown |
| **Deploy** | Cloudflare Workers (single worker, SPA via assets) |

## Project layout

```
deep-research-app/
├── wrangler.jsonc          # DO + R2 + assets + AI binding
├── vite.config.ts          # React + @cloudflare/vite-plugin
├── index.html              # SPA entry
├── src/
│   ├── server.ts           # Worker entry + ResearchAgent DO + file API
│   ├── prompts/
│   │   └── research-prompt.ts
│   ├── tools/
│   │   └── web.ts          # web_search + web_scrape (AI SDK tools)
│   └── ui/
│       ├── main.tsx        # React entry
│       ├── App.tsx         # Three-pane app (chat / files / viewer)
│       └── index.css       # Tailwind + markdown styles
```

## Setup

```sh
git clone <this repo>
cd deep-research-app
npm install --legacy-peer-deps
npx wrangler types
```

Create the R2 bucket (one time):

```sh
npx wrangler r2 bucket create deep-research-app-files
```

Set secrets (minimum: Bright Data + one LLM):

```sh
npx wrangler secret put BRIGHTDATA_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY    # or OPENAI_API_KEY
```

## Dev

```sh
npm run dev
```

Vite runs the React app, `@cloudflare/vite-plugin` runs the Worker in the same dev server. Open the printed URL.

## Deploy

```sh
npm run build
npm run deploy
```

Hits `https://deep-research-app.<subdomain>.workers.dev` by default.

## Model selection

Edit `RESEARCH_MODEL` in `wrangler.jsonc` — values like:

- `anthropic/claude-sonnet-4-5` — default, best quality
- `anthropic/claude-haiku-4-5` — cheaper, fine for simple research
- `openai/gpt-4.1`
- `workers-ai/@cf/meta/llama-4-scout-17b-16e-instruct` — free, but flakier tool use

## How the Think primitive helps

`Think` gives us, for free:

- A virtual filesystem (`this.workspace`) backed by SQLite + R2 — survives hibernation
- Workspace tools (`read`, `write`, `edit`, `list`, `find`, `grep`, `delete`) the model can call
- Automatic tool merging — workspace + `getTools()` + session + MCP, no manual wiring
- Resumable streaming — refresh the browser mid-research, stream picks up where it left off
- Standard `useAgentChat` WebSocket protocol on the client

All we add is the research **system prompt**, two **web tools**, and the **file browser UI**.
