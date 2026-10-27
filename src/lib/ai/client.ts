// Meta models behind one door. Keys live only in .env (never in the repo).
// Without a key every caller gets null and the app falls back to rules or manual entry,
// so the whole product works before the credits arrive and the demo never depends on luck.

export type Provider = { name: string; baseUrl: string; apiKey: string; model: string };

const env = (key: string) => process.env[key]?.trim() || undefined;

function provider(name: string, keyVar: string, baseVar: string, baseDefault: string, modelVar: string, modelDefault: string): Provider | null {
  const apiKey = env(keyVar);
  if (!apiKey) return null;
  return { name, apiKey, baseUrl: (env(baseVar) ?? baseDefault).replace(/\/$/, ""), model: env(modelVar) ?? modelDefault };
}

export const providers = {
  /** Muse Spark Open (open weights) on Baseten: the inbox agent. */
  agent: () => provider("Muse Spark Open", "BASETEN_API_KEY", "BASETEN_BASE_URL", "https://inference.baseten.co/v1", "BASETEN_MODEL", "meta-models/muse-spark-open-1026"),
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

/** OpenAI-compatible chat completion. Throws on HTTP errors so callers can fall back. */
export async function chat(p: Provider, messages: ChatMessage[], options: { json?: boolean; maxTokens?: number; tools?: unknown[] } = {}) {
  const res = await fetch(`${p.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${p.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: p.model,
      messages,
      temperature: 0,
      max_tokens: options.maxTokens ?? 1200,
      ...(options.json ? { response_format: { type: "json_object" } } : {}),
      ...(options.tools ? { tools: options.tools, tool_choice: "auto" } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`${p.name} answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices: { message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[] };
  return data.choices[0].message;
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
