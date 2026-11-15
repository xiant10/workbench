import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bot, CircleAlert, Copy, KeyRound, LockKeyhole, Pause, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMemberName } from "../../admin/members.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { Dialog, Empty, Setting, Skeleton } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { workItemOf } from "../collab/api.ts";
import { runCause } from "../collab/events.ts";
import { PersonPicker } from "../collab/PersonPicker.tsx";
import { getAgentSettings } from "./api.ts";
import {
	createTeammate,
	EXTERNAL_ROLES,
	type ExternalRole,
	type Firing,
	finishTeammate,
	getIntake,
	getIntakeAutomation,
	getTeammate,
	type Intake,
	getTeammateHistory,
	intakeLists,
	listTeammates,
	newRunnerKey,
	partsOf,
	publishTeammateConfig,
	putIntake,
	removeTeammate,
	revokeRunnerKey,
	setTeammatePaused,
	type Teammate,
} from "./teammates.ts";

const MAX_TEXT = 32 * 1024;

/** The Teammates card on an agent's page: the teammates built on it, and a way to add one. */
export function TeammatesCard({ agent, title, external = false }: { agent: string; title: string; external?: boolean }) {
	const { t } = useI18n();
	const { path } = useWorkspace();
	const [adding, setAdding] = useState(false);
	const teammates = useQuery({ queryKey: ["teammates"], queryFn: listTeammates });
	const mine = (teammates.data ?? []).filter((one) => one.agent === agent && one.state !== "removed");
	return (
		<div className="card" data-testid="agent-teammates">
			<h2>{t("Agent teammates")}</h2>
			<p className="quiet">{t("Agents with their own place in the org, built on {agent}. People send them work as tasks, and they answer on the task.", { agent: title })}</p>
			{external && <p className="quiet">{t("{agent} runs outside t10: each teammate's work is done by a runner your team runs beside its code, with a runner key from the teammate's page.", { agent: title })}</p>}
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
					<Plus size={13} aria-hidden="true" /> {t("New agent teammate")}
				</button>
			</div>
			{adding && <NewTeammateDialog agent={agent} external={external} onClose={() => setAdding(false)} />}
		</div>
	);
}

function NewTeammateDialog({ agent, external, onClose }: { agent: string; external: boolean; onClose(): void }) {
	const { t } = useI18n();
	const { tenant, path } = useWorkspace();
	const navigate = useNavigate();
	const client = useQueryClient();
	const nameOf = useMemberName();
	const [title, setTitle] = useState("");
	const [manager, setManager] = useState("");
	const [instructions, setInstructions] = useState("");
	// An external teammate's agent has a shell beside the team's code, so only its manager sends it work until
	// someone opens it up.
	const [everyone, setEveryone] = useState(!external);
	const create = useMutation({
		mutationFn: () => createTeammate({ tenant, agent, title: title.trim(), manager, unit: "", instructions, everyone, external }),
		onSuccess: (made) => {
			void client.invalidateQueries({ queryKey: ["teammates"] });
			navigate(path(`teammates/${encodeURIComponent(made.id)}`));
		},
	});
	const ready = title.trim() !== "" && manager !== "" && !create.isPending;
	return (
		<Dialog label={t("New agent teammate")} onClose={onClose}>
			<h2>{t("New agent teammate")}</h2>
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
				<textarea rows={6} value={instructions} maxLength={MAX_TEXT} placeholder={t("What work it takes, what it declines, and how it works on a task.")} onChange={(event) => setInstructions(event.target.value)} data-testid="teammate-instructions" />
			</label>
			{external && (
				<div>
					<p className="quiet">
						{t("Start from a role:")}{" "}
						{(Object.keys(EXTERNAL_ROLES) as ExternalRole[]).map((role, i) => (
							<span key={role}>
								{i > 0 && " · "}
								<button type="button" className="link" onClick={() => setInstructions(EXTERNAL_ROLES[role])}>
									{{ builder: t("Builder"), reviewer: t("Reviewer"), tester: t("Tester") }[role]}
								</button>
							</span>
						))}
					</p>
					<p className="quiet">{t("Roles name the teammates they send work to, such as Reviewer. Change the names to your teammates'. With no instructions, it builds and sends the item back.")}</p>
				</div>
			)}
			<label className="with-label permission">
				<input type="checkbox" checked={everyone} onChange={(event) => setEveryone(event.target.checked)} />
				<span>{t("Anyone in the organization can send it work")}</span>
			</label>
			{external && <p className="quiet">{t("Its agent can run commands beside your code, so let only the people who own that code send it work.")}</p>}
			<p className="quiet">{t("It starts with no business roles, so it reads only the tasks it's on. Give it roles under Administration, People.")}</p>
			{create.isError && (
				<p className="error" role="alert">
					{t("It wasn't created fully. Open it under Agent teammates to finish.")}
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
	const settings = useQuery({ queryKey: ["agent-settings"], queryFn: getAgentSettings, enabled: isAdmin });
	const external = settings.data?.agents.find((entry) => entry.name === teammate?.agent)?.external === true;
	const refresh = () => {
		void client.invalidateQueries({ queryKey: ["teammate", id] });
		void client.invalidateQueries({ queryKey: ["teammate-parts"] });
		void client.invalidateQueries({ queryKey: ["teammates"] });
	};
	const finish = useMutation({ mutationFn: (t: Teammate) => finishTeammate(t, { everyone: false, notify: "", external }), onSuccess: refresh });
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
					<span className="quiet">
						{t("Built on {agent}", { agent: teammate.agent })}
						{external && ` · ${t("Runs outside t10")}`}
					</span>
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
			{!removed && automation?.target === "external" && <RunnerCard automation={automation.id} />}
			{!removed && <TeammateInstructions id={id} view={view.data} onPublished={refresh} />}
			{!removed && <WhoMaySend account={teammate.account} onSaved={refresh} />}
			<div className="card">
				<h2>{t("Recent runs")}</h2>
				{(firings.data?.firings ?? []).length === 0 ? (
					<p className="quiet">{t("Nothing yet. It runs when work reaches it.")}</p>
				) : (
					<ul className="plain-list">
						{firings.data!.firings.map((f) => (
							<li key={f.id}>
								<span className={f.state === "failed" ? "pill warn" : "pill"}>{f.state}</span> {new Date(f.scheduled_for).toLocaleString()}
								<RunCause firing={f} nameOf={nameOf} />
								{f.problem !== undefined && f.problem !== "" && <span className="quiet"> {f.problem}</span>}
								{/* Its conversation is its account's, which nobody opens directly: the task shows its work. */}
								{workItemOf(f.ref) !== undefined && (
									<span className="quiet">
										{" · "}
										<Link to={path(`tasks/${workItemOf(f.ref)}`)}>{t("Open task")}</Link>
									</span>
								)}
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

/** What woke an intake run: the event, who caused it, and how many agents passed the task on before it. */
function RunCause({ firing, nameOf }: { firing: Firing; nameOf(id: string): string }) {
	const { t } = useI18n();
	const kind = firing.event?.kind;
	if (kind === undefined) return null;
	return (
		<span className="quiet">
			{" · "}
			{runCause(kind, nameOf(firing.event?.actor ?? ""), t)}
			{(firing.hops ?? 0) > 0 && <> · {t("Hand-offs between agents before it: {count}", { count: firing.hops! })}</>}
		</span>
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

/**
 * Who may send the teammate work besides its manager: anyone, or the members of shared lists, such as a team's list,
 * so its people and agent teammates pass work along without opening it to everyone. Saving keeps any units set
 * outside Workbench.
 */
function WhoMaySend({ account, onSaved }: { account: string; onSaved(): void }) {
	const { t } = useI18n();
	const client = useQueryClient();
	const intake = useQuery({ queryKey: ["teammate-intake", account], queryFn: () => getIntake(account).catch(() => undefined) });
	const lists = useQuery({ queryKey: ["intake-lists"], queryFn: intakeLists });
	const current: Intake = intake.data ?? { user_id: account, everyone: false, units: [], lists: [] };
	const save = useMutation({
		mutationFn: (next: Partial<Intake>) => putIntake({ ...current, ...next, user_id: account }),
		onSuccess: () => {
			void client.invalidateQueries({ queryKey: ["teammate-intake", account] });
			onSaved();
		},
	});
	const nameOf = (id: string) => lists.data?.find((l) => l.id === id)?.name ?? t("A list that's gone");
	const addable = (lists.data ?? []).filter((l) => !l.archived && !current.lists.includes(l.id));
	return (
		<div className="card">
			<h2>{t("Who can send it work")}</h2>
			<label className="with-label permission">
				<input type="checkbox" checked={current.everyone} disabled={save.isPending || !intake.isFetched} onChange={(event) => save.mutate({ everyone: event.target.checked })} />
				<span>{t("Anyone in the organization")}</span>
			</label>
			{!current.everyone && (
				<div className="field">
					<span>{t("Members of these shared lists")}</span>
					{current.lists.length > 0 && (
						<p>
							{current.lists.map((id) => (
								<span key={id} className="chip">
									{nameOf(id)}{" "}
									<button type="button" className="link" disabled={save.isPending} aria-label={t("Remove {name}", { name: nameOf(id) })} onClick={() => save.mutate({ lists: current.lists.filter((l) => l !== id) })}>
										×
									</button>
								</span>
							))}
						</p>
					)}
					{addable.length > 0 && (
						<select value="" disabled={save.isPending} aria-label={t("Add a list")} onChange={(event) => event.target.value !== "" && save.mutate({ lists: [...current.lists, event.target.value] })}>
							<option value="">{t("Add a list…")}</option>
							{addable.map((l) => (
								<option key={l.id} value={l.id}>
									{l.name}
								</option>
							))}
						</select>
					)}
					<span className="quiet">{t("Such as your team's list: put its people and agent teammates on it, and they can pass work to each other.")}</span>
				</div>
			)}
			<p className="quiet">{t("Its manager can always give it work.")}</p>
			{save.isError && (
				<p className="error" role="alert">
					{t("It wasn't saved. Reload and try again.")}
				</p>
			)}
		</div>
	);
}

/**
 * An external teammate's runner: whether one is connected, the key it leases work with, and the command that starts
 * one. The runner calls out to this address, so it needs no open port. The key is shown once, when it's made. Making
 * a new one, or revoking it, cuts off the runner using the old one, so both ask first.
 */
function RunnerCard({ automation }: { automation: string }) {
	const { t, dateTime } = useI18n();
	const client = useQueryClient();
	const [shown, setShown] = useState("");
	const [asking, setAsking] = useState<"" | "replace" | "revoke">("");
	const [copied, setCopied] = useState("");
	// Polled, so the card turns to connected once someone starts a runner.
	const view = useQuery({ queryKey: ["teammate-firings", automation], queryFn: () => getIntakeAutomation(automation), refetchInterval: 30_000 });
	const key = view.data?.runner_key ?? null;
	const refresh = () => void client.invalidateQueries({ queryKey: ["teammate-firings", automation] });
	const make = useMutation({
		mutationFn: () => newRunnerKey(automation),
		onSuccess: (made) => {
			setShown(made.key);
			setAsking("");
			refresh();
		},
	});
	const revoke = useMutation({
		mutationFn: () => revokeRunnerKey(automation),
		onSuccess: () => {
			setShown("");
			setAsking("");
			refresh();
		},
	});
	const copy = (what: string, text: string) => {
		void navigator.clipboard?.writeText(text).then(() => {
			setCopied(what);
			window.setTimeout(() => setCopied(""), 2000);
		});
	};
	const command = [`T10_RUNNER_KEY=${shown === "" ? "<runner key>" : shown} \\`, `T10_URL=${window.location.origin} \\`, "t10-runner -repo <your repository>"].join("\n");
	const waiting = (view.data?.firings ?? []).filter((firing) => firing.state === "claimed").length;
	return (
		<div className="card" data-testid="teammate-runner">
			<h2>{t("Runner")}</h2>
			<p className="quiet">
				{t("Its work is done outside t10, by t10-runner on a machine your team chooses, next to the code. The runner connects to t10 at this address, so it needs no open port. It leases each task with this key, works on it in its own git branch, and answers on the task.")}
			</p>
			<Setting title={t("Connection")}>
				{key?.connected === true ? <span className="pill">{t("Connected")}</span> : <span className="pill warn">{t("Not connected")}</span>}
			</Setting>
			{key?.connected !== true && waiting > 0 && <p className="error">{t("Tasks waiting for a runner: {count}", { count: String(waiting) })}</p>}
			<Setting title={t("Runner key")}>
				{key === null ? (
					<span className="pill warn">{t("None")}</span>
				) : (
					<span className="quiet">
						{t("Made {when}", { when: dateTime(key.created_at) })}
						{" · "}
						{key.last_used_at === null ? t("not used yet") : t("last used {when}", { when: dateTime(key.last_used_at) })}
					</span>
				)}
			</Setting>
			{shown !== "" && (
				<div className="card warn" role="status">
					<p>{t("Copy the key now. It isn't shown again.")}</p>
					<code style={{ wordBreak: "break-all" }}>{shown}</code>
					<div className="row-actions">
						<button type="button" className="ghost small" onClick={() => copy("key", shown)}>
							<Copy size={13} aria-hidden="true" /> {copied === "key" ? t("Copied") : t("Copy")}
						</button>
					</div>
				</div>
			)}
			<div className="row-actions">
				<button type="button" className="ghost small" disabled={make.isPending} onClick={() => (key === null ? make.mutate() : setAsking("replace"))}>
					<KeyRound size={13} aria-hidden="true" /> {key === null ? t("Make a runner key") : t("Replace the key")}
				</button>
				{key !== null && (
					<button type="button" className="ghost small danger" disabled={revoke.isPending} onClick={() => setAsking("revoke")}>
						{t("Revoke the key")}
					</button>
				)}
			</div>
			<p className="quiet">{t("Start a runner with:")}</p>
			<pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{command}</pre>
			<div className="row-actions">
				<button type="button" className="ghost small" onClick={() => copy("command", command)}>
					<Copy size={13} aria-hidden="true" /> {copied === "command" ? t("Copied") : t("Copy the command")}
				</button>
			</div>
			<p className="quiet">
				{t("By default the agent may only edit files, commit, push its own branch and open a pull request. Add your build and test commands with -allow, such as -allow 'Bash(npm test:*)'.")}
			</p>
			<p className="quiet">{t("Run it where it can reach your repository and nothing it shouldn't. Pull requests it opens still need your team's review.")}</p>
			{asking !== "" && (
				<Dialog label={asking === "replace" ? t("Replace the runner key?") : t("Revoke the runner key?")} onClose={() => setAsking("")}>
					<h2>{asking === "replace" ? t("Replace the runner key?") : t("Revoke the runner key?")}</h2>
					<p>
						{asking === "replace"
							? t("The runner using the current key stops getting work. Start it again with the new key.")
							: t("The runner using it stops getting work, and the teammate's tasks wait until you make a new key.")}
					</p>
					{key?.connected === true && <p className="error">{t("A runner is connected now. A task it's working on is stopped.")}</p>}
					<div className="dialog-actions">
						<button type="button" onClick={() => setAsking("")}>
							{t("Cancel")}
						</button>
						{asking === "replace" ? (
							<button type="button" className="primary" disabled={make.isPending} onClick={() => make.mutate()}>
								{t("Replace the key")}
							</button>
						) : (
							<button type="button" className="primary danger" disabled={revoke.isPending} onClick={() => revoke.mutate()}>
								{t("Revoke the key")}
							</button>
						)}
					</div>
				</Dialog>
			)}
		</div>
	);
}
