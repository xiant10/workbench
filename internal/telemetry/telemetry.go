// Package telemetry exports request traces over OTLP. Spans carry routes and
// statuses only, never a query string or a body, because those hold people's
// words. With no endpoint it does nothing.
package telemetry

import (
	"context"
	"crypto/rand"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

const (
	serviceName = "t10-workbench"
	turnHeader  = "X-Turn-ID"
)

// spanValue is what may go on a span from a request: an identifier, never free text.
var spanValue = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)

// Setup starts the exporter and returns a shutdown that flushes it.
func Setup(ctx context.Context, endpoint string) (func(context.Context) error, error) {
	otel.SetTextMapPropagator(propagation.TraceContext{})
	if endpoint == "" {
		return func(context.Context) error { return nil }, nil
	}
	target, err := url.Parse(endpoint)
	if err != nil || (target.Scheme != "http" && target.Scheme != "https") || target.Host == "" {
		// Tracing never stops a service, but this has to be visible.
		slog.Error("traces are off: OTEL_EXPORTER_OTLP_ENDPOINT must be a URL such as http://collector:4318")
		return func(context.Context) error { return nil }, nil
	}
	res, err := resource.New(ctx, resource.WithAttributes(attribute.String("service.name", serviceName)))
	if err != nil {
		return nil, fmt.Errorf("build otel resource: %w", err)
	}
	exporter, err := otlptracehttp.New(ctx, otlptracehttp.WithEndpointURL(target.JoinPath("v1/traces").String()))
	if err != nil {
		return nil, fmt.Errorf("dial otlp exporter at %q: %w", endpoint, err)
	}
	provider := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exporter), sdktrace.WithResource(res), sdktrace.WithIDGenerator(turnIDs{}))
	otel.SetTracerProvider(provider)
	return provider.Shutdown, nil
}

// Wrap traces one route, named by its pattern so that IDs stay out of the name.
func Wrap(pattern string, next http.Handler) http.Handler {
	return otelhttp.NewHandler(next, pattern)
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
	if spanValue.MatchString(session) {
		options = append(options, trace.WithAttributes(attribute.String("t10.session.id", session)))
	}
	if spanValue.MatchString(method) {
		options = append(options, trace.WithAttributes(attribute.String("rpc.method", method)))
	}
	ctx, span := otel.Tracer(serviceName).Start(context.WithValue(ctx, turnKey{}, traceID), "workbench.send", options...)
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

// Inject puts the trace on ctx into an outgoing request's headers as a W3C
// traceparent, so a downstream service continues it. It adds nothing outside a span.
func Inject(ctx context.Context, h http.Header) {
	otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(h))
}
