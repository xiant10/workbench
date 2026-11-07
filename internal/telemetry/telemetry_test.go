package telemetry

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

const turn = "0123456789abcdef0123456789abcdef"

func recording(t *testing.T) *tracetest.SpanRecorder {
	t.Helper()
	recorder := tracetest.NewSpanRecorder()
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder), sdktrace.WithIDGenerator(turnIDs{})))
	t.Cleanup(func() { otel.SetTracerProvider(previous) })
	return recorder
}

// The inbound span must be the turn's root: it holds the status the browser got.
func TestATurnIsOneTraceFromTheInboundRequest(t *testing.T) {
	recorder := recording(t)
	var traceparent string
	h := WrapTurn("POST /agent", http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		_, tp, end := StartTurn(r.Context(), turn, "agent-pi-0.abc", "session.prompt")
		defer end()
		traceparent = tp
	}))
	r := httptest.NewRequest(http.MethodPost, "/agent", nil)
	r.Header.Set(turnHeader, turn)
	r.Header.Set("traceparent", "00-fedcba9876543210fedcba9876543210-0123456789abcdef-01")
	h.ServeHTTP(httptest.NewRecorder(), r)

	spans := recorder.Ended()
	if len(spans) != 2 {
		t.Fatalf("spans = %d, want 2", len(spans))
	}
	send, inbound := spans[0], spans[1]
	if send.SpanContext().TraceID().String() != turn || inbound.SpanContext().TraceID().String() != turn {
		t.Fatalf("traces %s and %s, want %s", send.SpanContext().TraceID(), inbound.SpanContext().TraceID(), turn)
	}
	if inbound.Parent().IsValid() || send.Parent().SpanID() != inbound.SpanContext().SpanID() {
		t.Fatalf("inbound parent %v, send parent %v", inbound.Parent(), send.Parent())
	}
	if !strings.Contains(traceparent, send.SpanContext().SpanID().String()) {
		t.Fatalf("traceparent %q isn't the send span", traceparent)
	}
	want := map[attribute.Key]string{"t10.session.id": "agent-pi-0.abc", "rpc.method": "session.prompt"}
	for _, kv := range send.Attributes() {
		if v, ok := want[kv.Key]; ok && v == kv.Value.AsString() {
			delete(want, kv.Key)
		}
	}
	if len(want) != 0 {
		t.Fatalf("missing attributes %v", want)
	}
}

func TestStartTurnKeepsFreeTextOffTheSpan(t *testing.T) {
	recorder := recording(t)
	_, _, end := StartTurn(context.Background(), turn, "my private words", "say hello")
	end()
	if attrs := recorder.Ended()[0].Attributes(); len(attrs) != 0 {
		t.Fatalf("attributes = %v", attrs)
	}
}

// With tracing off, the services after this one still get the turn's trace.
func TestStartTurnWithoutAnExporterStillPassesTheTrace(t *testing.T) {
	_, traceparent, end := StartTurn(context.Background(), turn, "", "")
	defer end()
	if !strings.HasPrefix(traceparent, "00-"+turn+"-") || strings.HasPrefix(traceparent, "00-"+turn+"-0000") {
		t.Fatalf("traceparent = %q", traceparent)
	}
}

func TestStartTurnSkipsATurnThatCantBeATrace(t *testing.T) {
	if _, traceparent, _ := StartTurn(context.Background(), "turn-1", "", ""); traceparent != "" {
		t.Fatalf("traceparent = %q", traceparent)
	}
}
