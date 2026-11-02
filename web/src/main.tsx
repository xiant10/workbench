import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource-variable/inter/wght.css";
import "./app.css";
import { I18nProvider } from "./lib/i18n.tsx";
import { FeedbackProvider } from "./lib/ui.tsx";
import { App } from "./shell/App.tsx";
import { applyTheme } from "./shell/theme.ts";

applyTheme();
const client = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } });

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<QueryClientProvider client={client}>
			<I18nProvider>
				<FeedbackProvider>
					<BrowserRouter>
						<App />
					</BrowserRouter>
				</FeedbackProvider>
			</I18nProvider>
		</QueryClientProvider>
	</StrictMode>,
);
