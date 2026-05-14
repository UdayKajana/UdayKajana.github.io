"""
DSPy + Phoenix + OpenAI — Console Observability Pipeline
=========================================================
Install:
    pip install dspy arize-phoenix openinference-instrumentation-dspy openai

Run:
    OPENAI_API_KEY=sk-... python dspy_phoenix_integration.py
"""
import os
import sys
import time

import dspy
import phoenix as px
from openinference.instrumentation.dspy import DSPyInstrumentor
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry import trace as otel_trace

# ── 1. Check API key ──────────────────────────────────────────────────────────
api_key = os.environ.get("OPENAI_API_KEY", "").strip()
if not api_key:
    print("ERROR: Set OPENAI_API_KEY before running.")
    print("  export OPENAI_API_KEY=sk-...")
    sys.exit(1)

# ── 2. Start Phoenix (opens UI at http://localhost:6006) ──────────────────────
session = px.launch_app()
print(f"\n Phoenix UI → {session.url}\n")

# ── 3. Wire OpenTelemetry to capture spans in-memory and send to Phoenix ─────────────────────────
in_memory_exporter = InMemorySpanExporter()
otlp_exporter = OTLPSpanExporter(endpoint="http://localhost:4317", insecure=True)
provider = TracerProvider()
provider.add_span_processor(SimpleSpanProcessor(in_memory_exporter))
provider.add_span_processor(SimpleSpanProcessor(otlp_exporter))
otel_trace.set_tracer_provider(provider)

# Instrument DSPy so every LM call becomes a span
DSPyInstrumentor().instrument()

# ── 4. Configure DSPy with OpenAI ─────────────────────────────────────────────
lm = dspy.LM(model="openai/gpt-4o-mini", api_key=api_key)
dspy.configure(lm=lm)

# ── 5. DSPy Module ────────────────────────────────────────────────────────────
class QA(dspy.Signature):
    """Answer the question with reasoning."""
    question: str = dspy.InputField()
    reasoning: str = dspy.OutputField(desc="Step-by-step thought process")
    answer:    str = dspy.OutputField(desc="Final concise answer")

pipeline = dspy.ChainOfThought(QA)

# ── 6. Console report helper ──────────────────────────────────────────────────
def print_report(question, prediction, spans, latency_ms):
    print("\n" + "=" * 60)
    print("  RESULT")
    print("=" * 60)
    print(f"  Q : {question}")
    print(f"  Reasoning : {prediction.reasoning}")
    print(f"  Answer    : {prediction.answer}")

    print("\n" + "=" * 60)
    print("  PHOENIX TRACE REPORT")
    print("=" * 60)

    if spans:
        span  = spans[-1]
        attrs = dict(span.attributes or {})
        ctx   = span.context

        trace_id   = format(ctx.trace_id, "032x")[:16] + "..." if ctx else "n/a"
        span_id    = format(ctx.span_id,  "016x")       if ctx else "n/a"
        status     = span.status.status_code.name if span.status else "OK"
        input_tok  = attrs.get("llm.token_count.prompt",     "–")
        output_tok = attrs.get("llm.token_count.completion", "–")
        model      = attrs.get("llm.model_name", attrs.get("gen_ai.request.model", "gpt-4o-mini"))

        print(f"  trace_id      : {trace_id}")
        print(f"  span_id       : {span_id}")
        print(f"  model         : {model}")
        print(f"  dspy.module   : ChainOfThought")
        print(f"  status        : {status}")
        print(f"  latency_ms    : {latency_ms:.0f} ms")
        print(f"  input_tokens  : {input_tok}")
        print(f"  output_tokens : {output_tok}")
    else:
        print("  No spans captured.")

    print("=" * 60)
    print(f"  Full trace → {session.url}\n")

# ── 7. Main loop ──────────────────────────────────────────────────────────────
print("DSPy × Phoenix × OpenAI — type a question, 'quit' to exit.\n")

while True:
    try:
        question = input("❯ ").strip()
    except (EOFError, KeyboardInterrupt):
        print("\nBye!")
        break

    if not question:
        continue
    if question.lower() in ("quit", "exit", "q"):
        print("Bye!")
        break

    in_memory_exporter.clear()
    t0 = time.time()

    try:
        result = pipeline(question=question)
        latency_ms = (time.time() - t0) * 1000
        spans = in_memory_exporter.get_finished_spans()

        # Print DSPy trace for debugging
        print("\n" + "=" * 60)
        print("DSPy TRACE")
        print("=" * 60)
        for i, item in enumerate(dspy.settings.trace):
            module, inputs, outputs = item
            print(f"Call {i+1}:")
            print(f"  Module: {module}")
            print(f"  Inputs: {inputs}")
            print(f"  Outputs: {outputs}")
            print()

        print_report(question, result, spans, latency_ms)

    except Exception as e:
        print(f"\nError: {e}\n")