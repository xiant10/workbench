import { useQueries, useQuery } from "@tanstack/react-query";
import { Check, Circle, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { getCatalog, listMembers, listRoles } from "../admin/api.ts";
import { useI18n } from "../lib/i18n.tsx";
import { load, save } from "../lib/storage.ts";
import { useModules } from "../modules/index.tsx";
import type { SetupStep } from "../modules/types.ts";
import { useWorkspace } from "./workspace.ts";

const INVITE: SetupStep = {
	key: "invite",
	label: "Invite your team",
	to: "admin?tab=people",
	check: async (tenant) => (await listMembers(tenant)).filter((member) => member.status === "active").length > 1,
};

const ROLES: SetupStep = {
	key: "roles",
	label: "Create roles for your team",
	to: "admin?tab=roles",
	check: async (tenant) => (await listRoles(tenant)).length > 0,
};

/**
 * What a tenant admin still has to do. Each step asks whether it's done, so a step that can't answer is left out rather
 * than telling someone to do what they may have done. Hiding is a convenience, kept per browser, and covers the steps
 * open at the time, so a module deployed later still gets seen.
 */
export function Setup() {
	const { t } = useI18n();
	const { tenant, me, path } = useWorkspace();
	const modules = useModules();
	const storageKey = `setup-hidden:${tenant}`;
	const [hidden, setHidden] = useState(() => (load(storageKey) ?? "").split(","));

	const roleModules = useQuery({ queryKey: ["setup", tenant, "catalog"], queryFn: () => getCatalog(tenant), retry: false });
	const usesRoles = roleModules.data?.modules.some((entry) => modules.some((module) => module.id === entry.id)) ?? false;
	const steps = [INVITE, ...modules.flatMap((module) => module.setup ?? []), ...(usesRoles ? [ROLES] : [])];
	const answers = useQueries({ queries: steps.map((step) => ({ queryKey: ["setup", tenant, step.key], queryFn: () => step.check(tenant), retry: false })) });

	if (roleModules.isPending || answers.some((answer) => answer.isPending)) return null;
	const known = steps.flatMap((step, index) => {
		const done = answers[index]?.data;
		return done === undefined ? [] : [{ ...step, done }];
	});
	const open = known.filter((step) => !step.done);
	if (!open.some((step) => !hidden.includes(step.key))) return null;

	const hide = () => {
		const keys = open.map((step) => step.key);
		save(storageKey, keys.join(","));
		setHidden(keys);
	};
	return (
		<section className="always">
			<div className="setup-head">
				<h2>{t("Set up {tenant}", { tenant: me.tenants.find((item) => item.id === tenant)?.name ?? tenant })}</h2>
				<span className="quiet">{t("{done} of {total} done", { done: known.length - open.length, total: known.length })}</span>
				<button type="button" className="icon-button" aria-label={t("Hide setup")} onClick={hide}>
					<X size={15} aria-hidden="true" />
				</button>
			</div>
			<ul className="rows">
				{known.map((step) => (
					<li key={step.key} className="row">
						<span className={step.done ? "row-icon ok" : "row-icon"}>{step.done ? <Check size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}</span>
						<div className="row-main">{step.done ? <span className="quiet">{t(step.label)}</span> : <Link to={path(step.to)}>{t(step.label)}</Link>}</div>
					</li>
				))}
			</ul>
		</section>
	);
}
