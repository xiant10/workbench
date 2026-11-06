import { BookOpen } from "lucide-react";
import { request } from "../../lib/api.ts";
import type { WorkbenchModule } from "../types.ts";
import { root } from "./api.ts";
import { KnowledgeAdmin, KnowledgePage } from "./Knowledge.tsx";
export const knowledge: WorkbenchModule = {
	id: "knowledge",
	apiVersion: 1,
	routes: [{ path: "knowledge", element: <KnowledgePage /> }],
	nav: [{ key: "knowledge", label: "Knowledge", to: "knowledge", icon: BookOpen }],
	eventLabel: (kind) => kind,
	admin: { label: "Knowledge", icon: BookOpen, Settings: KnowledgeAdmin },
	setup: [
		{
			key: "knowledge-document",
			label: "Add your first document",
			to: "knowledge",
			check: async () => (await request<{ documents: unknown[] }>(`${root}/admin/documents?state=active&limit=1`)).documents.length > 0,
		},
	],
};
