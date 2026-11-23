// Optional LLM features: bag-label vision and weekly research.
// Provider-agnostic: LLM_PROVIDER picks an adapter; everything is gated on llmEnabled()
// and callers fall back (Tesseract / manual candidates) when it is false.
//
//   LLM_PROVIDER = anthropic (default) | openai | gemini | openai-compatible
//   LLM_API_KEY  = provider key (optional for openai-compatible, e.g. Ollama)
//   LLM_MODEL    = model id (required except for anthropic, which defaults to claude-opus-5-5)
//   LLM_BASE_URL = override the API endpoint (required for openai-compatible)
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { readSecrets } from "./secrets.js";

export const PROVIDERS = ["anthropic", "openai", "gemini", "openai-compatible"] as const;
export type Provider = (typeof PROVIDERS)[number];

export interface LlmConfig {
  /** Where the settings came from: environment variables win when they carry a key / base URL. */
  source: "environment" | "app" | "none";
  provider: Provider;
  model: string | null;
  baseUrl: string | null;
  enabled: boolean;
  /** Weekly research needs a provider-side web search tool. */
  researchSupported: boolean;
  problem: string | null;
}

/** Environment variables (they win when LLM_API_KEY or LLM_BASE_URL is set — compose always sets
    LLM_PROVIDER), else the credentials saved in the app, else nothing. */
export function effectiveEnv(env: NodeJS.ProcessEnv = process.env): { env: NodeJS.ProcessEnv; source: LlmConfig["source"] } {
  if (env.LLM_API_KEY?.trim() || env.LLM_BASE_URL?.trim()) return { env, source: "environment" };
  const s = readSecrets();
  if (s) return { env: { ...env, LLM_PROVIDER: s.provider, LLM_API_KEY: s.apiKey ?? "", LLM_MODEL: s.model ?? "", LLM_BASE_URL: s.baseUrl ?? "" }, source: "app" };
  return { env, source: "none" };
}
const apiKey = () => effectiveEnv().env.LLM_API_KEY?.trim() || undefined;

export function llmConfig(envIn?: NodeJS.ProcessEnv): LlmConfig {
  const { env, source } = envIn ? { env: envIn, source: "environment" as const } : effectiveEnv();
  const raw = (env.LLM_PROVIDER || "anthropic").trim().toLowerCase();
  const key = env.LLM_API_KEY?.trim() || "";
  const baseUrl = env.LLM_BASE_URL?.trim() || null;
  if (!(PROVIDERS as readonly string[]).includes(raw)) {
    return { source, provider: "anthropic", model: null, baseUrl, enabled: false, researchSupported: false,
      problem: `Unknown LLM_PROVIDER "${raw}" — use one of: ${PROVIDERS.join(", ")}.` };
  }
  const provider = raw as Provider;
  const model = env.LLM_MODEL?.trim() || (provider === "anthropic" ? "claude-opus-5-5" : null);
  let problem: string | null = null;
  if (provider === "openai-compatible") {
    if (!baseUrl) problem = "LLM_PROVIDER=openai-compatible needs LLM_BASE_URL (e.g. http://ollama:11434/v1).";
    else if (!model) problem = "LLM_PROVIDER=openai-compatible needs LLM_MODEL.";
  } else if (!key) {
    problem = null; // simply not configured — the normal no-key mode
  } else if (!model) {
    problem = `LLM_PROVIDER=${provider} needs LLM_MODEL (e.g. a current ${provider === "openai" ? "GPT" : "Gemini"} model id).`;
  }
  const enabled = !problem && (provider === "openai-compatible" ? true : Boolean(key));
  return { source: enabled || problem ? source : "none", provider, model, baseUrl, enabled, researchSupported: enabled && provider !== "openai-compatible", problem };
}

export const llmEnabled = () => llmConfig().enabled;
export const researchSupported = () => llmConfig().researchSupported;

/* ------------------------------ shared prompts & schemas ------------------------------ */

const LabelDraft = z.object({
  name: z.string().describe("Coffee / bean name as printed, or empty string"),
  roaster: z.string(),
  origin: z.string(),
  processMethod: z.string(),
  roastLevel: z.string(),
  roastDate: z.string().describe("YYYY-MM-DD if a roast date is printed, else empty"),
  amountG: z.number().nullable().describe("Bag size in grams if printed (convert oz to g), else null"),
});
export type LabelDraftT = z.infer<typeof LabelDraft>;

const LABEL_PROMPT =
  "This is a photo of a coffee bag label. Read only what is actually printed on it. " +
  "Return the coffee name, roaster, origin, process, roast level, roast date and bag size. " +
  "Leave any field empty (or null) if it is not printed or not legible — never guess.";

const Candidate = z.object({
  kind: z.enum(["pick", "wildcard"]),
  name: z.string(),
  roaster: z.string(),
  origin: z.string(),
  processMethod: z.string(),
  tastingNotes: z.string(),
  roastLevel: z.string(),
  priceAmount: z.number().nullable(),
  priceText: z.string(),
  url: z.string(),
  whyFit: z.string(),
  brewTip: z.string(),
  funkRisk: z.string(),
});
const ResearchOut = z.object({ weekLabel: z.string(), seasonNote: z.string(), candidates: z.array(Candidate) });
export type ResearchOutT = z.infer<typeof ResearchOut>;

export interface ResearchInput {
  weekLabel: string;
  palate: string;
  tried: string[];
  avoid: string[];
  stash: string[];
  previous: string[];
}

export function researchPrompt(o: ResearchInput): string {
  return [
    `Research this week's coffee board (${o.weekLabel}).`,
    "Use web search. Check roasters' OWN product pages for current seasonal offerings. Verify price, availability, processing and tasting notes from the roaster's page — never from a roundup or stale listing.",
    "In whyFit, distinguish verified roaster information from your prediction of how it will taste.",
    "Return 6–8 candidates: mostly ranked picks plus at least one wildcard that stretches the palate without being excessively funky.",
    "Favour complementary profiles over near-identical ones and new coffees over repeats.",
    "",
    "About this drinker (their taste summary, built from their own ratings and settings):",
    o.palate,
    "",
    `Already tried (do not include): ${o.tried.join("; ") || "none"}`,
    `Avoid list (do not include): ${o.avoid.join("; ") || "none"}`,
    `Already in the stash (do not include): ${o.stash.join("; ") || "none"}`,
    `On last week's board (prefer new coffees): ${o.previous.join("; ") || "none"}`,
    "",
    "brewTip must be a concrete starting recipe (grinder, ratio, temperature). funkRisk is low / low–moderate / moderate / high with a one-line reason.",
    'priceAmount is a USD number, or null if the price isn\'t in USD; priceText is the price as listed (e.g. "$23 / 12 oz").',
    "seasonNote: one or two sentences on what is happening in coffee this week.",
  ].join("\n");
}

/** For providers where we ask for JSON in the prompt rather than via a native schema option. */
const jsonInstruction = (schema: z.ZodType) =>
  `\n\nRespond with ONLY a JSON object (no prose, no markdown) matching this JSON Schema:\n${JSON.stringify(z.toJSONSchema(schema))}`;

/** Parse a model's JSON reply, tolerating ```json fences or prose around the object. */
export function parseJsonLoose(text: string | null | undefined): unknown {
  if (!text) throw new Error("The model returned an empty reply.");
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* fall through */
    }
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
  throw new Error("The model's reply wasn't valid JSON.");
}

function validated<T>(schema: z.ZodType<T>, data: unknown, what: string): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new Error(`${what} didn't match the expected shape: ${r.error.issues[0]?.message ?? "invalid"}`);
  return r.data;
}

/* ------------------------------ adapters ------------------------------ */

interface Adapter {
  readLabel(image: Buffer, mediaType: "image/jpeg" | "image/png"): Promise<LabelDraftT>;
  research(o: ResearchInput): Promise<ResearchOutT>;
  /** Smallest possible call, for More → Settings → AI provider → Test. */
  ping(): Promise<string>;
}
const PING = "Reply with the single word OK.";

const TIMEOUT_MS = 10 * 60 * 1000;

function anthropicAdapter(c: LlmConfig): Adapter {
  const client = new Anthropic({ apiKey: apiKey(), baseURL: c.baseUrl ?? undefined, timeout: TIMEOUT_MS });
  // Server-side refusal fallback: on a policy decline the API re-runs the request on a fallback model.
  const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };
  return {
    async readLabel(image, mediaType) {
      const res = await client.beta.messages.parse({
        ...FALLBACK,
        model: c.model!,
        max_tokens: 4000,
        output_config: { effort: "low", format: betaZodOutputFormat(LabelDraft) },
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: image.toString("base64") } },
          { type: "text", text: LABEL_PROMPT },
        ] }],
      });
      if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error("The model could not read this label.");
      return res.parsed_output;
    },
    async research(o) {
      const params = {
        ...FALLBACK,
        model: c.model!,
        max_tokens: 32000,
        output_config: { effort: "high" as const, format: betaZodOutputFormat(ResearchOut) },
        tools: [{ type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 20 }],
        messages: [{ role: "user" as const, content: researchPrompt(o) }] as Anthropic.Beta.BetaMessageParam[],
      };
      // Server-tool turns can pause; resume until the model finishes.
      for (let i = 0; i < 5; i++) {
        const msg = await client.beta.messages.stream(params).finalMessage();
        if (msg.stop_reason === "pause_turn") {
          params.messages = [...params.messages, { role: "assistant", content: msg.content }];
          continue;
        }
        if (msg.stop_reason === "refusal") throw new Error("The research request was declined by the model.");
        const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
        return validated(ResearchOut, parseJsonLoose(text), "Research output");
      }
      throw new Error("Research did not finish after several resumes.");
    },
    async ping() {
      const msg = await client.messages.create({ model: c.model!, max_tokens: 16, messages: [{ role: "user", content: PING }] });
      return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    },
  };
}

function openaiAdapter(c: LlmConfig): Adapter {
  const client = new OpenAI({ apiKey: apiKey(), baseURL: c.baseUrl ?? undefined, timeout: TIMEOUT_MS });
  return {
    async readLabel(image, mediaType) {
      const res = await client.responses.parse({
        model: c.model!,
        input: [{ role: "user", content: [
          { type: "input_text", text: LABEL_PROMPT },
          { type: "input_image", image_url: `data:${mediaType};base64,${image.toString("base64")}`, detail: "auto" },
        ] }],
        text: { format: zodTextFormat(LabelDraft, "bag_label") },
      });
      if (!res.output_parsed) throw new Error("The model could not read this label.");
      return res.output_parsed;
    },
    async research(o) {
      const res = await client.responses.parse({
        model: c.model!,
        tools: [{ type: "web_search" }],
        input: researchPrompt(o),
        text: { format: zodTextFormat(ResearchOut, "coffee_research") },
      });
      if (!res.output_parsed) throw new Error("Research output was empty or declined.");
      return validated(ResearchOut, res.output_parsed, "Research output");
    },
    async ping() {
      const res = await client.responses.create({ model: c.model!, input: PING, max_output_tokens: 16 });
      return (res.output_text ?? "").trim();
    },
  };
}

function geminiAdapter(c: LlmConfig): Adapter {
  const ai = new GoogleGenAI({ apiKey: apiKey(), httpOptions: { ...(c.baseUrl ? { baseUrl: c.baseUrl } : {}), timeout: TIMEOUT_MS } });
  return {
    async readLabel(image, mediaType) {
      const res = await ai.models.generateContent({
        model: c.model!,
        contents: [{ role: "user", parts: [{ inlineData: { mimeType: mediaType, data: image.toString("base64") } }, { text: LABEL_PROMPT }] }],
        config: { responseMimeType: "application/json", responseJsonSchema: z.toJSONSchema(LabelDraft) },
      });
      return validated(LabelDraft, parseJsonLoose(res.text), "Label output");
    },
    async research(o) {
      // Google Search grounding + JSON requested in the prompt (not every model accepts
      // grounding together with a response schema), validated with zod.
      const res = await ai.models.generateContent({
        model: c.model!,
        contents: researchPrompt(o) + jsonInstruction(ResearchOut),
        config: { tools: [{ googleSearch: {} }] },
      });
      return validated(ResearchOut, parseJsonLoose(res.text), "Research output");
    },
    async ping() {
      const res = await ai.models.generateContent({ model: c.model!, contents: PING });
      return (res.text ?? "").trim();
    },
  };
}

function openaiCompatibleAdapter(c: LlmConfig): Adapter {
  // Ollama, LM Studio, OpenRouter, vLLM… — Chat Completions with JSON requested in the prompt.
  const client = new OpenAI({ apiKey: apiKey() || "not-needed", baseURL: c.baseUrl!, timeout: TIMEOUT_MS });
  return {
    async readLabel(image, mediaType) {
      const res = await client.chat.completions.create({
        model: c.model!,
        messages: [{ role: "user", content: [
          { type: "text", text: LABEL_PROMPT + jsonInstruction(LabelDraft) },
          { type: "image_url", image_url: { url: `data:${mediaType};base64,${image.toString("base64")}` } },
        ] }],
      });
      return validated(LabelDraft, parseJsonLoose(res.choices[0]?.message?.content), "Label output");
    },
    async research() {
      throw new Error("openai-compatible endpoints have no built-in web search, so weekly research stays manual.");
    },
    async ping() {
      const res = await client.chat.completions.create({ model: c.model!, max_tokens: 16, messages: [{ role: "user", content: PING }] });
      return (res.choices[0]?.message?.content ?? "").trim();
    },
  };
}

let cached: { key: string; adapter: Adapter } | null = null;
function adapter(): Adapter {
  const c = llmConfig();
  if (!c.enabled) throw new Error(c.problem || "No LLM is configured.");
  const key = JSON.stringify([c, apiKey()]);
  if (cached?.key === key) return cached.adapter;
  const a =
    c.provider === "openai" ? openaiAdapter(c)
    : c.provider === "gemini" ? geminiAdapter(c)
    : c.provider === "openai-compatible" ? openaiCompatibleAdapter(c)
    : anthropicAdapter(c);
  cached = { key, adapter: a };
  return a;
}

// async so configuration errors surface as rejected promises, never synchronous throws.
export const readLabelWithVision = async (image: Buffer, mediaType: "image/jpeg" | "image/png") => adapter().readLabel(image, mediaType);
export const researchCandidates = async (o: ResearchInput) => adapter().research(o);
export const pingLlm = async () => adapter().ping();
