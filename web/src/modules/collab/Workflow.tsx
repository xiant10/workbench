import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, ChevronRight, Plus, Route, Undo2, X } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../../lib/i18n.tsx";
import { Dialog, useFeedback } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { advanceItem, getList, type Item, putAtStage, removeWorkflow, setWorkflow, type Stage, type TaskList, type Workflow } from "./api.ts";
import { usePeople } from "./usePeople.ts";

/** The route on a list's page: its stages and who holds each, and for a list owner, the editor. */
export function ListWorkflow({ list, isOwner, onSaved }: { list: TaskList; isOwner: boolean; onSaved(): void }) {
	const { t } = useI18n();
	const { name } = usePeople();
	const [editing, setEditing] = useState(false);
	const workflow = list.workflow;
	if (workflow === undefined && !isOwner) return null;
	return (
		<section>
			<h2>{t("Workflow")}</h2>
			{workflow === undefined ? (
				<p className="quiet">{t("Give this list's tasks a route, such as Build, Review, Test and Approve. Each stage's holder passes a task on, or sends it back with what to fix.")}</p>
			) : (
				<>
					<StageBar stages={workflow.stages} />
					<p className="quiet">
						{t("A task that goes back more than {n} times goes to {lead}.", { n: workflow.rounds, lead: name(workflow.lead) })}
					</p>
				</>
			)}
			{isOwner && (
				<button type="button" className="ghost small" onClick={() => setEditing(true)}>
					<Route size={14} aria-hidden="true" />
					{t(workflow === undefined ? "Set up a workflow" : "Edit workflow")}
				</button>
			)}
			{editing && <WorkflowDialog list={list} onClose={() => setEditing(false)} onSaved={onSaved} />}
		</section>
	);
}

function StageBar({ stages, current }: { stages: Stage[]; current?: string }) {
	const { t } = useI18n();
	const { name } = usePeople();
	const at = stages.findIndex((stage) => stage.id === current);
	return (
		<ol className="stages">
			{stages.map((stage, index) => {
				const back = stages.find((other) => other.id === stage.on_changes);
				return (
					<li key={stage.id ?? index}>
						<span className={`stage${index === at ? " current" : at >= 0 && index < at ? " passed" : ""}`} aria-current={index === at ? "step" : undefined}>
							<strong>{stage.name}</strong> {name(stage.holder)}
						</span>
						{back !== undefined && (
							<span className="quiet stage-back" title={t("Changes go back to {stage}", { stage: back.name })}>
								<Undo2 size={12} aria-hidden="true" />
								{back.name}
							</span>
						)}
						{index < stages.length - 1 && <ChevronRight size={14} className="quiet" aria-hidden="true" />}
					</li>
				);
			})}
		</ol>
	);
}

type Draft = { id: string; name: string; holder: string; on_changes: string; guide: string };

/** A new stage is named here, as collab takes any stg_ ID, so a later new stage can already go back to it. */
const draftOf = (stage: Partial<Stage>): Draft => ({
	id: stage.id ?? `stg_${crypto.randomUUID().replaceAll("-", "")}`,
	name: stage.name ?? "",
	holder: stage.holder ?? "",
	on_changes: stage.on_changes ?? "",
	guide: stage.guide ?? "",
});

function WorkflowDialog({ list, onClose, onSaved }: { list: TaskList; onClose(): void; onSaved(): void }) {
	const { t, describe } = useI18n();
	const { confirm } = useFeedback();
	const { me } = useWorkspace();
	const { name } = usePeople();
	const members = list.members ?? [];
	const people = members.filter((member) => !member.user_id.startsWith("acc_"));
	const agents = members.filter((member) => member.user_id.startsWith("acc_"));
	const owners = people.filter((member) => member.role === "owner");
	const current = list.workflow;
	const [stages, setStages] = useState<Draft[]>(() => (current?.stages ?? []).map(draftOf));
	const [rounds, setRounds] = useState(current?.rounds ?? 3);
	const [lead, setLead] = useState(current?.lead ?? (owners.some((owner) => owner.user_id === me.user_id) ? me.user_id : (owners[0]?.user_id ?? "")));
	const change = (id: string, patch: Partial<Draft>) => setStages(stages.map((stage) => (stage.id === id ? { ...stage, ...patch } : stage)));
	const move = (from: number, to: number) => {
		const next = [...stages];
		const [moved] = next.splice(from, 1);
		next.splice(to, 0, moved as Draft);
		// A way back must point to a stage before, so moving a stage drops any that no longer does.
		setStages(next.map((stage, index) => (stage.on_changes !== "" && !next.slice(0, index).some((earlier) => earlier.id === stage.on_changes) ? { ...stage, on_changes: "" } : stage)));
	};
	const remove = (id: string) => setStages(stages.filter((stage) => stage.id !== id).map((stage) => (stage.on_changes === id ? { ...stage, on_changes: "" } : stage)));
	// A team's usual route, for the list's own members to hold.
	const template = () => {
		const builder = draftOf({ name: t("Build"), holder: agents[0]?.user_id ?? me.user_id });
		const review = { ...draftOf({ name: t("Review"), holder: agents[1]?.user_id ?? agents[0]?.user_id ?? me.user_id }), on_changes: builder.id };
		const test = { ...draftOf({ name: t("Test"), holder: agents[2]?.user_id ?? agents[1]?.user_id ?? me.user_id }), on_changes: builder.id };
		const approve = draftOf({ name: t("Approve"), holder: lead || me.user_id });
		setStages([builder, review, test, approve]);
	};
	const save = useMutation({
		mutationFn: () =>
			setWorkflow(list.id, {
				rounds,
				lead,
				stages: stages.map((stage) => ({
					id: stage.id,
					name: stage.name.trim(),
					holder: stage.holder,
					...(stage.on_changes === "" ? {} : { on_changes: stage.on_changes }),
					...(stage.guide.trim() === "" ? {} : { guide: stage.guide.trim() }),
				})),
			}),
		onSuccess: () => {
			onSaved();
			onClose();
		},
	});
	const end = useMutation({
		mutationFn: () => removeWorkflow(list.id),
		onSuccess: () => {
			onSaved();
			onClose();
		},
	});
	const askRemove = async () => {
		if (await confirm({ title: t("Remove this workflow?"), body: t("Its tasks stay with whoever holds them now."), action: t("Remove"), danger: true })) end.mutate();
	};
	const valid = stages.length > 0 && stages.every((stage) => stage.name.trim() !== "" && stage.holder !== "") && lead !== "";
	const error = save.error ?? end.error;
	return (
		<Dialog label={t("Workflow")} onClose={onClose}>
			<h2>{t("Workflow")}</h2>
			<p className="quiet">{t("Each stage's holder passes a task to the next stage, or sends it back to an earlier one with what to fix. Holders are this list's members; an agent teammate must take work from this list.")}</p>
			{stages.length === 0 && (
				<p>
					<button type="button" className="link" onClick={template}>
						{t("Start from Build, Review, Test, Approve")}
					</button>
				</p>
			)}
			<ol className="stage-editor">
				{stages.map((stage, index) => (
					<li key={stage.id} className="stage-edit">
						<label className="stage-name">
							{t("Stage {n}", { n: index + 1 })}
							<input value={stage.name} maxLength={60} placeholder={t("Name, such as Review")} onChange={(event) => change(stage.id, { name: event.target.value })} />
						</label>
						<span className="stage-tools">
							<button type="button" className="icon-button" aria-label={t("Move {name} up", { name: stage.name })} disabled={index === 0} onClick={() => move(index, index - 1)}>
								<ArrowUp size={14} aria-hidden="true" />
							</button>
							<button type="button" className="icon-button" aria-label={t("Move {name} down", { name: stage.name })} disabled={index === stages.length - 1} onClick={() => move(index, index + 1)}>
								<ArrowDown size={14} aria-hidden="true" />
							</button>
							<button type="button" className="icon-button" aria-label={t("Remove {name}", { name: stage.name })} onClick={() => remove(stage.id)}>
								<X size={14} aria-hidden="true" />
							</button>
						</span>
						<label>
							{t("Held by")}
							<select value={stage.holder} onChange={(event) => change(stage.id, { holder: event.target.value })}>
								<option value="">{t("Choose…")}</option>
								{members.map((member) => (
									<option key={member.user_id} value={member.user_id}>
										{name(member.user_id)}
										{member.user_id.startsWith("acc_") ? ` · ${t("Agent")}` : ""}
									</option>
								))}
							</select>
						</label>
						<label>
							{t("Changes go back to")}
							<select value={stage.on_changes} disabled={index === 0} onChange={(event) => change(stage.id, { on_changes: event.target.value })}>
								<option value="">{t("None: it only passes")}</option>
								{stages.slice(0, index).map((earlier, at) => (
									<option key={earlier.id} value={earlier.id}>
										{earlier.name || t("Stage {n}", { n: at + 1 })}
									</option>
								))}
							</select>
						</label>
						<label className="stage-guide">
							{t("Guide for the holder")}
							<input value={stage.guide} maxLength={2000} placeholder={t("Optional, such as: run make e2e on the branch")} onChange={(event) => change(stage.id, { guide: event.target.value })} />
						</label>
					</li>
				))}
			</ol>
			<p>
				<button type="button" className="ghost small" disabled={stages.length >= 12} onClick={() => setStages([...stages, draftOf({})])}>
					<Plus size={14} aria-hidden="true" />
					{t("Add stage")}
				</button>
			</p>
			<div className="fields">
				<label>
					{t("Lead")}
					<select value={lead} onChange={(event) => setLead(event.target.value)}>
						{owners.map((owner) => (
							<option key={owner.user_id} value={owner.user_id}>
								{name(owner.user_id)}
							</option>
						))}
					</select>
				</label>
				<label>
					{t("Times a task may go back")}
					<input type="number" min={1} max={20} value={rounds} onChange={(event) => setRounds(Math.min(20, Math.max(1, Number(event.target.value) || 1)))} />
				</label>
			</div>
			<p className="outcome">{t("After that, or when a stage's holder has left the list, the task goes to the lead. A task leaves the workflow when someone sends it outside it; a list owner can put it back at any stage.")}</p>
			{error !== undefined && error !== null && <p className="inline-error" role="alert">{describe(error)}</p>}
			<div className="dialog-actions">
				{current !== undefined && (
					<button type="button" className="ghost danger-text" disabled={end.isPending} onClick={() => void askRemove()}>
						{t("Remove workflow")}
					</button>
				)}
				<span className="spacer" />
				<button type="button" className="ghost" onClick={onClose}>
					{t("Cancel")}
				</button>
				<button type="button" className="primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
					{t("Save")}
				</button>
			</div>
		</Dialog>
	);
}

/** Where a task stands on its list's workflow, and its holder's two ways on: pass, or send back with what to fix. */
export function TaskWorkflow({ item }: { item: Item }) {
	const { t, describe } = useI18n();
	const { toast } = useFeedback();
	const { me } = useWorkspace();
	const { name } = usePeople();
	const client = useQueryClient();
	const [fixing, setFixing] = useState(false);
	const [note, setNote] = useState("");
	const place = item.workflow;
	const list = useQuery({ queryKey: ["list", item.list_id], queryFn: () => getList(item.list_id as string), enabled: place !== undefined, retry: false, staleTime: 60_000 });
	const done = () => {
		setFixing(false);
		setNote("");
		void client.invalidateQueries({ queryKey: ["item", item.id] });
		void client.invalidateQueries({ queryKey: ["items"] });
		void client.invalidateQueries({ queryKey: ["events", item.id] });
	};
	const failed = (error: Error) => toast(describe(error));
	const advance = useMutation({ mutationFn: ({ result, text }: { result: "pass" | "changes"; text: string }) => advanceItem(item.id, result, text), onSuccess: done, onError: failed });
	const put = useMutation({ mutationFn: (stage?: string) => putAtStage(item.id, stage), onSuccess: done, onError: failed });
	if (place === undefined) return null;
	const workflow: Workflow = place.workflow;
	const closed = item.status === "done" || item.status === "cancelled";
	const holds = item.owners.includes(me.user_id);
	const listOwner = list.data?.members?.some((member) => member.user_id === me.user_id && member.role === "owner") ?? false;
	const stage = place.stage;
	const first = workflow.stages[0];
	const busy = advance.isPending || put.isPending;
	// A finished task's history says how it went; the bar is for work in progress.
	if (closed) return null;
	return (
		<section className="task-workflow" aria-label={t("Workflow")}>
			<StageBar stages={workflow.stages} current={stage?.id} />
			{stage !== null ? (
				<p className="quiet">
					{t("At {stage} with {name}.", { stage: stage.name, name: name(stage.holder) })}
					{place.rounds > 0 && ` ${t("Went back {n} of {max} times.", { n: place.rounds, max: workflow.rounds })}`}
					{stage.guide !== undefined && stage.guide !== "" && <span className="plain"> {stage.guide}</span>}
				</p>
			) : (
				<p className="quiet">{t("Not on this list's workflow.")}</p>
			)}
			<div className="row-actions">
				{stage !== null && holds && place.pass !== undefined && (
					<button type="button" className="primary small" disabled={busy} onClick={() => advance.mutate({ result: "pass", text: "" })}>
						<Check size={14} aria-hidden="true" />
						{place.pass.done ? t("Finish: mark done") : t("Pass to {stage}", { stage: place.pass.name ?? "" })}
					</button>
				)}
				{stage !== null && holds && place.changes !== undefined && !fixing && (
					<button type="button" className="ghost small" disabled={busy} onClick={() => setFixing(true)}>
						<Undo2 size={14} aria-hidden="true" />
						{place.changes.reason === "rounds" ? t("Send back: goes to {name}", { name: name(place.changes.to ?? "") }) : t("Send back to {stage}", { stage: place.changes.name ?? "" })}
					</button>
				)}
				{stage === null && first !== undefined && (holds || listOwner) && (
					<button type="button" className="primary small" disabled={busy} onClick={() => put.mutate(undefined)}>
						<Route size={14} aria-hidden="true" />
						{t("Start at {stage}", { stage: first.name })}
					</button>
				)}
				{listOwner && (
					<select className="compact" value="" aria-label={t("Put at a stage")} disabled={busy} onChange={(event) => event.target.value !== "" && put.mutate(event.target.value)}>
						<option value="">{t("Put at a stage…")}</option>
						{workflow.stages.map((each) => (
							<option key={each.id} value={each.id}>
								{each.name} · {name(each.holder)}
							</option>
						))}
					</select>
				)}
			</div>
			{fixing && (
				<form
					className="fix-note"
					onSubmit={(event) => {
						event.preventDefault();
						if (note.trim() !== "") advance.mutate({ result: "changes", text: note.trim() });
					}}
				>
					<label>
						{t("What needs fixing?")}
						<textarea rows={3} value={note} maxLength={2000} autoFocus onChange={(event) => setNote(event.target.value)} />
					</label>
					<div className="row-actions">
						<button type="button" className="ghost small" onClick={() => setFixing(false)}>
							{t("Cancel")}
						</button>
						<button type="submit" className="primary small" disabled={note.trim() === "" || busy}>
							{t("Send back")}
						</button>
					</div>
				</form>
			)}
		</section>
	);
}
