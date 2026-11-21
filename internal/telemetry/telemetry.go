// Package telemetry exports request traces over OTLP, with t10-modkit's
// telemetry, and adds what only Workbench does: a browser's turn starts its trace,
// whose ID is the turn's ID.
package telemetry

import (
	"context"
	"crypto/rand"
	"fmt"
	"net/http"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"

	shared "github.com/xiant10/t10-modkit/telemetry"
)

const (
	serviceName = "t10-workbench"
	turnHeader  = "X-Turn-ID"
)

// Setup starts the exporter and returns a shutdown that flushes it. Root spans
// that carry a turn take its ID as their trace ID.
func Setup(ctx context.Context, endpoint string) (func(context.Context) error, error) {
	return shared.Setup(ctx, serviceName, endpoint, sdktrace.WithIDGenerator(turnIDs{}))
}

// Wrap traces one route, named by its pattern, and marks its chat session.
func Wrap(pattern string, next http.Handler) http.Handler {
	return shared.Wrap(pattern, next)
}

// Inject puts the trace on ctx into an outgoing request's headers as a W3C
// traceparent, so a downstream service continues it. It adds nothing outside a span.
func Inject(ctx context.Context, h http.Header) {
	shared.Inject(ctx, h)
}

// WrapTurn traces the route a browser's turn comes in on. A POST naming a turn
// starts the trace with that turn's ID, because a turn's trace ID is its turn ID,
// and whatever trace a browser names stays only a link.
func WrapTurn(pattern string, next http.Handler) http.Handler {
	traced := otelhttp.NewHandler(next, pattern, otelhttp.WithPublicEndpointFn(func(*http.Request) bool { return true }))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if id, err := trace.TraceIDFromHex(r.Header.Get(turnHeader)); err == nil && r.Method == http.MethodPost {
			r = r.WithContext(context.WithValue(r.Context(), turnKey{}, id))
		}
		traced.ServeHTTP(w, r)
	})
}

// StartTurn starts the span of one browser send, marked with its chat session and
// method. A turn's trace ID is its turn ID, so a turn ID that can't be one gets no
// span. It returns the traceparent that puts agent-pi's work in the same trace.
func StartTurn(ctx context.Context, turnID, session, method string) (context.Context, string, func()) {
	traceID, err := trace.TraceIDFromHex(turnID)
	if err != nil {
		return ctx, "", func() {}
	}
	options := []trace.SpanStartOption{}
	if current := trace.SpanContextFromContext(ctx); current.IsValid() && current.TraceID() != traceID {
		options = append(options, trace.WithNewRoot())
	}
	if shared.SpanValue(session) {
		options = append(options, trace.WithAttributes(attribute.String(shared.SessionAttribute, session)))
	}
	if shared.SpanValue(method) {
		options = append(options, trace.WithAttributes(attribute.String("rpc.method", method)))
	}
	ctx, span := shared.Tracer().Start(context.WithValue(ctx, turnKey{}, traceID), "workbench.send", options...)
	sc := span.SpanContext()
	if !sc.IsValid() {
		// Nothing exports here, but the services after this one may still trace the turn.
		return ctx, fmt.Sprintf("00-%s-%s-01", traceID, newSpanID()), func() {}
	}
	return ctx, fmt.Sprintf("00-%s-%s-01", sc.TraceID(), sc.SpanID()), func() { span.End() }
}

// turnKey is the context key for the trace a new root span must start.
type turnKey struct{}

// turnIDs gives a root span its turn's trace ID, when it has a turn.
type turnIDs struct{}

func (turnIDs) NewIDs(ctx context.Context) (trace.TraceID, trace.SpanID) {
	id, ok := ctx.Value(turnKey{}).(trace.TraceID)
	if !ok {
		_, _ = rand.Read(id[:])
	}
	return id, newSpanID()
}

func (turnIDs) NewSpanID(context.Context, trace.TraceID) trace.SpanID { return newSpanID() }

func newSpanID() trace.SpanID {
	var id trace.SpanID
	_, _ = rand.Read(id[:])
	return id
}
