// Provider adapters, exercised through their real SDKs against a local mock server that
// speaks each provider's wire format (LLM_BASE_URL points every SDK at it). Verifies the
// requests we send (web search tool, image, schema) and that replies parse into drafts.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { llmConfig, readLabelWithVision, researchCandidates, parseJsonLoose, lookupBagOnline } from "../dist/server/llm.js";

const LABEL = { name: "Southern Weather", roaster: "Onyx Coffee Lab", origin: "Colombia", processMethod: "Washed", roastLevel: "Medium", roastDate: "2026-11-10", amountG: 340 };
const cand = (o) => ({ kind: "pick", name: "Hambela", roaster: "Onyx", origin: "Ethiopia", processMethod: "Washed", tastingNotes: "jasmine, peach", roastLevel: "Light", priceAmount: 24, priceText: "$24 / 12 oz", url: "https://onyx.example/hambela", whyFit: "w", brewTip: "b", funkRisk: "Low", ...o });
const RESEARCH = { weekLabel: "Week of Nov 23, 2026", seasonNote: "Holiday releases.", candidates: [cand({}), cand({ kind: "wildcard", name: "Gesha" })] };
const IMG = Buffer.from("fake-png-bytes");
const LOOKUP = { found: true, url: "https://roaster.example/products/hillside", name: "Hillside", roaster: "Sample Roasters", origin: "Ethiopia", processMethod: "Natural", roastLevel: "Light", tastingNotes: "blueberry, jasmine", details: "Guji; 74110", amountG: 340, price: 22 };
const LOOK_IN = { name: "Hillside", roaster: "Sample Roasters" };
const INPUT = { weekLabel: "Week of Nov 23, 2026", palate: "clean naturals", tried: ["A (B)"], avoid: [], stash: [], previous: [] };

let server, base;
const seen = [];

function anthropicSSE(res, text) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: "m", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
  ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
  ev("content_block_delta", { index: 0, delta: { type: "text_delta", text } });
  ev("content_block_stop", { index: 0 });
  ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } });
  ev("message_stop", {});
  res.end();
}

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = body ? JSON.parse(body) : {};
      seen.push({ url: req.url, headers: req.headers, body: json });
      const send = (o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
      const isResearch = JSON.stringify(json).includes("Research this week");
      const isLookup = JSON.stringify(json).includes("A coffee bag's label says");
      const payload = JSON.stringify(isResearch ? RESEARCH : isLookup ? LOOKUP : LABEL);
      if (req.url.startsWith("/v1/messages")) {
        if (json.stream) return anthropicSSE(res, payload);
        return send({ id: "msg_1", type: "message", role: "assistant", model: json.model, content: [{ type: "text", text: payload }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
      }
      if (req.url.startsWith("/v1/responses")) {
        return send({ id: "resp_1", object: "response", created_at: 0, status: "completed", model: json.model, error: null, incomplete_details: null, instructions: null, metadata: {}, parallel_tool_calls: true, temperature: null, top_p: null, tool_choice: "auto", tools: json.tools ?? [],
          output: [{ type: "message", id: "m1", status: "completed", role: "assistant", content: [{ type: "output_text", text: payload, annotations: [] }] }] });
      }
      if (req.url.includes(":generateContent")) {
        // Gemini: research reply deliberately wrapped in a ```json fence to exercise the lenient parser.
        const text = isResearch ? "```json\n" + payload + "\n```" : payload;
        return send({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] });
      }
      if (req.url.startsWith("/v1/chat/completions")) {
        return send({ id: "c1", object: "chat.completion", created: 0, model: json.model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Here you go:\n" + payload } }] });
      }
      res.writeHead(404); res.end("{}");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const setEnv = (o) => {
  for (const k of ["LLM_PROVIDER", "LLM_API_KEY", "LLM_MODEL", "LLM_BASE_URL"]) delete process.env[k];
  Object.assign(process.env, o);
};
const last = (pred) => [...seen].reverse().find(pred);

test("config: defaults, required model, unknown provider, openai-compatible", () => {
  assert.equal(llmConfig({}).enabled, false);
  assert.equal(llmConfig({}).problem, null);
  const a = llmConfig({ LLM_API_KEY: "k" });
  assert.deepEqual([a.provider, a.model, a.enabled, a.researchSupported], ["anthropic", "claude-opus-5-5", true, true]);
  assert.match(llmConfig({ LLM_PROVIDER: "openai", LLM_API_KEY: "k" }).problem, /needs LLM_MODEL/);
  assert.equal(llmConfig({ LLM_PROVIDER: "openai", LLM_API_KEY: "k" }).enabled, false);
  assert.match(llmConfig({ LLM_PROVIDER: "mistral", LLM_API_KEY: "k" }).problem, /Unknown LLM_PROVIDER/);
  assert.match(llmConfig({ LLM_PROVIDER: "openai-compatible", LLM_MODEL: "llava" }).problem, /needs LLM_BASE_URL/);
  const oc = llmConfig({ LLM_PROVIDER: "openai-compatible", LLM_MODEL: "llava", LLM_BASE_URL: "http://x/v1" });
  assert.deepEqual([oc.enabled, oc.researchSupported], [true, false]); // no key needed, no web search
});

test("parseJsonLoose tolerates fences and prose", () => {
  assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('Sure! {"a":1} hope that helps'), { a: 1 });
  assert.throws(() => parseJsonLoose("no json here"));
});

test("anthropic: label via structured output; research streams with web search + refusal fallback", async () => {
  setEnv({ LLM_API_KEY: "test", LLM_BASE_URL: base });
  assert.deepEqual(await readLabelWithVision(IMG, "image/png"), LABEL);
  const lab = last((r) => r.url.startsWith("/v1/messages") && !r.body.stream);
  assert.equal(lab.body.model, "claude-opus-5-5");
  assert.equal(lab.body.messages[0].content[0].source.data, IMG.toString("base64"));
  assert.equal(lab.body.output_config.format.type, "json_schema");
  assert.match(lab.headers["anthropic-beta"], /server-side-fallback-2026-07-01/);
  assert.equal(lab.body.fallbacks, "default");
  assert.deepEqual(await researchCandidates(INPUT), RESEARCH);
  const r = last((x) => x.url.startsWith("/v1/messages") && x.body.stream);
  assert.equal(r.body.tools[0].type, "web_search_20260209");
});

test("openai: Responses API with input_image, json_schema format, web_search tool", async () => {
  setEnv({ LLM_PROVIDER: "openai", LLM_API_KEY: "test", LLM_MODEL: "gpt-test", LLM_BASE_URL: `${base}/v1` });
  assert.deepEqual(await readLabelWithVision(IMG, "image/jpeg"), LABEL);
  const lab = last((r) => r.url.startsWith("/v1/responses"));
  assert.equal(lab.body.model, "gpt-test");
  assert.equal(lab.body.input[0].content[1].type, "input_image");
  assert.equal(lab.body.input[0].content[1].image_url, `data:image/jpeg;base64,${IMG.toString("base64")}`);
  assert.equal(lab.body.text.format.type, "json_schema");
  assert.deepEqual(await researchCandidates(INPUT), RESEARCH);
  const r = last((x) => x.url.startsWith("/v1/responses"));
  assert.deepEqual(r.body.tools, [{ type: "web_search" }]);
});

test("gemini: inlineData image + JSON schema; research with Google Search grounding", async () => {
  setEnv({ LLM_PROVIDER: "gemini", LLM_API_KEY: "test", LLM_MODEL: "gemini-test", LLM_BASE_URL: base });
  assert.deepEqual(await readLabelWithVision(IMG, "image/png"), LABEL);
  const lab = last((r) => r.url.includes("gemini-test:generateContent"));
  assert.equal(lab.body.contents[0].parts[0].inlineData.data, IMG.toString("base64"));
  assert.equal(lab.body.generationConfig.responseMimeType, "application/json");
  assert.ok(lab.body.generationConfig.responseJsonSchema);
  assert.deepEqual(await researchCandidates(INPUT), RESEARCH);
  const r = last((x) => x.url.includes(":generateContent"));
  assert.deepEqual(r.body.tools, [{ googleSearch: {} }]);
});

test("openai-compatible: chat completions with image_url; research refuses (no web search)", async () => {
  setEnv({ LLM_PROVIDER: "openai-compatible", LLM_MODEL: "llava", LLM_BASE_URL: `${base}/v1` });
  assert.deepEqual(await readLabelWithVision(IMG, "image/png"), LABEL);
  const lab = last((r) => r.url.startsWith("/v1/chat/completions"));
  assert.equal(lab.body.messages[0].content[1].image_url.url, `data:image/png;base64,${IMG.toString("base64")}`);
  await assert.rejects(researchCandidates(INPUT), /no built-in web search/);
});

test("disabled: calls fail clearly rather than half-working", async () => {
  setEnv({ LLM_PROVIDER: "gemini", LLM_API_KEY: "k" }); // missing model
  await assert.rejects(readLabelWithVision(IMG, "image/png"), /needs LLM_MODEL/);
});

test("bag lookup: web search with structured output on every provider that has search", async () => {
  setEnv({ LLM_API_KEY: "test", LLM_BASE_URL: base });
  assert.deepEqual(await lookupBagOnline(LOOK_IN), LOOKUP);
  const a = last((x) => x.url.startsWith("/v1/messages") && x.body.stream);
  assert.deepEqual([a.body.tools[0].type, a.body.tools[0].max_uses, a.body.output_config.effort], ["web_search_20260209", 6, "medium"]);
  assert.match(a.body.messages[0].content, /roaster's own website/);
  assert.match(a.body.messages[0].content, /- name: Hillside/);

  setEnv({ LLM_PROVIDER: "openai", LLM_API_KEY: "test", LLM_MODEL: "gpt-test", LLM_BASE_URL: `${base}/v1` });
  assert.deepEqual(await lookupBagOnline(LOOK_IN), LOOKUP);
  const o = last((x) => x.url.startsWith("/v1/responses"));
  assert.deepEqual(o.body.tools, [{ type: "web_search" }]);
  assert.equal(o.body.text.format.name, "coffee_lookup");

  setEnv({ LLM_PROVIDER: "gemini", LLM_API_KEY: "test", LLM_MODEL: "gemini-test", LLM_BASE_URL: base });
  assert.deepEqual(await lookupBagOnline(LOOK_IN), LOOKUP);
  assert.deepEqual(last((x) => x.url.includes(":generateContent")).body.tools, [{ googleSearch: {} }]);

  setEnv({ LLM_PROVIDER: "openai-compatible", LLM_MODEL: "llava", LLM_BASE_URL: `${base}/v1` });
  await assert.rejects(lookupBagOnline(LOOK_IN), /can't be looked up online/);
});
