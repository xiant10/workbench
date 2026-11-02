// Package telemetry exports request traces over OTLP. Spans carry routes and
// statuses only, never a query string or a body, because those hold people's
// words. With no endpoint it does nothing.
package telemetry

import (
	"context"
	"crypto/rand"
	"fmt"
	"net/http"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

const serviceName = "t10-workbench"

// Setup starts the exporter and returns a shutdown that flushes it.
func Setup(ctx context.Context, endpoint string) (func(context.Context) error, error) {
	if endpoint == "" {
		return func(context.Context) error { return nil }, nil
	}
	res, err := resource.New(ctx, resource.WithAttributes(attribute.String("service.name", serviceName)))
	if err != nil {
		return nil, fmt.Errorf("build otel resource: %w", err)
	}
	exporter, err := otlptracegrpc.New(ctx, otlptracegrpc.WithEndpoint(endpoint), otlptracegrpc.WithInsecure())
	if err != nil {
		return nil, fmt.Errorf("dial otlp exporter at %q: %w", endpoint, err)
	}
	provider := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exporter), sdktrace.WithResource(res))
	otel.SetTracerProvider(provider)
	return provider.Shutdown, nil
}

// Wrap traces one route, named by its pattern so that IDs stay out of the name.
func Wrap(pattern string, next http.Handler) http.Handler {
	return otelhttp.NewHandler(next, pattern)
}

// StartTurn starts the span of one browser send. A turn's trace ID is its turn
// ID, so a turn ID that can't be one gets no span. It returns the traceparent
// that puts agent-pi's work in the same trace.
func StartTurn(ctx context.Context, turnID string) (context.Context, string, func()) {
	traceID, err := trace.TraceIDFromHex(turnID)
	if err != nil {
		return ctx, "", func() {}
	}
	var spanID trace.SpanID
	_, _ = rand.Read(spanID[:])
	parent := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID: traceID, SpanID: spanID, TraceFlags: trace.FlagsSampled, Remote: true,
	})
	ctx, span := otel.Tracer(serviceName).Start(trace.ContextWithRemoteSpanContext(ctx, parent), "workbench.send")
	sc := span.SpanContext()
	return ctx, fmt.Sprintf("00-%s-%s-01", sc.TraceID(), sc.SpanID()), func() { span.End() }
}
