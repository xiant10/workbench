import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource-variable/inter/wght.css";
import "./kit/app.css";
import { I18nProvider } from "./lib/i18n.tsx";
import { ZH } from "./lib/zh.ts";
import { FeedbackProvider, ErrorBoundary } from "./lib/ui.tsx";
import { App } from "./shell/App.tsx";
import { applyTheme } from "./shell/theme.ts";

applyTheme();
const client = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } });

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<ErrorBoundary>
			<QueryClientProvider client={client}>
				<I18nProvider catalog={ZH}>
					<FeedbackProvider>
						<BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
							<App />
						</BrowserRouter>
					</FeedbackProvider>
				</I18nProvider>
			</QueryClientProvider>
		</ErrorBoundary>
	</StrictMode>,
);
