import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useI18n } from "../lib/i18n.tsx";
import { Dialog, Empty, Skeleton, useFeedback } from "../lib/ui.tsx";
import { useWorkspace } from "../shell/workspace.ts";
import { assignRole, type BusinessRole, type Catalog, createRole, getCatalog, listAssignments, listRoles, type Member, type RoleAssignment, revokeAssignment, updateRole } from "./api.ts";
import { useFailure } from "./members.ts";
import { nameOf } from "./org.ts";

function useRoles() {
	const { tenant } = useWorkspace();
	const catalog = useQuery({ queryKey: ["org", tenant, "roles", "catalog"], queryFn: () => getCatalog(tenant) });
	const roles = useQuery({ queryKey: ["org", tenant, "roles", "list"], queryFn: () => listRoles(tenant) });
	return { catalog, roles };
}

/** The tenant's business roles. Each is a set of permissions from the modules deployed here; who holds one is set on People. */
export function Roles() {
	const { t } = useI18n();
	const { tenant } = useWorkspace();
	const failed = useFailure();
	const client = useQueryClient();
	const { catalog, roles } = useRoles();
	const [name, setName] = useState("");
	const [template, setTemplate] = useState("");
	const [editing, setEditing] = useState<string>();
	const add = useMutation({
		mutationFn: () => {
			const [module = "", id = ""] = template.split("/");
			return template === "" ? createRole(tenant, { name: name.trim(), permissions: [] }) : createRole(tenant, { template: { module, id }, ...(name.trim() === "" ? {} : { name: name.trim() }) });
		},
		onSuccess: (role) => {
			setName("");
			setTemplate("");
			void client.invalidateQueries({ queryKey: ["org", tenant, "roles"] });
			setEditing(role.id);
		},
		onError: failed,
	});
	if (catalog.isPending || roles.isPending) return <Skeleton />;
	const modules = catalog.data?.modules ?? [];
	const list = roles.data ?? [];
	const open = list.find((role) => role.id === editing);
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (name.trim() !== "" || template !== "") add.mutate();
	};
	return (
		<section className="admin-section always">
			<p className="quiet">{t("A role is a set of permissions from this tenant's modules. Its name grants nothing: only Admin opens this page.")}</p>
			{modules.length === 0 && list.length === 0 ? (
				<Empty icon={ShieldCheck} title={t("No module here uses roles yet.")} />
			) : (
				<form className="add-row" onSubmit={submit}>
					<input value={name} maxLength={100} placeholder={t("New role")} aria-label={t("New role")} onChange={(event) => setName(event.target.value)} />
					<select aria-label={t("Start from")} value={template} onChange={(event) => setTemplate(event.target.value)}>
						<option value="">{t("No template")}</option>
						{modules.flatMap((module) =>
							module.templates.map((item) => (
								<option key={`${module.id}/${item.id}`} value={`${module.id}/${item.id}`}>
									{module.id}: {item.name}
								</option>
							)),
						)}
					</select>
					<button type="submit" className="primary" disabled={(name.trim() === "" && template === "") || add.isPending}>
						<Plus size={15} aria-hidden="true" />
						{t("Add")}
					</button>
				</form>
			)}
			<ul className="rows">
				{list.map((role) => (
					<li key={role.id} className="row">
						<div className="row-main">
							<span>
								{role.name}
								{!role.enabled && <span className="pill warn">{t("Off")}</span>}
								{role.enabled && !role.active && <span className="pill warn">{t("Grants nothing here")}</span>}
								{role.unavailable.length > 0 && role.active && <span className="pill">{t("Some permissions unavailable")}</span>}
								{role.template?.latest_version !== undefined && <span className="pill accent">{t("Template updated")}</span>}
							</span>
							<span className="quiet">
								{t("Permissions: {count}", { count: String(role.permissions.length) })} · {t("Held by: {count}", { count: String(role.assignments) })}
							</span>
						</div>
						<button type="button" className="ghost small" onClick={() => setEditing(role.id)}>
							{t("Edit")}
						</button>
					</li>
				))}
			</ul>
			{open !== undefined && catalog.data !== undefined && <RoleEditor key={`${open.id}-${open.revision}`} role={open} catalog={catalog.data} onClose={() => setEditing(undefined)} />}
		</section>
	);
}

/** One role's name, state and permissions. Saving sends the revision it opened with, so it can't overwrite someone else's change. */
function RoleEditor({ role, catalog, onClose }: { role: BusinessRole; catalog: Catalog; onClose(): void }) {
	const { t } = useI18n();
	const { tenant } = useWorkspace();
	const failed = useFailure();
	const client = useQueryClient();
	const [name, setName] = useState(role.name);
	const [description, setDescription] = useState(role.description);
	const [enabled, setEnabled] = useState(role.enabled);
	const [held, setHeld] = useState(() => new Set(role.permissions));
	const save = useMutation({
		mutationFn: () => updateRole(tenant, role.id, { revision: role.revision, name: name.trim(), description, enabled, permissions: [...held].sort() }),
		onSuccess: () => {
			void client.invalidateQueries({ queryKey: ["org", tenant, "roles"] });
			onClose();
		},
		onError: failed,
	});
	const toggle = (key: string, on: boolean) =>
		setHeld((current) => {
			const next = new Set(current);
			if (on) next.add(key);
			else next.delete(key);
			return next;
		});
	const source = role.template === undefined ? undefined : catalog.modules.find((module) => module.id === role.template?.module)?.templates.find((item) => item.id === role.template?.id);
	const gone = catalog.unavailable.filter((item) => role.unavailable.includes(item.key));
	return (
		<Dialog label={t("Edit role")} onClose={onClose} wide>
			<h2>{t("Edit role")}</h2>
			<div className="dialog-body role-editor">
				<label>
					{t("Name")}
					<input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
				</label>
				<label>
					{t("Description")}
					<textarea value={description} maxLength={500} rows={2} onChange={(event) => setDescription(event.target.value)} />
				</label>
				<label className="with-label">
					<input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
					{t("On. When it's off, no one holding it gets its permissions.")}
				</label>
				{role.template?.latest_version !== undefined && source !== undefined && (
					<p className="banner">
						{t("Its template has changed since this role was made from it. Nothing changes until you choose.")}{" "}
						<button type="button" className="ghost small" onClick={() => setHeld(new Set(source.permissions))}>
							{t("Use the template's permissions")}
						</button>
					</p>
				)}
				{catalog.modules.map((module) => {
					const shown = module.permissions.filter((permission) => permission.lifecycle === "active" || (permission.lifecycle === "deprecated" && held.has(permission.key)));
					return (
						<fieldset key={module.id} className="permission-group">
							<legend>{module.id}</legend>
							{shown.map((permission) => (
								<label key={permission.key} className="with-label permission">
									<input type="checkbox" checked={held.has(permission.key)} onChange={(event) => toggle(permission.key, event.target.checked)} />
									<span>
										{permission.description || permission.key} <code>{permission.key}</code>
										{permission.lifecycle === "deprecated" && <span className="pill warn">{t("Being retired")}</span>}
									</span>
								</label>
							))}
						</fieldset>
					);
				})}
				{gone.length > 0 && (
					<fieldset className="permission-group">
						<legend>{t("Not available here")}</legend>
						<p className="quiet">{t("These grant nothing now. Keep them for when the module comes back, or clear them.")}</p>
						{gone.map((item) => (
							<label key={item.key} className="with-label permission">
								<input type="checkbox" checked={held.has(item.key)} onChange={(event) => toggle(item.key, event.target.checked)} />
								<span>
									{item.description || item.key} <code>{item.key}</code>
									<span className="pill">{item.reason === "retired" ? t("Retired") : t("Module not deployed")}</span>
								</span>
							</label>
						))}
					</fieldset>
				)}
			</div>
			<div className="dialog-actions">
				<button type="button" className="ghost" onClick={onClose}>
					{t("Cancel")}
				</button>
				<button type="button" className="primary" disabled={name.trim() === "" || save.isPending} onClick={() => save.mutate()}>
					{t("Save")}
				</button>
			</div>
		</Dialog>
	);
}

/** Which roles one person holds in this tenant. Removing one ends it at once in every module. */
export function MemberRoles({ member, onClose }: { member: Member; onClose(): void }) {
	const { t } = useI18n();
	const { tenant } = useWorkspace();
	const { confirm } = useFeedback();
	const failed = useFailure();
	const client = useQueryClient();
	const { roles } = useRoles();
	const assignments = useQuery({ queryKey: ["org", tenant, "roles", "member", member.user_id], queryFn: () => listAssignments(tenant, member.user_id) });
	const [pick, setPick] = useState("");
	const refresh = () => void client.invalidateQueries({ queryKey: ["org", tenant, "roles"] });
	const give = useMutation({
		mutationFn: () => assignRole(tenant, member.user_id, pick),
		onSuccess: () => {
			setPick("");
			refresh();
		},
		onError: failed,
	});
	const take = useMutation({ mutationFn: (assignment: RoleAssignment) => revokeAssignment(tenant, member.user_id, assignment), onSuccess: refresh, onError: failed });
	const label = nameOf(member);
	const current = (assignments.data ?? []).filter((assignment) => assignment.status === "active");
	const offered = (roles.data ?? []).filter((role) => role.enabled && !current.some((assignment) => assignment.role_id === role.id));
	return (
		<Dialog label={t("Roles for {name}", { name: label })} onClose={onClose}>
			<h2>{t("Roles for {name}", { name: label })}</h2>
			<div className="dialog-body">
				{assignments.isPending ? (
					<Skeleton rows={2} />
				) : (
					<ul className="rows" data-empty={t("No roles yet.")}>
						{current.map((assignment) => (
							<li key={assignment.id} className="row">
								<div className="row-main">
									<span>{assignment.role_name}</span>
								</div>
								<button
									type="button"
									className="icon-button"
									aria-label={t("Remove {name}", { name: assignment.role_name })}
									onClick={async () => {
										if (await confirm({ title: t("Remove {role} from {name}?", { role: assignment.role_name, name: label }), body: t("They lose its permissions at once, in every module."), action: t("Remove"), danger: true }))
											take.mutate(assignment);
									}}
								>
									<Trash2 size={15} aria-hidden="true" />
								</button>
							</li>
						))}
					</ul>
				)}
				{offered.length > 0 && (
					<div className="add-row">
						<select aria-label={t("Role")} value={pick} onChange={(event) => setPick(event.target.value)}>
							<option value="">{t("Choose a role")}</option>
							{offered.map((role) => (
								<option key={role.id} value={role.id}>
									{role.name}
								</option>
							))}
						</select>
						<button type="button" className="primary" disabled={pick === "" || give.isPending} onClick={() => give.mutate()}>
							<Plus size={15} aria-hidden="true" />
							{t("Give role")}
						</button>
					</div>
				)}
			</div>
			<div className="dialog-actions">
				<button type="button" className="primary" onClick={onClose}>
					{t("Done")}
				</button>
			</div>
		</Dialog>
	);
}
