import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const backend = "http://127.0.0.1:8083";
// The backend refuses a write from any other origin, and this is a dev proxy.
const proxied = { target: backend, headers: { origin: backend } };

export default defineConfig({
	plugins: [react()],
	server: { host: "127.0.0.1", proxy: { "/api": proxied, "/auth": proxied } },
	build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1200 },
	test: { include: ["src/**/*.test.ts"] },
});
