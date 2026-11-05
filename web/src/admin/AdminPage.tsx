import { navigateOptions } from "../lib/layout.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, History, KeyRound, LockKeyhole, type LucideIcon, Plus, ShieldCheck, Sparkles, Square, Trash2, UserPlus, Users, Wand2 } from "lucide-react";
import { type FormEvent, useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useI18n } from "../lib/i18n.tsx";
import { CopyButton, Dialog, Empty, Setting, Skeleton, useFeedback } from "../lib/ui.tsx";
import { useModules } from "../modules/index.tsx";
import type { AdminTab } from "../modules/types.ts";
import { useWorkspace } from "../shell/workspace.ts";
import { SkillsLibrary } from "../skills/SkillsPage.tsx";
import { useFailure, useMemberName } from "./members.ts";
import { MemberRoles, Roles } from "./RolesTab.tsx";
import {
	createUnit,
	deleteUnit,
	getTenant,
	invite,
	listAudit,
	listGrants,
	listMembers,
	listUnits,
	type Member,
	resetLink,
	revokeGrant,
	type Role,
	setPlacement,
	setRequireMFA,
	type Unit,
	type UnitKind,
	unitTree,
	updateMember,
	updateUnit,
} from "./api.ts";

const TABS: Record<AdminTab, { label: string; icon: LucideIcon }> = {
	people: { label: "People", icon: Users },
	organization: { label: "Organization", icon: Building2 },
	roles: { label: "Roles", icon: ShieldCheck },
	agents: { label: "Agents", icon: Sparkles },
	skills: { label: "Skills", icon: Wand2 },
	security: { label: "Security and policies", icon: LockKeyhole },
};

const ACTIVITY = { label: "Activity", icon: History };

/** Everything a tenant admin runs, in one place: the tenant's people and organization from the auth service, and each module's settings. */
export function AdminPage() {
	const { t } = useI18n();
	const { isAdmin } = useWorkspace();
	const modules = useModules();
	const [params, setParams] = useSearchParams();
	// Built-in tabs, then one for each module with settings of its own, then the log.
	const tabs: { id: string; label: string; icon: LucideIcon }[] = [
		...Object.entries(TABS).map(([id, item]) => ({ id, ...item })),
		...modules.flatMap((module) => (module.admin !== undefined && "label" in module.admin && !Object.hasOwn(TABS, module.id) ? [{ id: module.id, label: module.admin.label, icon: module.admin.icon }] : [])),
		{ id: "activity", ...ACTIVITY },
	];
	const asked = params.get("tab") ?? "";
	const tab = tabs.some((item) => item.id === asked) ? asked : "people";
	const found = modules.find((module) => module.id === tab)?.admin;
	const own = found !== undefined && "label" in found ? found : undefined;
	if (!isAdmin) {
		return (
			<div className="page">
				<Empty icon={LockKeyhole} title={t("Only this tenant's admins can open this page.")} />
			</div>
		);
	}
	return (
		<div className="page admin">
			<header className="page-head">
				<h1>{t("Administration")}</h1>
			</header>
			<p className="quiet">{t("Changes here apply to everyone in this tenant.")}</p>
			<div className="tabs" role="tablist" onKeyDown={navigateOptions} aria-label={t("Administration")}>
				{tabs.map((item) => (
					<button key={item.id} type="button" role="tab" tabIndex={tab === item.id ? 0 : -1} aria-selected={tab === item.id} className={tab === item.id ? "tab active" : "tab"} onClick={() => setParams({ tab: item.id })}>
						<item.icon size={14} aria-hidden="true" /> {t(item.label)}
					</button>
				))}
			</div>
			{Object.hasOwn(TABS, tab) && <JoinedSettings tab={tab as AdminTab} />}
			{tab === "people" && <People />}
			{tab === "organization" && <Organization />}
			{tab === "roles" && <Roles />}
			{tab === "agents" && <Agents />}
			{tab === "skills" && <AdminSkills />}
			{tab === "security" && <Security />}
			{tab === "activity" && <Activity />}
			{own !== undefined && (
				<section className="admin-section always">
					<own.Settings />
				</section>
			)}
		</div>
	);
}

/** A link that works once, shown until it's closed. */
function OneTimeLink({ title, hint, url, onClose }: { title: string; hint: string; url: string; onClose(): void }) {
	const { t } = useI18n();
	return (
		<Dialog label={title} onClose={onClose}>
			<h2>{title}</h2>
			<div className="dialog-body">
				<p className="quiet">{hint}</p>
				<p className="secret-link">
					<code>{url}</code>
					<CopyButton text={url} label="Copy link" className="ghost small" />
				</p>
			</div>
			<div className="dialog-actions">
				<button type="button" className="primary" onClick={onClose}>
					{t("Done")}
				</button>
			</div>
		</Dialog>
	);
}

const PAGE_SIZE = 50;

function People() {
	const { t } = useI18n();
	const { tenant, me } = useWorkspace();
	const { confirm } = useFeedback();
	const failed = useFailure();
	const client = useQueryClient();
	const members = useQuery({ queryKey: ["org", tenant, "members"], queryFn: () => listMembers(tenant) });
	const units = useQuery({ queryKey: ["org", tenant, "units"], queryFn: () => listUnits(tenant) });
	const [link, setLink] = useState<{ title: string; hint: string; url: string }>();
	const [rolesFor, setRolesFor] = useState<Member>();
	const [role, setRole] = useState<Role>("member");
	const [search, setSearch] = useState("");
	const [limit, setLimit] = useState(PAGE_SIZE);

	const refresh = () => void client.invalidateQueries({ queryKey: ["org", tenant, "members"] });
	const change = useMutation({ mutationFn: (args: { user: string; role?: Role; status?: Member["status"] }) => updateMember(tenant, args.user, args), onSuccess: refresh, onError: failed });
	const place = useMutation({ mutationFn: (args: { user: string; manager_user_id: string; org_unit_id: string }) => setPlacement(tenant, args.user, args), onSuccess: refresh, onError: failed });
	const reset = useMutation({
		mutationFn: (member: Member) => resetLink(tenant, member.user_id).then((url) => ({ member, url })),
		onSuccess: ({ member, url }) => setLink({ title: t("Reset link for {name}", { name: member.name || member.user_id }), hint: t("It works once, for 30 minutes. Send it to them yourself: it isn't shown again."), url }),
		onError: failed,
	});
	const invitation = useMutation({
		mutationFn: () => invite(tenant, role),
		onSuccess: (links) => setLink({ title: t("Invitation link"), hint: t("Send it to the person you're inviting. Someone new signs up with it, and someone with an account joins. It isn't shown again."), url: links.invite_url }),
		onError: failed,
	});
	const people = members.data ?? [];
	const tree = unitTree(units.data ?? []);

	const activeManagers = useMemo(() => people.filter((other) => other.status === "active"), [people]);
	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return people;
		return people.filter((m) => (m.name || "").toLowerCase().includes(q) || m.user_id.toLowerCase().includes(q));
	}, [people, search]);
	const shown = useMemo(() => filtered.slice(0, limit), [filtered, limit]);

	const managersFor = useCallback(
		(member: Member) => {
			const list = activeManagers.filter((other) => other.user_id !== member.user_id);
			if (member.manager_user_id && !list.some((m) => m.user_id === member.manager_user_id)) {
				const departed = people.find((m) => m.user_id === member.manager_user_id);
				if (departed) list.push(departed);
			}
			return list;
		},
		[activeManagers, people],
	);
	// After every hook, so a render while loading calls the same hooks as one after.
	if (members.isPending) return <Skeleton />;

	return (
		<section className="admin-section always">
			<div className="add-row invite-row">
				<label className="with-label">
					{t("Invite as")}
					<select value={role} onChange={(event) => setRole(event.target.value as Role)}>
						<option value="member">{t("Member")}</option>
						<option value="admin">{t("Admin")}</option>
					</select>
				</label>
				<button type="button" className="primary" onClick={() => invitation.mutate()} disabled={invitation.isPending}>
					<UserPlus size={15} aria-hidden="true" />
					{t("Create an invitation link")}
				</button>
			</div>
			{people.length > PAGE_SIZE && (
				<div className="add-row">
					<input
						type="search"
						value={search}
						placeholder={t("Search")}
						aria-label={t("Search")}
						onChange={(event) => {
							setSearch(event.target.value);
							setLimit(PAGE_SIZE);
						}}
					/>
				</div>
			)}
			{filtered.length === 0 && <Empty icon={Users} title={t("No one here yet.")} />}
			<ul className="rows">
				{shown.map((member) => {
					const managers = managersFor(member);
					const off = member.status !== "active" || member.user_status !== "active";
					return (
						<li key={member.user_id} className="row member-row">
							<div className="row-main">
								<span>
									{member.name || member.user_id}
									{member.user_id === me.user_id && <span className="pill">{t("you")}</span>}
									{member.role === "admin" && <span className="pill accent">{t("Admin")}</span>}
									{member.user_status !== "active" && <span className="pill warn">{t("Account suspended")}</span>}
									{member.status !== "active" && <span className="pill warn">{t("Inactive")}</span>}
								</span>
								<span className="quiet">{member.user_id}</span>
							</div>
							<div className="row-actions member-actions">
								<select
									aria-label={t("Role")}
									value={member.role}
									onChange={async (event) => {
										const next = event.target.value as Role;
										if (next === "admin" || (await confirm({ title: t("Remove admin rights?"), body: t("They keep their membership, and lose this page."), action: t("Change") })))
											change.mutate({ user: member.user_id, role: next });
									}}
								>
									<option value="member">{t("Member")}</option>
									<option value="admin">{t("Admin")}</option>
								</select>
								<select aria-label={t("Unit")} value={member.org_unit_id ?? ""} onChange={(event) => place.mutate({ user: member.user_id, manager_user_id: member.manager_user_id ?? "", org_unit_id: event.target.value })}>
									<option value="">{t("No unit")}</option>
									{tree.map(({ unit, depth }) => (
										<option key={unit.id} value={unit.id}>
											{"  ".repeat(depth)}
											{unit.name}
										</option>
									))}
								</select>
								<select aria-label={t("Reports to")} value={member.manager_user_id ?? ""} onChange={(event) => place.mutate({ user: member.user_id, manager_user_id: event.target.value, org_unit_id: member.org_unit_id ?? "" })}>
									<option value="">{t("No manager")}</option>
									{managers.map((other) => (
										<option key={other.user_id} value={other.user_id}>
											{other.name || other.user_id}
											{other.status !== "active" ? ` (${t("left")})` : ""}
										</option>
									))}
								</select>
								<button type="button" className="ghost small" disabled={member.status !== "active"} onClick={() => setRolesFor(member)}>
									<ShieldCheck size={14} aria-hidden="true" />
									{t("Roles")}
								</button>
								<button type="button" className="ghost small" onClick={() => reset.mutate(member)}>
									<KeyRound size={14} aria-hidden="true" />
									{t("Reset link")}
								</button>
								<button
									type="button"
									className={off ? "ghost small" : "ghost small danger-text"}
									disabled={member.user_id === me.user_id}
									onClick={async () => {
										const leaving = member.status === "active";
										if (
											!leaving ||
											(await confirm({ title: t("Remove {name} from this tenant?", { name: member.name || member.user_id }), body: t("They're signed out of it, and their running agents stop. You can add them back later."), action: t("Remove"), danger: true }))
										)
											change.mutate({ user: member.user_id, status: leaving ? "inactive" : "active" });
									}}
								>
									{member.status === "active" ? t("Remove") : t("Restore")}
								</button>
							</div>
						</li>
					);
				})}
			</ul>
			{limit < filtered.length && (
				<button type="button" className="ghost small load-more" onClick={() => setLimit((current) => current + PAGE_SIZE)}>
					{t("Load more")}
				</button>
			)}
			{link !== undefined && <OneTimeLink {...link} onClose={() => setLink(undefined)} />}
			{rolesFor !== undefined && <MemberRoles member={rolesFor} onClose={() => setRolesFor(undefined)} />}
		</section>
	);
}

function Organization() {
	const { t } = useI18n();
	const { tenant } = useWorkspace();
	const { confirm } = useFeedback();
	const failed = useFailure();
	const client = useQueryClient();
	const units = useQuery({ queryKey: ["org", tenant, "units"], queryFn: () => listUnits(tenant) });
	const [draft, setDraft] = useState<{ name: string; kind: UnitKind; parent_id: string }>({ name: "", kind: "team", parent_id: "" });
	const refresh = () => void client.invalidateQueries({ queryKey: ["org", tenant] });
	const add = useMutation({
		mutationFn: () => createUnit(tenant, { name: draft.name.trim(), kind: draft.kind, ...(draft.parent_id === "" ? {} : { parent_id: draft.parent_id }) }),
		onSuccess: () => {
			setDraft({ ...draft, name: "" });
			refresh();
		},
		onError: failed,
	});
	const save = useMutation({ mutationFn: (unit: Unit) => updateUnit(tenant, unit), onSuccess: refresh, onError: failed });
	const remove = useMutation({ mutationFn: (id: string) => deleteUnit(tenant, id), onSuccess: refresh, onError: failed });
	if (units.isPending) return <Skeleton />;
	const tree = unitTree(units.data ?? []);
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (draft.name.trim() !== "") add.mutate();
	};
	const kinds = (
		<>
			<option value="department">{t("Department")}</option>
			<option value="team">{t("Team")}</option>
		</>
	);
	return (
		<section className="admin-section always">
			<p className="quiet">{t("Departments and teams decide who a manager sees, for modules that use them.")}</p>
			<form className="add-row" onSubmit={submit}>
				<input value={draft.name} maxLength={100} placeholder={t("New unit")} aria-label={t("New unit")} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
				<select aria-label={t("Kind")} value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as UnitKind })}>
					{kinds}
				</select>
				<select aria-label={t("Inside")} value={draft.parent_id} onChange={(event) => setDraft({ ...draft, parent_id: event.target.value })}>
					<option value="">{t("At the top")}</option>
					{tree.map(({ unit, depth }) => (
						<option key={unit.id} value={unit.id}>
							{"  ".repeat(depth)}
							{unit.name}
						</option>
					))}
				</select>
				<button type="submit" className="primary" disabled={draft.name.trim() === "" || add.isPending}>
					<Plus size={15} aria-hidden="true" />
					{t("Add")}
				</button>
			</form>
			{tree.length === 0 && <Empty icon={Building2} title={t("No units yet.")} />}
			<ul className="rows">
				{tree.map(({ unit, depth }) => (
					<li key={unit.id} className="row" style={{ paddingInlineStart: `${0.75 + depth * 1.25}rem` }}>
						<div className="row-main">
							<input
								className="unit-name"
								defaultValue={unit.name}
								aria-label={t("Name")}
								maxLength={100}
								onBlur={(event) => {
									const name = event.target.value.trim();
									if (name !== "" && name !== unit.name) save.mutate({ ...unit, name });
								}}
							/>
						</div>
						<div className="row-actions">
							<select aria-label={t("Kind")} value={unit.kind} onChange={(event) => save.mutate({ ...unit, kind: event.target.value as UnitKind })}>
								{kinds}
							</select>
							<select aria-label={t("Inside")} value={unit.parent_id ?? ""} onChange={(event) => save.mutate({ ...unit, parent_id: event.target.value })}>
								<option value="">{t("At the top")}</option>
								{tree
									.filter((other) => other.unit.id !== unit.id)
									.map((other) => (
										<option key={other.unit.id} value={other.unit.id}>
											{"  ".repeat(other.depth)}
											{other.unit.name}
										</option>
									))}
							</select>
							<button
								type="button"
								className="icon-button"
								aria-label={t("Remove {name}", { name: unit.name })}
								onClick={async () => {
									if (await confirm({ title: t("Remove {name}?", { name: unit.name }), action: t("Remove"), danger: true })) remove.mutate(unit.id);
								}}
							>
								<Trash2 size={15} aria-hidden="true" />
							</button>
						</div>
					</li>
				))}
			</ul>
		</section>
	);
}

/** The settings of modules that join a built-in tab, above the tab's own content. */
function JoinedSettings({ tab }: { tab: AdminTab }) {
	const joined = useModules().filter((module) => module.admin !== undefined && "joins" in module.admin && module.admin.joins === tab);
	if (joined.length === 0) return null;
	return (
		<section className="admin-section always">
			{joined.map(({ id, admin }) => admin !== undefined && <admin.Settings key={id} />)}
		</section>
	);
}

function Agents() {
	const { t, ago } = useI18n();
	const { tenant } = useWorkspace();
	const { confirm } = useFeedback();
	const failed = useFailure();
	const client = useQueryClient();
	const grants = useQuery({ queryKey: ["org", tenant, "grants"], queryFn: () => listGrants(tenant) });
	const stop = useMutation({ mutationFn: (id: string) => revokeGrant(tenant, id), onSuccess: () => void client.invalidateQueries({ queryKey: ["org", tenant, "grants"] }), onError: failed });
	const running = (grants.data ?? []).filter((grant) => grant.running);
	return (
		<section className="admin-section always">
			<h2>{t("Agents working now")}</h2>
			<p className="quiet">{t("Each one acts for a person, with only what they allowed. Stopping one also stops what it started.")}</p>
			{grants.isPending && <Skeleton />}
			{grants.isSuccess && running.length === 0 && <Empty icon={Sparkles} title={t("No agent is working for anyone right now.")} />}
			<ul className="rows">
				{running.map((grant) => (
					<li key={grant.id} className="row">
						<span className="row-icon accent">
							<Sparkles size={16} aria-hidden="true" />
						</span>
						<div className="row-main">
							<span>{t("{agent} for {person}", { agent: grant.runtime_id, person: grant.who || grant.user_id })}</span>
							<span className="quiet">
								{grant.actions.join(", ")} · {t("started {when}", { when: ago(Date.parse(grant.created_at)) })}
							</span>
						</div>
						<button
							type="button"
							className="ghost small danger-text"
							onClick={async () => {
								if (await confirm({ title: t("Stop this agent?"), body: t("It can't act for them again until they start a new conversation or call."), action: t("Stop"), danger: true })) stop.mutate(grant.id);
							}}
						>
							<Square size={13} aria-hidden="true" />
							{t("Stop")}
						</button>
					</li>
				))}
			</ul>
		</section>
	);
}

function Security() {
	const { t } = useI18n();
	const { tenant } = useWorkspace();
	const { confirm } = useFeedback();
	const failed = useFailure();
	const client = useQueryClient();
	const info = useQuery({ queryKey: ["org", tenant, "tenant"], queryFn: () => getTenant(tenant) });
	const mfa = useMutation({ mutationFn: (required: boolean) => setRequireMFA(tenant, required), onSuccess: () => void client.invalidateQueries({ queryKey: ["org", tenant, "tenant"] }), onError: failed });
	return (
		<section className="admin-section always">
			<div className="card">
				<Setting title={t("Require a second factor")} hint={t("Members without an authenticator can't use this tenant until they turn one on.")}>
					<label className="switch">
						<span className="sr-only">{t("Require a second factor")}</span>
						<input
							type="checkbox"
							role="switch"
							checked={info.data?.require_mfa ?? false}
							disabled={info.data === undefined || mfa.isPending}
							onChange={async (event) => {
								const required = event.target.checked;
								if (!required || (await confirm({ title: t("Require a second factor?"), body: t("Anyone without one is signed out of this tenant at their next refresh."), action: t("Require") }))) mfa.mutate(required);
							}}
						/>
						<span aria-hidden="true" />
					</label>
				</Setting>
			</div>
		</section>
	);
}

function Activity() {
	const { t, ago } = useI18n();
	const nameOf = useMemberName();
	const { tenant } = useWorkspace();
	const records = useQuery({ queryKey: ["org", tenant, "audit"], queryFn: () => listAudit(tenant) });
	if (records.isPending) return <Skeleton />;
	return (
		<section className="admin-section always">
			<p className="quiet">{t("The latest changes to this tenant's people, organization and agents.")}</p>
			{records.data?.length === 0 && <Empty icon={History} title={t("Nothing yet.")} />}
			<ul className="rows">
				{(records.data ?? []).map((record, index) => (
					<li key={`${record.at}-${index}`} className="row">
						<div className="row-main">
							<span>
								<code>{record.action}</code>
								{record.outcome !== "success" && <span className="pill warn">{t("Refused")}</span>}
							</span>
							<span className="quiet">
								{nameOf(record.actor)} · {record.target} · {ago(Date.parse(record.at))}
							</span>
						</div>
					</li>
				))}
			</ul>
		</section>
	);
}

/** The skills library, inside Administration; the same one as the Skills page. */
function AdminSkills() {
	const { agent: current } = useWorkspace();
	const [agent, setAgent] = useState(current);
	return (
		<section className="admin-section always">
			<SkillsLibrary agent={agent} onAgent={setAgent} />
		</section>
	);
}
