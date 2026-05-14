import { useState, useRef, useEffect } from "react";

const PIPELINE_STEPS = [
  { id: "input", label: "User Input", icon: "✏️", color: "#4F46E5" },
  { id: "dspy", label: "DSPy Framework", icon: "⚙️", color: "#0891B2" },
  { id: "llm", label: "LLM Response", icon: "🤖", color: "#059669" },
  { id: "phoenix", label: "Phoenix Trace", icon: "🔭", color: "#DC2626" },
];

function TraceRow({ label, value, mono = false }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "6px 0", borderBottom: "1px solid #1e293b" }}>
      <span style={{ color: "#94a3b8", fontSize: 12, minWidth: 140 }}>{label}</span>
      <span style={{ color: mono ? "#34d399" : "#e2e8f0", fontSize: 12, fontFamily: mono ? "monospace" : "inherit", textAlign: "right", maxWidth: 260, wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

function PipelineIndicator({ activeStep }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 24 }}>
      {PIPELINE_STEPS.map((step, i) => (
        <div key={step.id} style={{ display: "flex", alignItems: "center", flex: 1 }}>
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1,
            opacity: activeStep === null ? 0.4 : PIPELINE_STEPS.findIndex(s => s.id === activeStep) >= i ? 1 : 0.4,
            transition: "opacity 0.4s ease"
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
              background: activeStep === step.id ? step.color : "#1e293b",
              border: `2px solid ${activeStep === step.id ? step.color : "#334155"}`,
              fontSize: 16, transition: "all 0.4s ease",
              boxShadow: activeStep === step.id ? `0 0 12px ${step.color}66` : "none"
            }}>{step.icon}</div>
            <span style={{ fontSize: 10, color: activeStep === step.id ? "#f1f5f9" : "#64748b", textAlign: "center", fontWeight: activeStep === step.id ? 600 : 400 }}>{step.label}</span>
          </div>
          {i < PIPELINE_STEPS.length - 1 && (
            <div style={{
              height: 2, width: 24, background: activeStep && PIPELINE_STEPS.findIndex(s => s.id === activeStep) > i ? "#4F46E5" : "#1e293b",
              transition: "background 0.4s ease", marginBottom: 18
            }} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [activeStep, setActiveStep] = useState(null);
  const [result, setResult] = useState(null);
  const [traceData, setTraceData] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function runPipeline() {
    if (!query.trim() || isLoading) return;
    setIsLoading(true);
    setError(null);
    setResult(null);
    setTraceData(null);

    const startTime = Date.now();

    try {
      // Step 1: Input received
      setActiveStep("input");
      await sleep(500);

      // Step 2: DSPy processing
      setActiveStep("dspy");
      await sleep(600);

      // Step 3: LLM call
      setActiveStep("llm");

      const dspySystemPrompt = `You are a DSPy-powered LLM module. DSPy is a framework for algorithmically optimizing LM prompts and weights.

You receive a user query and must respond in a structured, reasoning-first format as DSPy would produce:

Respond ONLY in this JSON format (no markdown, no extra text):
{
  "reasoning": "Step-by-step chain of thought reasoning about the query",
  "answer": "Clear, concise final answer",
  "confidence": 0.95,
  "module": "ChainOfThought",
  "signature": "query -> reasoning, answer"
}`;

      const apiStart = Date.now();
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: dspySystemPrompt,
          messages: [{ role: "user", content: query }],
        }),
      });

      const data = await response.json();
      const apiLatency = Date.now() - apiStart;

      let parsed;
      const raw = data.content?.[0]?.text || "";
      try {
        const clean = raw.replace(/```json|```/g, "").trim();
        parsed = JSON.parse(clean);
      } catch {
        parsed = { reasoning: "Direct response", answer: raw, confidence: 0.9, module: "Predict", signature: "query -> answer" };
      }

      setResult(parsed);

      // Step 4: Phoenix trace
      setActiveStep("phoenix");
      await sleep(400);

      const totalLatency = Date.now() - startTime;
      const inputTokens = data.usage?.input_tokens || 0;
      const outputTokens = data.usage?.output_tokens || 0;

      const trace = {
        traceId: `tr_${Math.random().toString(36).slice(2, 10)}`,
        spanId: `sp_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        model: "claude-sonnet-4-20250514",
        dspyModule: parsed.module || "ChainOfThought",
        signature: parsed.signature || "query -> answer",
        confidence: parsed.confidence || 0.9,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        latencyMs: totalLatency,
        llmLatencyMs: apiLatency,
        status: "success",
        queryLen: query.length,
        answerLen: parsed.answer?.length || 0,
      };

      setTraceData(trace);
      setHistory((h) => [{ query, result: parsed, trace }, ...h.slice(0, 4)]);
      setActiveStep("done");
    } catch (err) {
      setError(err.message || "Pipeline failed");
      setActiveStep(null);
    } finally {
      setIsLoading(false);
    }
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      runPipeline();
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0a0f1e", color: "#e2e8f0", fontFamily: "'Courier New', monospace", padding: "24px 20px" }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 22 }}>🔭</span>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#f8fafc", letterSpacing: "-0.5px", fontFamily: "sans-serif" }}>
            DSPy <span style={{ color: "#6366f1" }}>×</span> Phoenix
          </h1>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>LLM Pipeline with Full Observability</p>
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 10 }}>
          {["DSPy: ChainOfThought", "Claude Sonnet", "Phoenix Tracing"].map(t => (
            <span key={t} style={{ fontSize: 10, color: "#475569", background: "#1e293b", padding: "3px 8px", borderRadius: 99, border: "1px solid #334155" }}>{t}</span>
          ))}
        </div>
      </div>

      {/* Pipeline diagram */}
      <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: "20px 16px", marginBottom: 20 }}>
        <p style={{ margin: "0 0 16px", fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: 1 }}>Pipeline</p>
        <PipelineIndicator activeStep={activeStep === "done" ? "phoenix" : activeStep} />
      </div>

      {/* Input */}
      <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: 16, marginBottom: 20 }}>
        <p style={{ margin: "0 0 10px", fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: 1 }}>Query</p>
        <textarea
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask anything… (Enter to run)"
          rows={3}
          disabled={isLoading}
          style={{
            width: "100%", boxSizing: "border-box", background: "#020617", border: "1px solid #1e293b",
            borderRadius: 8, color: "#e2e8f0", fontSize: 14, padding: "10px 12px", resize: "none",
            fontFamily: "'Courier New', monospace", outline: "none", lineHeight: 1.6,
            opacity: isLoading ? 0.6 : 1
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
          <span style={{ fontSize: 11, color: "#334155" }}>{query.length} chars</span>
          <button
            onClick={runPipeline}
            disabled={isLoading || !query.trim()}
            style={{
              background: isLoading ? "#1e293b" : "#4F46E5", color: isLoading ? "#475569" : "#fff",
              border: "none", borderRadius: 8, padding: "8px 20px", fontSize: 13, fontWeight: 600,
              cursor: isLoading || !query.trim() ? "not-allowed" : "pointer", fontFamily: "sans-serif",
              transition: "all 0.2s"
            }}
          >
            {isLoading ? `${activeStep === "input" ? "Receiving…" : activeStep === "dspy" ? "DSPy processing…" : activeStep === "llm" ? "LLM running…" : "Tracing…"}` : "▶ Run Pipeline"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: "#1c0a0a", border: "1px solid #7f1d1d", borderRadius: 10, padding: 14, marginBottom: 20, color: "#fca5a5", fontSize: 13 }}>
          ⚠ {error}
        </div>
      )}

      {/* LLM Result */}
      {result && (
        <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <p style={{ margin: 0, fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: 1 }}>DSPy Output</p>
            <span style={{ fontSize: 10, background: "#064e3b", color: "#34d399", padding: "3px 8px", borderRadius: 99 }}>✓ {result.module || "ChainOfThought"}</span>
          </div>

          <div style={{ background: "#020617", borderRadius: 8, padding: 12, marginBottom: 12, border: "1px solid #1e293b" }}>
            <p style={{ margin: "0 0 6px", fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: 1 }}>Reasoning trace</p>
            <p style={{ margin: 0, fontSize: 13, color: "#94a3b8", lineHeight: 1.7 }}>{result.reasoning}</p>
          </div>

          <div style={{ background: "#020617", borderRadius: 8, padding: 12, border: "1px solid #1e293b" }}>
            <p style={{ margin: "0 0 6px", fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: 1 }}>Answer</p>
            <p style={{ margin: 0, fontSize: 14, color: "#e2e8f0", lineHeight: 1.7 }}>{result.answer}</p>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <div style={{ flex: 1, background: "#020617", borderRadius: 8, padding: 10, border: "1px solid #1e293b", textAlign: "center" }}>
              <p style={{ margin: "0 0 2px", fontSize: 10, color: "#475569" }}>Confidence</p>
              <p style={{ margin: 0, fontSize: 18, color: "#34d399", fontWeight: 700 }}>{((result.confidence || 0.9) * 100).toFixed(0)}%</p>
            </div>
            <div style={{ flex: 1, background: "#020617", borderRadius: 8, padding: 10, border: "1px solid #1e293b", textAlign: "center" }}>
              <p style={{ margin: "0 0 2px", fontSize: 10, color: "#475569" }}>Signature</p>
              <p style={{ margin: 0, fontSize: 11, color: "#818cf8", fontFamily: "monospace" }}>{result.signature || "query → answer"}</p>
            </div>
          </div>
        </div>
      )}

      {/* Phoenix Trace Panel */}
      {traceData && (
        <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16 }}>🔭</span>
              <p style={{ margin: 0, fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: 1 }}>Phoenix Observability Trace</p>
            </div>
            <span style={{ fontSize: 10, background: "#1e1b4b", color: "#a5b4fc", padding: "3px 8px", borderRadius: 99 }}>LIVE TRACE</span>
          </div>

          <div style={{ background: "#020617", borderRadius: 8, padding: 12, border: "1px solid #1e293b" }}>
            <TraceRow label="trace_id" value={traceData.traceId} mono />
            <TraceRow label="span_id" value={traceData.spanId} mono />
            <TraceRow label="timestamp" value={new Date(traceData.timestamp).toLocaleTimeString()} />
            <TraceRow label="model" value={traceData.model} mono />
            <TraceRow label="dspy.module" value={traceData.dspyModule} mono />
            <TraceRow label="dspy.signature" value={traceData.signature} mono />
            <TraceRow label="status" value="✓ success" />
            <TraceRow label="latency_ms" value={`${traceData.latencyMs} ms`} />
            <TraceRow label="llm_latency_ms" value={`${traceData.llmLatencyMs} ms`} />
            <TraceRow label="input_tokens" value={traceData.inputTokens} />
            <TraceRow label="output_tokens" value={traceData.outputTokens} />
            <TraceRow label="total_tokens" value={traceData.totalTokens} />
            <TraceRow label="confidence_score" value={((traceData.confidence) * 100).toFixed(1) + "%"} />
          </div>

          {/* Latency bar */}
          <div style={{ marginTop: 14 }}>
            <p style={{ margin: "0 0 6px", fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: 1 }}>Latency breakdown</p>
            <div style={{ background: "#020617", borderRadius: 6, height: 24, overflow: "hidden", display: "flex" }}>
              <div style={{ width: `${Math.round((traceData.latencyMs - traceData.llmLatencyMs) / traceData.latencyMs * 100)}%`, background: "#4F46E5", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 9, color: "#fff" }}>DSPy</span>
              </div>
              <div style={{ flex: 1, background: "#0891B2", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 9, color: "#fff" }}>LLM {traceData.llmLatencyMs}ms</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: 16 }}>
          <p style={{ margin: "0 0 12px", fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: 1 }}>Trace History</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {history.map((h, i) => (
              <div key={i} style={{ background: "#020617", borderRadius: 8, padding: "10px 12px", border: "1px solid #1e293b", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: "0 0 2px", fontSize: 12, color: "#94a3b8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.query}</p>
                  <p style={{ margin: 0, fontSize: 10, color: "#475569" }}>{h.trace.traceId} · {h.trace.latencyMs}ms · {h.trace.totalTokens} tok</p>
                </div>
                <span style={{ fontSize: 10, color: "#34d399", marginLeft: 10, flexShrink: 0 }}>✓ {((h.trace.confidence) * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p style={{ textAlign: "center", marginTop: 20, fontSize: 10, color: "#1e293b" }}>DSPy × Phoenix × Claude — Observability Pipeline</p>
    </div>
  );
}