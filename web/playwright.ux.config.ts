import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: "ux", workers: 1, reporter: "list", timeout: 20_000,
	use: { baseURL: "http://127.0.0.1:5174", headless: true },
	webServer: { command: "npm run dev -- --port 5174 --strictPort", url: "http://127.0.0.1:5174", reuseExistingServer: false },
});
