// AI provider (More → Settings, and the Discover step of first-run setup).
// The key is write-only: the server only ever says whether one is saved.
import { useEffect, useState } from "react";
import { api } from "./api";
import { useData, Field } from "./ui";

interface AiView {
  source: "environment" | "app" | "none";
  provider: string; model: string | null; baseUrl: string | null;
  enabled: boolean; researchSupported: boolean; problem: string | null;
  saved: { provider: string; model: string | null; baseUrl: string | null; hasKey: boolean } | null;
  envOverride: boolean;
}

const PROVIDERS = [
  { id: "anthropic", label: "Anthropic (Claude)", hint: "Model optional — defaults to claude-opus-5-5. Web search for weekly research: yes." },
  { id: "openai", label: "OpenAI", hint: "Enter a current model id. Web search for weekly research: yes." },
  { id: "gemini", label: "Google Gemini", hint: "Enter a current model id. Google Search for weekly research: yes." },
  { id: "openai-compatible", label: "OpenAI-compatible (Ollama, LM Studio, OpenRouter…)", hint: "Base URL and model required; key only if your server needs one. No web search, so weekly research stays manual." },
];

export function AiProvider() {
  const { act } = useData();
  const [ai, setAi] = useState<AiView | null>(null);
  const [provider, setProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fill = (v: AiView) => {
    setAi(v);
    const s = v.saved;
    setProvider(s?.provider ?? "anthropic");
    setModel(s?.model ?? "");
    setBaseUrl(s?.baseUrl ?? "");
    setApiKey("");
  };
  useEffect(() => {
    api.get<AiView>("/api/ai").then(fill).catch(() => {});
  }, []);
  if (!ai) return <p className="muted small">Loading…</p>;

  const keepKey = ai.saved?.hasKey && ai.saved.provider === provider;
  const meta = PROVIDERS.find((p) => p.id === provider)!;
  const save = () =>
    act(async () => {
      fill(await api.put<AiView>("/api/ai", { provider, apiKey, model, baseUrl }));
      setTest(null);
    }, "AI provider saved");
  const remove = () => {
    if (!confirm("Remove the saved AI provider and key?")) return;
    return act(async () => {
      fill(await api.del<AiView>("/api/ai"));
      setTest(null);
    }, "AI provider removed");
  };
  const runTest = async () => {
    setBusy(true);
    setTest(null);
    try {
      const r = await api.post<{ provider: string; model: string; reply: string; researchSupported: boolean }>("/api/ai/test");
      setTest({ ok: true, text: `Connected to ${r.provider}${r.model ? ` · ${r.model}` : ""} (it replied "${r.reply || "…"}").${r.researchSupported ? "" : " No web search, so weekly research stays manual."}` });
    } catch (e: any) {
      setTest({ ok: false, text: e.message });
    }
    setBusy(false);
  };

  const status = ai.enabled
    ? `On · ${ai.provider}${ai.model ? ` · ${ai.model}` : ""}${ai.researchSupported ? " · weekly research automatic" : " · weekly research manual"}`
    : ai.problem ?? "Off · bag photos use OCR and weekly research is manual";

  return (
    <div className="stack" data-testid="ai-provider">
      <p className="small"><strong>Status:</strong> <span data-testid="ai-status">{status}</span></p>
      {ai.envOverride ? (
        <p className="muted small">
          Set by environment variables on the server (<code>LLM_*</code>), which take precedence. Change it there, or clear
          <code> LLM_API_KEY</code>/<code>LLM_BASE_URL</code> to manage it here.
        </p>
      ) : (
        <>
          <Field label="Provider" htmlFor="ai-provider">
            <select id="ai-provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
              {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </Field>
          <p className="muted small">{meta.hint}</p>
          <Field label="API key" htmlFor="ai-key" hint={keepKey ? "A key is saved. Leave blank to keep it; it's never shown again." : "Stored on your server only, outside the database, exports and backups."}>
            <input id="ai-key" type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              placeholder={keepKey ? "•••••••• (saved)" : provider === "openai-compatible" ? "Optional" : "Paste your key"} />
          </Field>
          <Field label={provider === "anthropic" ? "Model (optional)" : "Model"} htmlFor="ai-model">
            <input id="ai-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder={provider === "anthropic" ? "claude-opus-5-5" : "model id"} autoCapitalize="off" spellCheck={false} />
          </Field>
          {(provider === "openai-compatible" || baseUrl) && (
            <Field label="Base URL" htmlFor="ai-base">
              <input id="ai-base" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://ollama:11434/v1" autoCapitalize="off" spellCheck={false} />
            </Field>
          )}
          <div className="row-actions">
            {ai.saved && <button className="link" onClick={remove}>Remove</button>}
            <button className="primary" onClick={save}>Save</button>
          </div>
        </>
      )}
      {(ai.enabled || ai.saved) && <button className="block" onClick={runTest} disabled={busy}>{busy ? "Testing…" : "Test connection"}</button>}
      {test && <p className={test.ok ? "ok-note small" : "error small"} data-testid="ai-test" role="status">{test.text}</p>}
    </div>
  );
}
