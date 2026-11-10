# syntax=docker/dockerfile:1

FROM node:24-alpine AS web

WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.27.2-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
COPY third_party/t10-modkit ./third_party/t10-modkit
RUN go mod download
COPY . .
COPY --from=web /src/web/dist ./web/dist
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /out/workbench ./cmd/workbench

FROM alpine:3.21

RUN apk add --no-cache ca-certificates

COPY --from=build /out/workbench /usr/local/bin/

USER 65534:65534

EXPOSE 18060

ENTRYPOINT ["/usr/local/bin/workbench"]
