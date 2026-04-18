/**
 * Web research tools — web_search (Google SERP) + web_scrape (Web Unlocker).
 *
 * Both go through the Bright Data API. If BRIGHTDATA_API_KEY is unset, the
 * scraper falls back to plain fetch() so local demos work on public sites.
 */

import { tool } from "ai";
import { z } from "zod";

interface BrightDataEnv {
  BRIGHTDATA_API_KEY?: string;
  BRIGHTDATA_ZONE?: string;
  BRIGHTDATA_SERP_ZONE?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// web_search
// ─────────────────────────────────────────────────────────────────────────────

export function createWebSearchTool(env: BrightDataEnv) {
  return tool({
    description:
      "Search the web (Google). Returns a ranked list of {title, url, snippet}. Use 2–3 varied phrasings per sub-question.",
    inputSchema: z.object({
      query: z.string().describe("Search query"),
      num_results: z.number().int().min(1).max(20).default(10),
    }),
    execute: async ({ query, num_results }) => {
      if (!env.BRIGHTDATA_API_KEY) {
        return {
          error:
            "BRIGHTDATA_API_KEY not set. Run `wrangler secret put BRIGHTDATA_API_KEY`.",
          results: [],
        };
      }

      const serpUrl = `https://www.google.com/search?q=${encodeURIComponent(
        query,
      )}&num=${num_results}&brd_json=1`;

      try {
        const res = await fetch("https://api.brightdata.com/request", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.BRIGHTDATA_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: serpUrl,
            zone: env.BRIGHTDATA_SERP_ZONE ?? "serp_api1",
            format: "raw",
          }),
        });

        if (!res.ok) {
          return {
            error: `SERP failed: ${res.status} ${res.statusText}`,
            results: [],
          };
        }

        const data = (await res.json()) as {
          organic?: Array<{
            title?: string;
            link?: string;
            description?: string;
          }>;
        };

        const results = (data.organic ?? []).slice(0, num_results).map((r) => ({
          title: r.title ?? "",
          url: r.link ?? "",
          snippet: (r.description ?? "").slice(0, 300),
        }));

        return { query, count: results.length, results };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : String(err),
          results: [],
        };
      }
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// web_scrape
// ─────────────────────────────────────────────────────────────────────────────

export function createWebScrapeTool(env: BrightDataEnv) {
  return tool({
    description:
      "Fetch a URL and return clean markdown. Use on the 5–15 best URLs from web_search. Bypasses basic bot protection via Bright Data Web Unlocker.",
    inputSchema: z.object({
      url: z.string().url(),
      max_chars: z
        .number()
        .int()
        .min(1000)
        .max(100_000)
        .default(20_000)
        .describe("Truncate the markdown output to this many chars."),
    }),
    execute: async ({ url, max_chars }) => {
      if (!env.BRIGHTDATA_API_KEY) {
        try {
          const res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (research-agent)" },
          });
          const text = await res.text();
          return {
            url,
            status: res.status,
            content: text.slice(0, max_chars),
            fallback: true,
          };
        } catch (err) {
          return {
            url,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }

      try {
        const res = await fetch("https://api.brightdata.com/request", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.BRIGHTDATA_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url,
            zone: env.BRIGHTDATA_ZONE ?? "web_unlocker1",
            format: "raw",
            data_format: "markdown",
          }),
        });

        if (!res.ok) {
          return {
            url,
            error: `Scrape failed: ${res.status} ${res.statusText}`,
          };
        }

        const md = await res.text();
        return {
          url,
          status: res.status,
          content: md.slice(0, max_chars),
          truncated: md.length > max_chars,
        };
      } catch (err) {
        return {
          url,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });
}
