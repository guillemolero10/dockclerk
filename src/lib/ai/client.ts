// Meta models behind one door. Keys live only in .env (never in the repo).
// Without a key every caller gets null and the app falls back to rules or manual entry,
// so the whole product works before the credits arrive and the demo never depends on luck.
// Models with a known price also stop for the day at AI_DAILY_BUDGET_USD (see budget.ts).

import { assertBudget, recordSpend } from "./budget";

export type Provider = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Reasoning models think before they answer and that thinking counts as output. Set the effort to keep it short. */
  reasoning?: "low";
  /** USD per million tokens, to log what each call costs. */
  price?: { input: number; output: number };
};

const env = (key: string) => process.env[key]?.trim() || undefined;

function provider(name: string, keyVar: string, baseVar: string, baseDefault: string, modelVar: string, modelDefault: string, extra: Partial<Provider> = {}): Provider | null {
  const apiKey = env(keyVar);
  if (!apiKey) return null;
  return { name, apiKey, baseUrl: (env(baseVar) ?? baseDefault).replace(/\/$/, ""), model: env(modelVar) ?? modelDefault, ...extra };
}

export const providers = {
  /**
   * Muse Spark Open (open weights) on Baseten: the inbox agent and the analyst's voice.
   * Base URL and model id checked against GET /v1/models of the hackathon account on 28/10/2026
   * ("[HACKATHON] Muse Spark Open"; the plain `meta-models/muse-spark-open` is the same weights).
   * It always reasons (cannot be switched off), so `reasoning: "low"` plus room in max_tokens.
   * $1.25 / $4.25 per million tokens in / out.
   */
  agent: () => provider("Muse Spark Open", "BASETEN_API_KEY", "BASETEN_BASE_URL", "https://inference.baseten.co/v1", "BASETEN_MODEL", "meta-models/muse-spark-open-1026", { reasoning: "low", price: { input: 1.25, output: 4.25 } }),
  /** Muse Spark on the Meta Model API: reads photos (delivery notes, loads). */
  vision: () => provider("Muse Spark", "META_API_KEY", "META_API_BASE_URL", "https://api.llama.com/compat/v1", "META_VISION_MODEL", "muse-spark"),
  /** SAM 3.1 on the Meta Model API: finds every box in a photo of the load. */
  segment: () => provider("SAM 3.1", "META_API_KEY", "META_SAM_URL", "https://api.llama.com/v1/sam", "META_SAM_MODEL", "sam-3.1"),
  /** Muse Voice Transcribe on the Meta Model API: voice notes from the floor. */
  voice: () => provider("Muse Voice Transcribe", "META_API_KEY", "META_API_BASE_URL", "https://api.llama.com/compat/v1", "META_VOICE_MODEL", "muse-voice-transcribe"),
};

/** Which models are live, for the badges in the UI. */
export function aiStatus() {
  return {
    agent: providers.agent()?.name ?? null,
    vision: providers.vision()?.name ?? null,
    segment: providers.segment()?.name ?? null,
    voice: providers.voice()?.name ?? null,
  };
}

type Content = string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];
export type ChatMessage = { role: "system" | "user" | "assistant" | "tool"; content: Content; tool_call_id?: string; tool_calls?: unknown };

/** Tokens a reasoning model may spend thinking, on top of the answer. "Low" effort is not a hard cap: 25 to 800 seen. */
const REASONING_ROOM = 3000;
const RETRY_ON = new Set([429, 502, 503, 504, 529]);

export type Usage = { prompt: number; completion: number; reasoning: number; cached: number; costUsd: number };

/** Running total since the server started (also logged per call), so cost per message is easy to read. */
export const spend = { calls: 0, prompt: 0, completion: 0, reasoning: 0, costUsd: 0 };
type Reply = { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] };

/**
 * OpenAI-compatible chat completion. Throws on HTTP errors, timeouts and empty answers so callers can fall back.
 * Also throws DailyBudgetError once today's spend on priced models reaches AI_DAILY_BUDGET_USD.
 * Retries once (after a short wait) on 429 and gateway errors if there is time left.
 */
export async function chat(p: Provider, messages: ChatMessage[], options: { json?: boolean; maxTokens?: number; tools?: unknown[]; timeoutMs?: number } = {}) {
  const timeoutMs = options.timeoutMs ?? 60_000;
  // Before anything leaves the server. Only models with a price are counted: for the others (Meta Model API) the cost is not known.
  if (p.price) await assertBudget();
  const started = Date.now();
  const body = JSON.stringify({
    model: p.model,
    messages,
    temperature: 0,
    max_tokens: (options.maxTokens ?? 1200) + (p.reasoning ? REASONING_ROOM : 0),
    ...(p.reasoning ? { reasoning_effort: p.reasoning } : {}),
    ...(options.json ? { response_format: { type: "json_object" } } : {}),
    ...(options.tools ? { tools: options.tools, tool_choice: "auto" } : {}),
  });

  let res: Response;
  for (let attempt = 0; ; attempt++) {
    const left = timeoutMs - (Date.now() - started);
    if (left < 1000) throw new Error(`${p.name} timed out after ${Math.round(timeoutMs / 1000)}s`);
    res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${p.apiKey}`, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(left),
    });
    if (res.ok || attempt >= 1 || !RETRY_ON.has(res.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!res.ok) throw new Error(`${p.name} answered ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const data = (await res.json()) as {
    choices: { message: Reply; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } };
  };
  const choice = data.choices?.[0];
  if (!choice?.message || (!choice.message.content && !choice.message.tool_calls?.length)) {
    throw new Error(`${p.name} returned no answer (finish: ${choice?.finish_reason ?? "none"}, probably spent all tokens reasoning)`);
  }
  const prompt = data.usage?.prompt_tokens ?? 0;
  const completion = data.usage?.completion_tokens ?? 0;
  const usage: Usage = {
    prompt,
    completion,
    reasoning: data.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    cached: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    costUsd: p.price ? (prompt * p.price.input + completion * p.price.output) / 1_000_000 : 0,
  };
  spend.calls++;
  spend.prompt += usage.prompt;
  spend.completion += usage.completion;
  spend.reasoning += usage.reasoning;
  spend.costUsd += usage.costUsd;
  if (p.price) await recordSpend({ costUsd: usage.costUsd, prompt: usage.prompt, completion: usage.completion });
  console.info(`[ai] ${p.name} ${((Date.now() - started) / 1000).toFixed(1)}s · ${usage.prompt} in + ${usage.completion} out (${usage.reasoning} reasoning) · $${usage.costUsd.toFixed(5)}`);
  return { ...choice.message, usage };
}

/** Models sometimes wrap JSON in fences or add a sentence; take the first object. */
export function parseJson<T>(text: string | null): T {
  if (!text) throw new Error("Empty answer");
  const cleaned = text.replace(/```(?:json)?/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

export const dataUrl = (image: { mime: string; base64: string }) => `data:${image.mime};base64,${image.base64}`;
