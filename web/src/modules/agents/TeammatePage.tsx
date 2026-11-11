import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bot, CircleAlert, LockKeyhole, Pause, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMemberName } from "../../admin/members.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { Dialog, Empty, Setting, Skeleton } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { PersonPicker } from "../collab/PersonPicker.tsx";
import {
	createTeammate,
	finishTeammate,
	getIntakeAutomation,
	getTeammate,
	getTeammateHistory,
	listTeammates,
	partsOf,
	publishTeammateConfig,
	putIntake,
	removeTeammate,
	setTeammatePaused,
	type Teammate,
} from "./teammates.ts";

const MAX_TEXT = 32 * 1024;

/** The Teammates card on an agent's page: the teammates built on it, and a way to add one. */
export function TeammatesCard({ agent, title }: { agent: string; title: string }) {
	const { t } = useI18n();
	const { path } = useWorkspace();
	const [adding, setAdding] = useState(false);
	const teammates = useQuery({ queryKey: ["teammates"], queryFn: listTeammates });
	const mine = (teammates.data ?? []).filter((one) => one.agent === agent && one.state !== "removed");
	return (
		<div className="card" data-testid="agent-teammates">
			<h2>{t("Teammates")}</h2>
			<p className="quiet">{t("Agents with their own place in the org, built on {agent}. People send them work as tasks, and they answer on the task.", { agent: title })}</p>
			{teammates.isLoading && <Skeleton rows={2} />}
			{mine.length > 0 && (
				<ul className="plain-list">
					{mine.map((one) => (
						<li key={one.id}>
							<Link to={path(`teammates/${encodeURIComponent(one.id)}`)}>
								<Bot size={14} aria-hidden="true" /> {one.title}
							</Link>
							{one.state === "paused" && <span className="pill warn">{t("Paused")}</span>}
						</li>
					))}
				</ul>
			)}
			<div className="row-actions">
				<button type="button" className="button ghost small" onClick={() => setAdding(true)}>
					<Plus size={13} aria-hidden="true" /> {t("New teammate")}
				</button>
			</div>
			{adding && <NewTeammateDialog agent={agent} onClose={() => setAdding(false)} />}
		</div>
	);
}

function NewTeammateDialog({ agent, onClose }: { agent: string; onClose(): void }) {
	const { t } = useI18n();
	const { tenant, path } = useWorkspace();
	const navigate = useNavigate();
	const client = useQueryClient();
	const nameOf = useMemberName();
	const [title, setTitle] = useState("");
	const [manager, setManager] = useState("");
	const [instructions, setInstructions] = useState("");
	const [everyone, setEveryone] = useState(true);
	const create = useMutation({
		mutationFn: () => createTeammate({ tenant, agent, title: title.trim(), manager, unit: "", instructions, everyone }),
		onSuccess: (made) => {
			void client.invalidateQueries({ queryKey: ["teammates"] });
			navigate(path(`teammates/${encodeURIComponent(made.id)}`));
		},
	});
	const ready = title.trim() !== "" && manager !== "" && !create.isPending;
	return (
		<Dialog label={t("New teammate")} onClose={onClose}>
			<h2>{t("New teammate")}</h2>
			<label className="field">
				<span>{t("Name")}</span>
				<input value={title} maxLength={100} placeholder={t("Such as Lead desk")} onChange={(event) => setTitle(event.target.value)} />
			</label>
			<div className="field">
				<span>{t("Manager")}</span>
				{manager === "" ? (
					<PersonPicker label={t("Manager")} exclude={[]} onPick={setManager} />
				) : (
					<p>
						{nameOf(manager)}{" "}
						<button type="button" className="link" onClick={() => setManager("")}>
							{t("Change")}
						</button>
					</p>
				)}
				<span className="quiet">{t("They answer for its work: it sends them what it can't finish, and they can approve what it does.")}</span>
			</div>
			<label className="field">
				<span>{t("Instructions")}</span>
				<textarea rows={6} value={instructions} maxLength={MAX_TEXT} placeholder={t("What work it takes, what it declines, and how it works on a task.")} onChange={(event) => setInstructions(event.target.value)} />
			</label>
			<label className="check">
				<input type="checkbox" checked={everyone} onChange={(event) => setEveryone(event.target.checked)} />
				<span>{t("Anyone in the organization can send it work")}</span>
			</label>
			<p className="quiet">{t("It starts with no business roles, so it reads only the tasks it's on. Give it roles under Administration, People.")}</p>
			{create.isError && (
				<p className="error" role="alert">
					{t("It wasn't created fully. Open it under Teammates to finish.")}
				</p>
			)}
			<div className="dialog-actions">
				<button type="button" onClick={onClose}>
					{t("Cancel")}
				</button>
				<button type="button" className="primary" disabled={!ready} onClick={() => create.mutate()}>
					{t("Create")}
				</button>
			</div>
		</Dialog>
	);
}

/** `/t/<tenant>/teammates/<id>`: one agent teammate: what it does, who may send it work, and what it did lately. */
export function TeammatePage() {
	const { id = "" } = useParams();
	const { t } = useI18n();
	const { isAdmin, path, tenant } = useWorkspace();
	const client = useQueryClient();
	const navigate = useNavigate();
	const nameOf = useMemberName();
	const view = useQuery({ queryKey: ["teammate", id], queryFn: () => getTeammate(id), enabled: isAdmin });
	const teammate = view.data?.teammate;
	const parts = useQuery({ queryKey: ["teammate-parts", teammate?.account], queryFn: () => partsOf(teammate!.account), enabled: teammate !== undefined });
	const automation = parts.data?.automation;
	const firings = useQuery({ queryKey: ["teammate-firings", automation?.id], queryFn: () => getIntakeAutomation(automation!.id), enabled: automation !== undefined });
	const refresh = () => {
		void client.invalidateQueries({ queryKey: ["teammate", id] });
		void client.invalidateQueries({ queryKey: ["teammate-parts"] });
		void client.invalidateQueries({ queryKey: ["teammates"] });
	};
	const finish = useMutation({ mutationFn: (t: Teammate) => finishTeammate(t, { everyone: false, notify: "" }), onSuccess: refresh });
	const pause = useMutation({ mutationFn: ({ t, paused }: { t: Teammate; paused: boolean }) => setTeammatePaused(t, paused), onSuccess: refresh });
	const [removing, setRemoving] = useState(false);
	const remove = useMutation({
		mutationFn: (t: Teammate) => removeTeammate(tenant, t),
		onSuccess: (_, t) => {
			refresh();
			navigate(path(`agents/${encodeURIComponent(t.agent)}`));
		},
	});

	if (!isAdmin) {
		return (
			<div className="page">
				<Empty icon={LockKeyhole} title={t("Only this tenant's admins can open this page.")} />
			</div>
		);
	}
	if (view.isError) {
		return (
			<div className="page">
				<Empty icon={Bot} title={t("No such teammate.")} />
			</div>
		);
	}
	if (teammate === undefined || view.data === undefined) {
		return (
			<div className="page">
				<Skeleton rows={6} />
			</div>
		);
	}
	const receiving = parts.data !== undefined && parts.data.automation !== undefined;
	const removed = teammate.state === "removed";
	return (
		<div className="page skill-page" data-testid="teammate-page">
			<Link to={path(`agents/${encodeURIComponent(teammate.agent)}`)} className="skills-back">
				<ArrowLeft size={14} aria-hidden="true" /> {t("Back to the agent")}
			</Link>
			<header className="skill-head">
				<div>
					<h1>
						<Bot size={20} aria-hidden="true" /> {teammate.title}
					</h1>
					<span className="quiet">{t("Built on {agent}", { agent: teammate.agent })}</span>
				</div>
				{!removed && (
					<div className="row-actions">
						<button type="button" className="button ghost small" disabled={pause.isPending} onClick={() => pause.mutate({ t: teammate, paused: teammate.state !== "paused" })}>
							{teammate.state === "paused" ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />} {teammate.state === "paused" ? t("Resume") : t("Pause")}
						</button>
						<button type="button" className="button ghost small danger" onClick={() => setRemoving(true)}>
							<Trash2 size={13} aria-hidden="true" /> {t("Remove")}
						</button>
					</div>
				)}
			</header>
			{parts.isSuccess && !receiving && !removed && (
				<div className="card warn" role="status">
					<p>
						<CircleAlert size={14} aria-hidden="true" /> {t("Not receiving work: it has no intake automation yet.")}
					</p>
					<button type="button" className="primary small" disabled={finish.isPending} onClick={() => finish.mutate(teammate)}>
						{t("Finish setting it up")}
					</button>
				</div>
			)}
			<div className="card">
				<h2>{t("Status")}</h2>
				<Setting title={t("State")}>
					<span className={teammate.state === "active" ? "pill" : "pill warn"}>{t(teammate.state === "active" ? "Active" : teammate.state === "paused" ? "Paused" : "Removed")}</span>
				</Setting>
				{automation?.notify_user !== undefined && automation.notify_user !== "" && <Setting title={t("Its notices go to")}>{nameOf(automation.notify_user)}</Setting>}
			</div>
			{!removed && <TeammateInstructions id={id} view={view.data} onPublished={refresh} />}
			{!removed && <WhoMaySend account={teammate.account} everyone={parts.data?.intake?.everyone === true} onSaved={refresh} />}
			<div className="card">
				<h2>{t("Recent runs")}</h2>
				{(firings.data?.firings ?? []).length === 0 ? (
					<p className="quiet">{t("Nothing yet. It runs when work reaches it.")}</p>
				) : (
					<ul className="plain-list">
						{firings.data!.firings.map((f) => (
							<li key={f.id}>
								<span className={f.state === "failed" ? "pill warn" : "pill"}>{f.state}</span> {new Date(f.scheduled_for).toLocaleString()}
								{f.problem !== undefined && f.problem !== "" && <span className="quiet"> {f.problem}</span>}
							</li>
						))}
					</ul>
				)}
			</div>
			{removing && (
				<Dialog label={t("Remove this teammate?")} onClose={() => setRemoving(false)}>
					<h2>{t("Remove this teammate?")}</h2>
					<p>{t("It stops running, its account leaves the organization, and its tasks move as anyone's do when they leave.")}</p>
					<div className="dialog-actions">
						<button type="button" onClick={() => setRemoving(false)}>
							{t("Cancel")}
						</button>
						<button type="button" className="primary danger" disabled={remove.isPending} onClick={() => remove.mutate(teammate)}>
							{t("Remove")}
						</button>
					</div>
				</Dialog>
			)}
		</div>
	);
}

function TeammateInstructions({ id, view, onPublished }: { id: string; view: Awaited<ReturnType<typeof getTeammate>>; onPublished(): void }) {
	const { t } = useI18n();
	const published = view.config.content.instructions ?? "";
	const [text, setText] = useState(published);
	const [reason, setReason] = useState("");
	const history = useQuery({ queryKey: ["teammate-history", id], queryFn: () => getTeammateHistory(id) });
	const publish = useMutation({
		mutationFn: () => publishTeammateConfig(id, { content: { ...view.config.content, instructions: text }, version: view.config.version, reason }),
		onSuccess: () => {
			setReason("");
			onPublished();
			void history.refetch();
		},
	});
	const changed = text !== published;
	return (
		<div className="card">
			<h2>{t("Instructions")}</h2>
			<p className="quiet">{t("What work it takes, what it declines, and how it works on a task. They come after its agent's own instructions, which win where the two conflict.")}</p>
			<textarea rows={8} value={text} maxLength={MAX_TEXT} onChange={(event) => setText(event.target.value)} aria-label={t("Instructions")} />
			{changed && (
				<div className="row-actions">
					<input value={reason} placeholder={t("Why you're changing it")} onChange={(event) => setReason(event.target.value)} aria-label={t("Why you're changing it")} />
					<button type="button" className="primary small" disabled={reason.trim() === "" || publish.isPending} onClick={() => publish.mutate()}>
						{t("Publish")}
					</button>
				</div>
			)}
			{publish.isError && (
				<p className="error" role="alert">
					{t("It wasn't published. Reload and try again.")}
				</p>
			)}
			<p className="quiet">{t("Version {version}, {count} in history.", { version: view.config.version, count: history.data?.length ?? 0 })}</p>
		</div>
	);
}

function WhoMaySend({ account, everyone, onSaved }: { account: string; everyone: boolean; onSaved(): void }) {
	const { t } = useI18n();
	const save = useMutation({ mutationFn: (open: boolean) => putIntake({ user_id: account, everyone: open, units: [], lists: [] }), onSuccess: onSaved });
	return (
		<div className="card">
			<h2>{t("Who can send it work")}</h2>
			<label className="check">
				<input type="checkbox" checked={everyone} disabled={save.isPending} onChange={(event) => save.mutate(event.target.checked)} />
				<span>{t("Anyone in the organization")}</span>
			</label>
			<p className="quiet">{t("Its manager can always give it work. With this off, nobody else can.")}</p>
		</div>
	);
}
