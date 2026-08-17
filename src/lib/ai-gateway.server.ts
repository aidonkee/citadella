import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

const LOVABLE_AIG_RUN_ID_HEADER = "X-Lovable-AIG-Run-ID";

/**
 * Creates an AI provider.
 * - If apiKey is a Gemini key (starts with "AIzaSy" or "AQ." — Google's new key format),
 *   uses @ai-sdk/google directly.
 * - Otherwise, routes through the Lovable AI Gateway (OpenAI-compatible).
 */
export function createLovableAiGatewayProvider(apiKey: string, initialRunId?: string) {
  // Detect Gemini API key — use native Google provider directly
  if (apiKey.startsWith("AIzaSy") || apiKey.startsWith("AQ.")) {
    const google = createGoogleGenerativeAI({ apiKey });

    // Wrap in a compatible interface that accepts "google/model-name" or just "model-name"
    const provider = (modelId: string) => {
      // Strip "google/" prefix if present (e.g. "google/gemini-3-flash-preview" → "gemini-3-flash-preview")
      const cleanId = modelId.startsWith("google/") ? modelId.slice(7) : modelId;
      return google(cleanId);
    };

    return Object.assign(provider, {
      getRunId: () => undefined as string | undefined,
      waitForRunId: () => Promise.resolve(undefined as string | undefined),
    });
  }

  // --- Lovable AI Gateway (OpenAI-compatible) ---
  let runId = initialRunId?.trim() || undefined;
  let resolveRunId: (value: string | undefined) => void = () => {};
  let runIdResolved = false;
  const runIdReady = new Promise<string | undefined>((resolve) => {
    resolveRunId = resolve;
  });

  const publishRunId = (value?: string) => {
    const nextRunId = value?.trim() || undefined;
    if (!runId && nextRunId) runId = nextRunId;
    if (!runIdResolved) {
      runIdResolved = true;
      resolveRunId(runId);
    }
  };
  if (runId) publishRunId(runId);

  const provider = createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: {
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      if (runId && !headers.has(LOVABLE_AIG_RUN_ID_HEADER)) {
        headers.set(LOVABLE_AIG_RUN_ID_HEADER, runId);
      }
      try {
        const response = await fetch(input, { ...init, headers });
        publishRunId(response.headers.get(LOVABLE_AIG_RUN_ID_HEADER) ?? undefined);
        return response;
      } catch (error) {
        publishRunId(undefined);
        throw error;
      }
    },
  });

  return Object.assign(provider, {
    getRunId: () => runId,
    waitForRunId: () => (runId ? Promise.resolve(runId) : runIdReady),
  });
}
