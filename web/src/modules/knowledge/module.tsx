import { BookOpen } from "lucide-react";
import type { WorkbenchModule } from "../types.ts";
import { KnowledgeAdmin, KnowledgePage } from "./Knowledge.tsx";
export const knowledge: WorkbenchModule = {
	id: "knowledge",
	apiVersion: 1,
	routes: [{ path: "knowledge", element: <KnowledgePage /> }],
	nav: [{ key: "knowledge", label: "Knowledge", to: "knowledge", icon: BookOpen }],
	eventLabel: (kind) => kind,
	admin: { label: "Knowledge", icon: BookOpen, Settings: KnowledgeAdmin },
};
