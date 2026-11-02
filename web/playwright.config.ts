import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "e2e",
	testMatch: "*.spec.ts",
	timeout: 60_000,
	workers: 1,
	reporter: "list",
	use: {
		baseURL: `http://127.0.0.1:${process.env.E2E_PORT ?? 8083}`,
		trace: "retain-on-failure",
		launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
	},
});
