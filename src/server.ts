/**
 * Deep Research Worker — entry point.
 *
 * Durable Objects:
 *   - ResearchAgent — one per session. Think-based agent that runs the
 *                     deep-research workflow. All intermediate notes and
 *                     the final report land in this.workspace (SQLite + R2
 *                     virtual filesystem from @cloudflare/shell).
 *
 * Routes:
 *   - /agents/*                        → routeAgentRequest (WebSocket chat)
 *   - /api/agent/:name/files           → list files in the DO workspace
 *   - /api/agent/:name/files/:path...  → download / read one file
 *
 * Assets: Vite-built React SPA from ./dist/client via Workers Assets.
 */

import { Think } from "@cloudflare/think";
import { Workspace } from "@cloudflare/shell";
import { routeAgentRequest, callable } from "agents";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createWorkersAI } from "workers-ai-provider";
import type { LanguageModel, ToolSet } from "ai";

import { RESEARCH_SYSTEM_PROMPT } from "./prompts/research-prompt";
import { createWebSearchTool, createWebScrapeTool } from "./tools/web";

// ─────────────────────────────────────────────────────────────────────────────
// ResearchAgent — a Think agent with the deep-research workflow
// ─────────────────────────────────────────────────────────────────────────────

export class ResearchAgent extends Think<Cloudflare.Env> {
  /** R2-backed workspace — big scraped sources + long reports don't blow SQLite. */
  override workspace = new Workspace({
    sql: this.ctx.storage.sql,
    r2: this.env.R2,
    name: () => this.name ?? "research",
  });

  override getModel(): LanguageModel {
    const modelName =
      this.env.RESEARCH_MODEL ?? "anthropic/claude-sonnet-4-5";
    const slash = modelName.indexOf("/");
    const provider = slash === -1 ? "anthropic" : modelName.slice(0, slash);
    const id = slash === -1 ? modelName : modelName.slice(slash + 1);

    switch (provider) {
      case "anthropic":
        if (this.env.ANTHROPIC_API_KEY) {
          return createAnthropic({ apiKey: this.env.ANTHROPIC_API_KEY })(id);
        }
        break;
      case "openai":
        if (this.env.OPENAI_API_KEY) {
          return createOpenAI({ apiKey: this.env.OPENAI_API_KEY })(id);
        }
        break;
      case "workers-ai":
        return createWorkersAI({ binding: this.env.AI })(id) as LanguageModel;
    }

    // Fallback — always available on Cloudflare
    return createWorkersAI({ binding: this.env.AI })(
      "@cf/meta/llama-4-scout-17b-16e-instruct",
    ) as LanguageModel;
  }

  override getSystemPrompt(): string {
    return RESEARCH_SYSTEM_PROMPT;
  }

  override getTools(): ToolSet {
    return {
      web_search: createWebSearchTool(this.env),
      web_scrape: createWebScrapeTool(this.env),
    };
  }

  // ── RPC exposed to the UI for the file browser ────────────────────────────

  @callable({ description: "List all files in the research workspace" })
  async listFiles(): Promise<Array<{ path: string; size: number }>> {
    const paths = await this.workspace._getAllPaths();
    const files: Array<{ path: string; size: number }> = [];
    for (const path of paths) {
      const info = await this.workspace.stat(path);
      if (info && info.type === "file") {
        files.push({ path, size: info.size ?? 0 });
      }
    }
    return files;
  }

  @callable({ description: "Read one file from the research workspace" })
  async readFile(path: string): Promise<{ path: string; content: string }> {
    const content = (await this.workspace.readFile(path)) ?? "";
    return { path, content };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker fetch — routes WebSocket + file API + static assets
// ─────────────────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const url = new URL(request.url);

    // ── File API ─────────────────────────────────────────────────────────
    if (url.pathname.startsWith("/api/agent/")) {
      const parts = url.pathname.split("/").filter(Boolean);
      // /api/agent/:name/files            → list
      // /api/agent/:name/files/:path...   → read/download
      if (parts.length >= 3 && parts[2] === "files") {
        const name = parts[1];
        const id = env.ResearchAgent.idFromName(name);
        const stub = env.ResearchAgent.get(id) as unknown as {
          listFiles(): Promise<Array<{ path: string; size: number }>>;
          readFile(path: string): Promise<{ path: string; content: string }>;
        };

        if (parts.length === 3) {
          const files = await stub.listFiles();
          return Response.json({ files });
        }

        const path = "/" + parts.slice(3).join("/");
        const { content } = await stub.readFile(path);
        const filename = path.split("/").pop() ?? "file";
        const download = url.searchParams.get("download") === "1";

        return new Response(content, {
          headers: {
            "Content-Type": filename.endsWith(".md")
              ? "text/markdown; charset=utf-8"
              : "text/plain; charset=utf-8",
            ...(download
              ? { "Content-Disposition": `attachment; filename="${filename}"` }
              : {}),
          },
        });
      }
    }

    // ── Agents WebSocket + chat protocol ─────────────────────────────────
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    // ── Static assets fall through to Workers Assets ─────────────────────
    return new Response("Not found", { status: 404 });
  },
};
