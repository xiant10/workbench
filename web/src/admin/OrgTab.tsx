import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Building2, ChevronDown, ChevronRight, CircleAlert, Crown, MoreHorizontal, Network, Pencil, Plus, Trash2, UserMinus, UserPlus, Users, UserRoundCog } from "lucide-react";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useI18n } from "../lib/i18n.tsx";
import { Avatar, Dialog, Empty, Menu, Segmented, Skeleton, useFeedback } from "../lib/ui.tsx";
import { useWorkspace } from "../shell/workspace.ts";
import { createUnit, deleteUnit, listMembers, listUnits, type Member, type Placement, setPlacements, type Unit, type UnitKind, unitTree, updateUnit } from "./api.ts";
import { useFailure } from "./members.ts";
import {
	activeManager,
	ancestry,
	buildOrg,
	defaultManager,
	followLead,
	headcount,
	isActive,
	loginOf,
	matches,
	membersOf,
	moveInto,
	nameOf,
	type Org,
	placementOf,
	reportingForest,
	subtree,
	TOP,
	teamSize,
	warningOf,
	wouldLoop,
} from "./org.ts";
import "./admin.css";

/** Units open this deep at first, and every level opens in a small organization. */
const OPEN_DEPTH = 1;
const SMALL_ORG = 40;
const SEARCH_RESULTS = 8;

type View = "units" | "lines";

type Picking =
	| { kind: "add"; unit: string }
	| { kind: "move"; users: string[] }
	| { kind: "manager"; users: string[] }
	| { kind: "lead"; unit: Unit }
	| { kind: "unit"; unit?: Unit; parent: string }
	| { kind: "move-unit"; unit: Unit };

/** The org chart in one place: units with their people and leads, and the reporting lines between people. */
export function Organization() {
	const { t } = useI18n();
	const { tenant } = useWorkspace();
	const { confirm, toast } = useFeedback();
	const failed = useFailure();
	const client = useQueryClient();
	const [params, setParams] = useSearchParams();
	const units = useQuery({ queryKey: ["org", tenant, "units"], queryFn: () => listUnits(tenant) });
	const members = useQuery({ queryKey: ["org", tenant, "members"], queryFn: () => listMembers(tenant) });
	const [view, setView] = useState<View>(params.get("view") === "lines" ? "lines" : "units");
	const [search, setSearch] = useState("");
	const [picking, setPicking] = useState<Picking>();
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const org = useMemo(() => buildOrg(units.data ?? [], members.data ?? []), [units.data, members.data]);
	const asked = params.get("unit") ?? TOP;
	const current = asked === TOP || org.units.has(asked) ? asked : TOP;

	const refresh = () => void client.invalidateQueries({ queryKey: ["org", tenant] });
	const select = (unit: string) => {
		setSelected(new Set());
		setParams((before) => {
			const next = new URLSearchParams(before);
			if (unit === TOP) next.delete("unit");
			else next.set("unit", unit);
			return next;
		});
	};
	const choose = (next: View) => {
		setView(next);
		setParams((before) => {
			const out = new URLSearchParams(before);
			if (next === "lines") out.set("view", "lines");
			else out.delete("view");
			return out;
		});
	};

	// Every change to people's places goes through here, and can be undone from its notice.
	const place = useMutation({
		mutationFn: async ({ placements, before }: { placements: Placement[]; done: string; before?: () => Promise<unknown>; revert?: () => Promise<unknown> }) => {
			await before?.();
			const changed = placements.filter((next) => {
				const member = org.members.get(next.user_id);
				return member === undefined || member.org_unit_id !== (next.org_unit_id || undefined) || (member.manager_user_id ?? "") !== next.manager_user_id;
			});
			const undo = changed.flatMap((next) => {
				const member = org.members.get(next.user_id);
				return member === undefined ? [] : [placementOf(member)];
			});
			if (changed.length > 0) await setPlacements(tenant, changed);
			return undo;
		},
		onSuccess: (undo, { done, revert }) => {
			refresh();
			setSelected(new Set());
			const back = async () => {
				if (undo.length > 0) await setPlacements(tenant, [...undo].reverse());
				await revert?.();
			};
			toast(done, undo.length === 0 && revert === undefined ? undefined : { label: t("Undo"), run: () => void back().then(refresh, failed) });
		},
		onError: (error: Error) => {
			refresh();
			failed(error);
		},
	});
	const saveUnit = useMutation({ mutationFn: (unit: Unit) => updateUnit(tenant, unit), onSuccess: refresh, onError: failed });
	const addUnit = useMutation({
		mutationFn: (unit: Omit<Unit, "id">) => createUnit(tenant, unit),
		onSuccess: (unit) => {
			refresh();
			select(unit.id);
		},
		onError: failed,
	});
	const dropUnit = useMutation({
		mutationFn: ({ unit, moveUp }: { unit: Unit; moveUp: boolean }) => deleteUnit(tenant, unit.id, moveUp),
		onSuccess: (_, { unit }) => {
			refresh();
			select(unit.parent_id ?? TOP);
		},
		onError: failed,
	});

	if (units.isPending || members.isPending) return <Skeleton />;

	const remove = async (unit: Unit) => {
		const people = membersOf(org, unit.id).length;
		const inside = org.children.get(unit.id)?.length ?? 0;
		const parent = unit.parent_id === undefined ? undefined : org.units.get(unit.parent_id);
		const inUse = people + inside > 0;
		const body = !inUse
			? undefined
			: parent === undefined
				? t("Its {people} people will have no unit, and its {units} units move to the top.", { people: String(people), units: String(inside) })
				: t("Its {people} people and {units} units move to {parent}.", { people: String(people), units: String(inside), parent: parent.name });
		if (await confirm({ title: t("Delete {name}?", { name: unit.name }), ...(body === undefined ? {} : { body }), action: inUse ? t("Move them and delete") : t("Delete"), danger: true })) dropUnit.mutate({ unit, moveUp: inUse });
	};

	const actions: UnitActions = {
		select,
		pick: setPicking,
		remove: (unit) => void remove(unit),
		retype: (unit) => saveUnit.mutate({ ...unit, kind: unit.kind === "team" ? "department" : "team" }),
		place: (placements, done) => place.mutate({ placements, done }),
	};

	return (
		<section className="admin-section always org">
			<div className="org-bar">
				<Segmented<View>
					label={t("View")}
					value={view}
					options={[
						{ value: "units", label: t("Units") },
						{ value: "lines", label: t("Reporting lines") },
					]}
					onChange={choose}
				/>
				<input type="search" className="org-search" value={search} placeholder={t("Find a person or unit")} aria-label={t("Find a person or unit")} onChange={(event) => setSearch(event.target.value)} />
			</div>
			{view === "units" ? (
				<div className="org-split">
					<UnitTree org={org} current={current} search={search} actions={actions} />
					<UnitDetail key={current} org={org} unitId={current} selected={selected} setSelected={setSelected} actions={actions} />
				</div>
			) : (
				<ReportingLines org={org} search={search} onManager={(user) => setPicking({ kind: "manager", users: [user] })} onUnit={(unit) => {
					choose("units");
					select(unit);
				}} />
			)}
			{picking?.kind === "add" && (
				<AddPeople
					org={org}
					unitId={picking.unit}
					onClose={() => setPicking(undefined)}
					onPick={(users, toLead) => place.mutate({ placements: moveInto(org, users, picking.unit, toLead), done: t("Added to {unit}.", { unit: org.units.get(picking.unit)?.name ?? "" }) })}
				/>
			)}
			{picking?.kind === "move" && (
				<UnitPicker
					org={org}
					title={t("Move to")}
					topLabel={t("No unit")}
					leadChoice
					onClose={() => setPicking(undefined)}
					onPick={(unit, toLead) => place.mutate({ placements: moveInto(org, picking.users, unit, toLead), done: unit === TOP ? t("Taken out of their unit.") : t("Moved to {unit}.", { unit: org.units.get(unit)?.name ?? "" }) })}
				/>
			)}
			{picking?.kind === "move-unit" && (
				<UnitPicker
					org={org}
					title={t("Move {name} into", { name: picking.unit.name })}
					topLabel={t("At the top")}
					exclude={subtree(org, picking.unit.id)}
					onClose={() => setPicking(undefined)}
					onPick={(parent) => saveUnit.mutate({ ...picking.unit, ...(parent === TOP ? { parent_id: "" } : { parent_id: parent }) })}
				/>
			)}
			{picking?.kind === "manager" && <ManagerPicker org={org} users={picking.users} onClose={() => setPicking(undefined)} onPick={(manager) => place.mutate({ placements: picking.users.flatMap((id) => {
				const member = org.members.get(id);
				return member === undefined ? [] : [{ ...placementOf(member), manager_user_id: manager }];
			}), done: t("Manager changed.") })} />}
			{picking?.kind === "lead" && (
				<LeadPicker
					org={org}
					unit={picking.unit}
					onClose={() => setPicking(undefined)}
					onPick={(lead, report) => {
						const next = { ...picking.unit, ...(lead === "" ? { lead_user_id: "" } : { lead_user_id: lead }) };
						if (lead === "") return saveUnit.mutate(next);
						const after = buildOrg([...org.units.values()].map((unit) => (unit.id === next.id ? next : unit)), [...org.members.values()]);
						place.mutate({ placements: followLead(after, next.id, lead, report), done: t("{name} leads {unit}.", { name: nameOf(org.members.get(lead)), unit: next.name }), before: () => updateUnit(tenant, next), revert: () => updateUnit(tenant, picking.unit) });
					}}
				/>
			)}
			{picking?.kind === "unit" && (
				<UnitForm
					org={org}
					{...(picking.unit === undefined ? {} : { unit: picking.unit })}
					parent={picking.parent}
					onClose={() => setPicking(undefined)}
					onSave={(name, kind) => (picking.unit === undefined ? addUnit.mutate({ name, kind, ...(picking.parent === TOP ? {} : { parent_id: picking.parent }) }) : saveUnit.mutate({ ...picking.unit, name, kind }))}
				/>
			)}
		</section>
	);
}

type UnitActions = {
	select(unit: string): void;
	pick(picking: Picking): void;
	remove(unit: Unit): void;
	retype(unit: Unit): void;
	place(placements: Placement[], done: string): void;
};

function UnitTree({ org, current, search, actions }: { org: Org; current: string; search: string; actions: UnitActions }) {
	const { t } = useI18n();
	const small = org.units.size <= SMALL_ORG;
	const [toggled, setToggled] = useState<Set<string>>(new Set());
	const q = search.trim().toLowerCase();
	// While searching, only matching units and those above them show, all open.
	const shown = useMemo(() => {
		if (q === "") return undefined;
		const out = new Set<string>();
		for (const unit of org.units.values()) if (unit.name.toLowerCase().includes(q)) for (const above of ancestry(org, unit.id)) out.add(above.id);
		return out;
	}, [org, q]);
	const people = q === "" ? [] : org.active.filter((member) => matches(member, q)).slice(0, SEARCH_RESULTS);
	const unplaced = membersOf(org, TOP).length;
	const open = (unit: Unit, depth: number) => shown !== undefined || (small || depth < OPEN_DEPTH) !== toggled.has(unit.id);
	const toggle = (id: string) => setToggled((before) => {
		const next = new Set(before);
		if (!next.delete(id)) next.add(id);
		return next;
	});

	const branch = (parent: string, depth: number): ReactNode => {
		const list = (org.children.get(parent) ?? []).filter((unit) => shown === undefined || shown.has(unit.id));
		if (list.length === 0) return null;
		return (
			<ul role={depth === 0 ? "tree" : "group"} aria-label={depth === 0 ? t("Units") : undefined}>
				{list.map((unit) => {
					const kids = (org.children.get(unit.id) ?? []).length > 0;
					const expanded = kids && open(unit, depth);
					return (
						<li key={unit.id} role="treeitem" aria-expanded={kids ? expanded : undefined} aria-selected={current === unit.id}>
							<div className={current === unit.id ? "org-node active" : "org-node"} style={{ paddingInlineStart: `${0.3 + depth * 1}rem` }}>
								<button type="button" className="org-twist" tabIndex={-1} aria-hidden="true" disabled={!kids} onClick={() => toggle(unit.id)}>
									{kids && (expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
								</button>
								<button type="button" className="org-node-name" onClick={() => actions.select(unit.id)}>
									{unit.kind === "department" ? <Building2 size={14} aria-hidden="true" /> : <Users size={14} aria-hidden="true" />}
									<span>{unit.name}</span>
									<span className="org-count" aria-label={t("{n} people", { n: String(headcount(org, unit.id)) })}>
										{headcount(org, unit.id)}
									</span>
								</button>
								<button type="button" className="icon-button org-node-add" aria-label={t("Add a unit inside {name}", { name: unit.name })} onClick={() => actions.pick({ kind: "unit", parent: unit.id })}>
									<Plus size={14} aria-hidden="true" />
								</button>
							</div>
							{expanded && branch(unit.id, depth + 1)}
						</li>
					);
				})}
			</ul>
		);
	};

	return (
		<nav className="org-tree" aria-label={t("Units")}>
			{people.length > 0 && (
				<div className="org-found">
					<h2>{t("People")}</h2>
					{people.map((member) => (
						<button key={member.user_id} type="button" className="org-node-name" onClick={() => actions.select(member.org_unit_id ?? TOP)}>
							<Avatar name={nameOf(member)} size={20} />
							<span>
								{nameOf(member)}
								<Login member={member} />
							</span>
							<span className="quiet">{member.org_unit_name ?? t("No unit")}</span>
						</button>
					))}
					{shown !== undefined && shown.size > 0 && <h2>{t("Units")}</h2>}
				</div>
			)}
			{org.units.size === 0 ? <p className="quiet org-hint">{t("No units yet. Start with a department, then add teams inside it.")}</p> : branch(TOP, 0)}
			{shown !== undefined && shown.size === 0 && people.length === 0 && <p className="quiet org-hint">{t("Nothing matches.")}</p>}
			<div className={current === TOP ? "org-node unplaced active" : "org-node unplaced"}>
				<button type="button" className="org-node-name" onClick={() => actions.select(TOP)}>
					{unplaced > 0 ? <CircleAlert size={14} aria-hidden="true" /> : <Users size={14} aria-hidden="true" />}
					<span>{t("Not in a unit")}</span>
					<span className="org-count">{unplaced}</span>
				</button>
			</div>
			<button type="button" className="ghost small org-new" onClick={() => actions.pick({ kind: "unit", parent: TOP })}>
				<Plus size={14} aria-hidden="true" />
				{t("New department")}
			</button>
		</nav>
	);
}

function UnitDetail({ org, unitId, selected, setSelected, actions }: { org: Org; unitId: string; selected: Set<string>; setSelected(next: Set<string>): void; actions: UnitActions }) {
	const { t } = useI18n();
	const unit = org.units.get(unitId);
	const people = membersOf(org, unitId).sort((a, b) => Number(b.user_id === unit?.lead_user_id) - Number(a.user_id === unit?.lead_user_id) || Number(isActive(b)) - Number(isActive(a)) || nameOf(a).localeCompare(nameOf(b)));
	const children = org.children.get(unitId) ?? [];
	const lead = unit?.lead_user_id === undefined ? undefined : org.members.get(unit.lead_user_id);
	const path = ancestry(org, unitId).slice(1).reverse();
	const chosen = [...selected].filter((id) => people.some((member) => member.user_id === id));
	const all = people.length > 0 && chosen.length === people.length;
	const toggle = (id: string, on: boolean) => {
		const next = new Set(selected);
		if (on) next.add(id);
		else next.delete(id);
		setSelected(next);
	};

	return (
		<div className="org-detail">
			<header className="org-head">
				{path.length > 0 && (
					<nav className="org-path" aria-label={t("Above {name}", { name: unit?.name ?? "" })}>
						{path.map((above) => (
							<button key={above.id} type="button" className="link" onClick={() => actions.select(above.id)}>
								{above.name}
							</button>
						))}
					</nav>
				)}
				<div className="org-title">
					<h3>{unit?.name ?? t("Not in a unit")}</h3>
					{unit !== undefined && <span className="pill">{unit.kind === "department" ? t("Department") : t("Team")}</span>}
					<span className="quiet">
						{unit === undefined ? t("{n} people", { n: String(people.length) }) : t("{n} people here, {total} with the units inside", { n: String(people.filter(isActive).length), total: String(headcount(org, unitId)) })}
					</span>
					{unit !== undefined && (
						<Menu label={t("Options for {name}", { name: unit.name })} triggerClass="icon-button org-more" trigger={<MoreHorizontal size={16} aria-hidden="true" />}>
							{(close) => {
								const item = (label: string, Icon: typeof Pencil, run: () => void, danger = false) => (
									<button type="button" className={danger ? "menu-danger" : ""} onClick={() => {
										close();
										run();
									}}>
										<Icon size={14} aria-hidden="true" />
										{label}
									</button>
								);
								return (
									<>
										{item(t("Rename"), Pencil, () => actions.pick({ kind: "unit", unit, parent: unit.parent_id ?? TOP }))}
										{item(t("Add a unit inside"), Plus, () => actions.pick({ kind: "unit", parent: unit.id }))}
										{item(t("Move to…"), ArrowRightLeft, () => actions.pick({ kind: "move-unit", unit }))}
										{item(unit.kind === "team" ? t("Make it a department") : t("Make it a team"), Building2, () => actions.retype(unit))}
										{item(t("Delete"), Trash2, () => actions.remove(unit), true)}
									</>
								);
							}}
						</Menu>
					)}
				</div>
				{unit === undefined && <p className="quiet">{t("People who aren't in a unit yet. Modules that show a manager their team can't see them there.")}</p>}
			</header>

			{unit !== undefined && (
				<div className="org-lead">
					<Crown size={15} aria-hidden="true" />
					{lead === undefined ? (
						<span className="quiet">{t("No lead. A lead is who people placed here report to.")}</span>
					) : (
						<span>
							{t("Lead")}: <strong>{nameOf(lead)}</strong>
							{!isActive(lead) && <span className="pill warn">{t("left")}</span>}
						</span>
					)}
					<button type="button" className="ghost small" onClick={() => actions.pick({ kind: "lead", unit })}>
						{lead === undefined ? t("Choose a lead") : t("Change")}
					</button>
				</div>
			)}

			{children.length > 0 && (
				<div className="org-children">
					{children.map((child) => (
						<button key={child.id} type="button" className="org-chip" onClick={() => actions.select(child.id)}>
							{child.kind === "department" ? <Building2 size={14} aria-hidden="true" /> : <Users size={14} aria-hidden="true" />}
							{child.name}
							<span className="org-count">{headcount(org, child.id)}</span>
						</button>
					))}
				</div>
			)}

			<div className="org-toolbar">
				<label className="with-label">
					<input type="checkbox" checked={all} disabled={people.length === 0} aria-label={t("Select everyone")} onChange={(event) => setSelected(new Set(event.target.checked ? people.map((member) => member.user_id) : []))} />
				</label>
				{chosen.length === 0 ? (
					unit !== undefined && (
						<button type="button" className="primary small" onClick={() => actions.pick({ kind: "add", unit: unitId })}>
							<UserPlus size={14} aria-hidden="true" />
							{t("Add people")}
						</button>
					)
				) : (
					<>
						<span className="quiet">{t("{n} selected", { n: String(chosen.length) })}</span>
						<button type="button" className="ghost small" onClick={() => actions.pick({ kind: "move", users: chosen })}>
							<ArrowRightLeft size={14} aria-hidden="true" />
							{t("Move to…")}
						</button>
						<button type="button" className="ghost small" onClick={() => actions.pick({ kind: "manager", users: chosen })}>
							<UserRoundCog size={14} aria-hidden="true" />
							{t("Set manager…")}
						</button>
						{unit !== undefined && (
							<button type="button" className="ghost small" onClick={() => actions.place(chosen.flatMap((id) => {
								const member = org.members.get(id);
								return member === undefined ? [] : [{ ...placementOf(member), org_unit_id: "" }];
							}), t("Taken out of {unit}.", { unit: unit.name }))}>
								<UserMinus size={14} aria-hidden="true" />
								{t("Take out of the unit")}
							</button>
						)}
					</>
				)}
			</div>

			{people.length === 0 ? (
				<Empty icon={Users} title={unit === undefined ? t("Everyone is in a unit.") : t("No one is in {name} yet.", { name: unit.name })} />
			) : (
				<ul className="rows org-people">
					{people.map((member) => {
						const manager = activeManager(org, member);
						const warning = warningOf(org, member);
						return (
							<li key={member.user_id} className={isActive(member) ? "row" : "row org-gone"}>
								<input type="checkbox" checked={selected.has(member.user_id)} aria-label={t("Select {name}", { name: nameOf(member) })} onChange={(event) => toggle(member.user_id, event.target.checked)} />
								<Avatar name={nameOf(member)} />
								<div className="row-main">
									<span>
										{nameOf(member)}
										<Login member={member} />
										{member.user_id === unit?.lead_user_id && <span className="pill accent">{t("Lead")}</span>}
										{member.kind === "agent" && <span className="pill">{t("Agent teammate")}</span>}
										{!isActive(member) && <span className="pill warn">{t("Inactive")}</span>}
									</span>
									<span className="quiet">
										{manager === undefined ? t("No manager") : t("Reports to {name}", { name: nameOf(manager) })}
										{warning === "manager_left" && <span className="pill warn">{t("Their manager left")}</span>}
										{warning === "outside_unit" && <span className="pill warn" title={t("Their manager isn't in this unit or a unit above it.")}>{t("Manager in another unit")}</span>}
									</span>
								</div>
								<Menu label={t("Options for {name}", { name: nameOf(member) })} triggerClass="icon-button" trigger={<MoreHorizontal size={16} aria-hidden="true" />}>
									{(close) => (
										<>
											<button type="button" onClick={() => {
												close();
												actions.pick({ kind: "manager", users: [member.user_id] });
											}}>
												<UserRoundCog size={14} aria-hidden="true" />
												{t("Change manager…")}
											</button>
											<button type="button" onClick={() => {
												close();
												actions.pick({ kind: "move", users: [member.user_id] });
											}}>
												<ArrowRightLeft size={14} aria-hidden="true" />
												{t("Move to…")}
											</button>
											{unit !== undefined && unit.lead_user_id !== member.user_id && isActive(member) && (
												<button type="button" onClick={() => {
													close();
													actions.pick({ kind: "lead", unit });
												}}>
													<Crown size={14} aria-hidden="true" />
													{t("Make lead…")}
												</button>
											)}
										</>
									)}
								</Menu>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

/** The sign-in name beside someone's own name, when it differs. */
function Login({ member }: { member: Member }) {
	const login = loginOf(member);
	return login === undefined ? null : <span className="org-login">{login}</span>;
}

/** One person among many, found by name: the list a picker shows. */
function PersonList({ people, multiple, chosen, onChoose, note }: { people: Member[]; multiple: boolean; chosen: Set<string>; onChoose(next: Set<string>): void; note?(member: Member): ReactNode }) {
	const { t } = useI18n();
	const [search, setSearch] = useState("");
	const q = search.trim().toLowerCase();
	const shown = people.filter((member) => q === "" || matches(member, q)).slice(0, 200);
	return (
		<>
			<input type="search" value={search} placeholder={t("Search")} aria-label={t("Search")} onChange={(event) => setSearch(event.target.value)} />
			<ul className="org-pick" role="listbox" aria-multiselectable={multiple}>
				{shown.length === 0 && <li className="quiet org-hint">{t("Nothing matches.")}</li>}
				{shown.map((member) => (
					<li key={member.user_id}>
						<label className={chosen.has(member.user_id) ? "org-option active" : "org-option"}>
							<input
								type={multiple ? "checkbox" : "radio"}
								name="person"
								checked={chosen.has(member.user_id)}
								onChange={(event) => {
									const next = new Set(multiple ? chosen : []);
									if (event.target.checked) next.add(member.user_id);
									else next.delete(member.user_id);
									onChoose(next);
								}}
							/>
							<Avatar name={nameOf(member)} size={22} />
							<span>
								{nameOf(member)}
								<Login member={member} />
							</span>
							<span className="quiet">{note?.(member)}</span>
						</label>
					</li>
				))}
			</ul>
		</>
	);
}

function PickerDialog({ title, hint, onClose, onSubmit, disabled, action, children }: { title: string; hint?: string; onClose(): void; onSubmit(): void; disabled: boolean; action: string; children: ReactNode }) {
	const { t } = useI18n();
	return (
		<Dialog label={title} onClose={onClose} className="dialog org-dialog">
			<form
				onSubmit={(event: FormEvent) => {
					event.preventDefault();
					if (disabled) return;
					onSubmit();
					onClose();
				}}
			>
				<h2>{title}</h2>
				{hint !== undefined && <p className="quiet">{hint}</p>}
				{children}
				<div className="dialog-actions">
					<button type="button" className="ghost" onClick={onClose}>
						{t("Cancel")}
					</button>
					<button type="submit" className="primary" disabled={disabled}>
						{action}
					</button>
				</div>
			</form>
		</Dialog>
	);
}

function AddPeople({ org, unitId, onClose, onPick }: { org: Org; unitId: string; onClose(): void; onPick(users: string[], toLead: boolean): void }) {
	const { t } = useI18n();
	const [chosen, setChosen] = useState<Set<string>>(new Set());
	const lead = defaultManager(org, unitId, "");
	const [toLead, setToLead] = useState(true);
	const unit = org.units.get(unitId);
	const people = org.active.filter((member) => member.org_unit_id !== unitId).sort((a, b) => Number(a.org_unit_id !== undefined) - Number(b.org_unit_id !== undefined) || nameOf(a).localeCompare(nameOf(b)));
	return (
		<PickerDialog title={t("Add people to {unit}", { unit: unit?.name ?? "" })} hint={t("People without a unit come first. Someone in another unit moves here.")} onClose={onClose} onSubmit={() => onPick([...chosen], toLead && lead !== undefined)} disabled={chosen.size === 0} action={chosen.size === 0 ? t("Add") : t("Add {n}", { n: String(chosen.size) })}>
			<PersonList people={people} multiple chosen={chosen} onChoose={setChosen} note={(member) => member.org_unit_name ?? t("No unit")} />
			{lead !== undefined && (
				<label className="with-label org-check">
					<input type="checkbox" checked={toLead} onChange={(event) => setToLead(event.target.checked)} />
					{t("They report to {name}", { name: nameOf(lead) })}
				</label>
			)}
		</PickerDialog>
	);
}

function ManagerPicker({ org, users, onClose, onPick }: { org: Org; users: string[]; onClose(): void; onPick(manager: string): void }) {
	const { t } = useI18n();
	const first = users.length === 1 ? org.members.get(users[0] ?? "") : undefined;
	const [chosen, setChosen] = useState<Set<string>>(new Set(first?.manager_user_id === undefined ? [] : [first.manager_user_id]));
	const [none, setNone] = useState(false);
	const moving = new Set(users);
	// Leads above them come first: they're who most people report to.
	const leads = new Set(users.flatMap((id) => ancestry(org, org.members.get(id)?.org_unit_id).flatMap((unit) => (unit.lead_user_id === undefined ? [] : [unit.lead_user_id]))));
	const people = org.active.filter((member) => !moving.has(member.user_id) && !users.some((id) => wouldLoop(org, id, member.user_id))).sort((a, b) => Number(leads.has(b.user_id)) - Number(leads.has(a.user_id)) || nameOf(a).localeCompare(nameOf(b)));
	const title = first === undefined ? t("Manager for {n} people", { n: String(users.length) }) : t("Manager for {name}", { name: nameOf(first) });
	return (
		<PickerDialog title={title} onClose={onClose} onSubmit={() => onPick(none ? "" : ([...chosen][0] ?? ""))} disabled={!none && chosen.size === 0} action={t("Save")}>
			<label className="with-label org-check">
				<input type="checkbox" checked={none} onChange={(event) => setNone(event.target.checked)} />
				{t("No manager")}
			</label>
			{!none && <PersonList people={people} multiple={false} chosen={chosen} onChoose={setChosen} note={(member) => [leads.has(member.user_id) ? t("Lead") : "", member.org_unit_name ?? ""].filter((part) => part !== "").join(" · ")} />}
		</PickerDialog>
	);
}

function LeadPicker({ org, unit, onClose, onPick }: { org: Org; unit: Unit; onClose(): void; onPick(lead: string, report: boolean): void }) {
	const { t } = useI18n();
	const [chosen, setChosen] = useState<Set<string>>(new Set(unit.lead_user_id === undefined ? [] : [unit.lead_user_id]));
	const [report, setReport] = useState(true);
	const people = [...org.active].sort((a, b) => Number(b.org_unit_id === unit.id) - Number(a.org_unit_id === unit.id) || nameOf(a).localeCompare(nameOf(b)));
	const lead = [...chosen][0] ?? "";
	return (
		<PickerDialog title={t("Lead of {unit}", { unit: unit.name })} hint={t("People in {unit} come first. A lead without a unit is placed here.", { unit: unit.name })} onClose={onClose} onSubmit={() => onPick(lead, report)} disabled={lead === ""} action={t("Save")}>
			<PersonList people={people} multiple={false} chosen={chosen} onChoose={setChosen} note={(member) => member.org_unit_name ?? t("No unit")} />
			<label className="with-label org-check">
				<input type="checkbox" checked={report} onChange={(event) => setReport(event.target.checked)} />
				{t("Everyone in {unit} reports to them", { unit: unit.name })}
			</label>
			{unit.lead_user_id !== undefined && (
				<button type="button" className="link org-clear" onClick={() => {
					onPick("", false);
					onClose();
				}}>
					{t("Remove the lead")}
				</button>
			)}
		</PickerDialog>
	);
}

function UnitPicker({ org, title, topLabel, exclude, leadChoice, onClose, onPick }: { org: Org; title: string; topLabel: string; exclude?: Set<string>; leadChoice?: boolean; onClose(): void; onPick(unit: string, toLead: boolean): void }) {
	const { t } = useI18n();
	const [search, setSearch] = useState("");
	const [chosen, setChosen] = useState<string>();
	const [toLead, setToLead] = useState(true);
	const q = search.trim().toLowerCase();
	const tree = unitTree([...org.units.values()]).filter(({ unit }) => !exclude?.has(unit.id) && (q === "" || unit.name.toLowerCase().includes(q)));
	const lead = chosen === undefined || chosen === TOP ? undefined : defaultManager(org, chosen, "");
	const option = (id: string, label: ReactNode, depth: number) => (
		<li key={id || "top"}>
			<label className={chosen === id ? "org-option active" : "org-option"} style={{ paddingInlineStart: `${0.5 + depth * 1}rem` }}>
				<input type="radio" name="unit" checked={chosen === id} onChange={() => setChosen(id)} />
				{label}
			</label>
		</li>
	);
	return (
		<PickerDialog title={title} onClose={onClose} onSubmit={() => chosen !== undefined && onPick(chosen, toLead)} disabled={chosen === undefined} action={t("Move")}>
			<input type="search" value={search} placeholder={t("Search")} aria-label={t("Search")} onChange={(event) => setSearch(event.target.value)} />
			<ul className="org-pick" role="listbox">
				{q === "" && option(TOP, <span className="quiet">{topLabel}</span>, 0)}
				{tree.map(({ unit, depth }) =>
					option(
						unit.id,
						<>
							{unit.kind === "department" ? <Building2 size={14} aria-hidden="true" /> : <Users size={14} aria-hidden="true" />}
							<span>{unit.name}</span>
						</>,
						q === "" ? depth : 0,
					),
				)}
				{tree.length === 0 && q !== "" && <li className="quiet org-hint">{t("Nothing matches.")}</li>}
			</ul>
			{leadChoice === true && lead !== undefined && (
				<label className="with-label org-check">
					<input type="checkbox" checked={toLead} onChange={(event) => setToLead(event.target.checked)} />
					{t("They report to {name}", { name: nameOf(lead) })}
				</label>
			)}
		</PickerDialog>
	);
}

function UnitForm({ org, unit, parent, onClose, onSave }: { org: Org; unit?: Unit; parent: string; onClose(): void; onSave(name: string, kind: UnitKind): void }) {
	const { t } = useI18n();
	const above = org.units.get(parent);
	const [name, setName] = useState(unit?.name ?? "");
	const [kind, setKind] = useState<UnitKind>(unit?.kind ?? (above === undefined ? "department" : "team"));
	const title = unit !== undefined ? t("Rename {name}", { name: unit.name }) : above === undefined ? t("New department") : t("New unit inside {name}", { name: above.name });
	return (
		<PickerDialog title={title} onClose={onClose} onSubmit={() => onSave(name.trim(), kind)} disabled={name.trim() === "" || (name.trim() === unit?.name && kind === unit.kind)} action={unit === undefined ? t("Add") : t("Save")}>
			<input value={name} maxLength={100} placeholder={t("Name")} aria-label={t("Name")} onChange={(event) => setName(event.target.value)} />
			<Segmented<UnitKind>
				label={t("Kind")}
				value={kind}
				options={[
					{ value: "department", label: t("Department") },
					{ value: "team", label: t("Team") },
				]}
				onChange={setKind}
			/>
		</PickerDialog>
	);
}

/** Who reports to whom, as a tree from the people at the top. */
function ReportingLines({ org, search, onManager, onUnit }: { org: Org; search: string; onManager(user: string): void; onUnit(unit: string): void }) {
	const { t } = useI18n();
	const { roots, reports } = useMemo(() => reportingForest(org), [org]);
	const small = org.active.length <= SMALL_ORG;
	const [toggled, setToggled] = useState<Set<string>>(new Set());
	const q = search.trim().toLowerCase();
	// While searching, only the matches and the people above them show.
	const shown = useMemo(() => {
		if (q === "") return undefined;
		const out = new Set<string>();
		for (const member of org.active) {
			if (!matches(member, q)) continue;
			for (let at: Member | undefined = member; at !== undefined && !out.has(at.user_id); at = activeManager(org, at)) out.add(at.user_id);
		}
		return out;
	}, [org, q]);
	const toggle = (id: string) => setToggled((before) => {
		const next = new Set(before);
		if (!next.delete(id)) next.add(id);
		return next;
	});
	const loose = roots.filter((member) => (reports.get(member.user_id) ?? []).length === 0);
	const tops = roots.filter((member) => (reports.get(member.user_id) ?? []).length > 0);

	const person = (member: Member, depth: number): ReactNode => {
		if (shown !== undefined && !shown.has(member.user_id)) return null;
		const below = reports.get(member.user_id) ?? [];
		const expanded = below.length > 0 && (shown !== undefined || (small || depth < OPEN_DEPTH) !== toggled.has(member.user_id));
		const warning = warningOf(org, member);
		return (
			<li key={member.user_id} role="treeitem" aria-expanded={below.length > 0 ? expanded : undefined}>
				<div className="org-person">
					<button type="button" className="org-twist" tabIndex={-1} aria-hidden="true" disabled={below.length === 0} onClick={() => toggle(member.user_id)}>
						{below.length > 0 && (expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
					</button>
					<Avatar name={nameOf(member)} size={26} />
					<div className="row-main">
						<span>
							<span className={q !== "" && matches(member, q) ? "org-match" : ""}>{nameOf(member)}</span>
							<Login member={member} />
						</span>
						<span className="quiet">
							{member.org_unit_id === undefined ? (
								t("No unit")
							) : (
								<button type="button" className="link" onClick={() => onUnit(member.org_unit_id ?? TOP)}>
									{member.org_unit_name}
								</button>
							)}
							{below.length > 0 && ` · ${t("{n} direct, {total} in all", { n: String(below.length), total: String(teamSize(reports, member.user_id)) })}`}
						</span>
					</div>
					{warning === "manager_left" && <span className="pill warn">{t("Their manager left")}</span>}
					{warning === "outside_unit" && <span className="pill warn" title={t("Their manager isn't in this unit or a unit above it.")}>{t("Manager in another unit")}</span>}
					<button type="button" className="ghost small" onClick={() => onManager(member.user_id)}>
						{t("Change manager…")}
					</button>
				</div>
				{expanded && <ul role="group">{below.map((report) => person(report, depth + 1))}</ul>}
			</li>
		);
	};

	if (org.active.length === 0) return <Empty icon={Network} title={t("No one here yet.")} />;
	return (
		<div className="org-lines">
			{tops.length === 0 && <p className="quiet">{t("No one reports to anyone yet. Choose a lead for each unit, and the people in it report to them.")}</p>}
			<ul role="tree" aria-label={t("Reporting lines")}>{tops.map((member) => person(member, 0))}</ul>
			{loose.length > 0 && (shown === undefined || loose.some((member) => shown.has(member.user_id))) && (
				<>
					<h2>{t("No manager and no reports")}</h2>
					<ul role="tree" aria-label={t("No manager and no reports")}>{loose.map((member) => person(member, 0))}</ul>
				</>
			)}
		</div>
	);
}
