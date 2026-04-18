/**
 * Augment Cloudflare.Env with secrets + vars that wrangler can't infer
 * until they're actually set. All optional — handlers check at runtime.
 */
declare global {
  namespace Cloudflare {
    interface Env {
      ANTHROPIC_API_KEY?: string;
      OPENAI_API_KEY?: string;
      BRIGHTDATA_API_KEY?: string;
      RESEARCH_MODEL?: string;
      BRIGHTDATA_ZONE?: string;
      BRIGHTDATA_SERP_ZONE?: string;
    }
  }
}

export {};
