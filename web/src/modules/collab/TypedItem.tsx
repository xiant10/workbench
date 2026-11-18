import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../../lib/i18n.tsx";
import { Dialog, useFeedback } from "../../lib/ui.tsx";
import "./typed.css";
import { type Item, type ItemType, listTypes, type Move, type MoveResult, transitionItem, type TypeField, updateItem } from "./api.ts";

/**
 * A module's typed item, drawn from its type alone: the state, the fields in the type's order, and a button for each move
 * the reader may take. Nothing here names a module or a type, so a new module's items show with no change. Labels and
 * field titles are the module's own words, so they aren't translated here.
 */

export const TASK_TYPE = "collab.task";

/** The tenant's types. They change only when a module ships, so they're read rarely. */
export function useItemType(item: Item): ItemType | undefined {
	const typed = item.type !== undefined && item.type !== TASK_TYPE;
	const types = useQuery({ queryKey: ["item-types"], queryFn: listTypes, enabled: typed, staleTime: 5 * 60_000, retry: false });
	return typed ? types.data?.find((type) => type.id === item.type) : undefined;
}

/** A state's label, or its name for a state the type no longer declares. */
export const stateLabel = (type: ItemType | undefined, state: string) => type?.states?.[state]?.label ?? state;

const filled = (value: unknown) => value !== undefined && value !== null && value !== "";

/** The type's label and the item's state, in place of the status picker. */
export function TypedState({ item, type }: { item: Item; type: ItemType | undefined }) {
	const { t } = useI18n();
	return (
		<div className="typed-state">
			<span className="quiet">{type?.label ?? item.type}</span>
			{item.state !== undefined && (
				<span className={`pill ${item.status === "doing" || item.status === "done" ? item.status : ""}`} aria-label={t("State")}>
					{stateLabel(type, item.state)}
				</span>
			)}
		</div>
	);
}

/** One field's input, as its kind draws it. */
function FieldInput({ field, value, disabled, label, onChange }: { field: TypeField; value: unknown; disabled: boolean; label: string; onChange(value: unknown): void }) {
	const { t } = useI18n();
	if (field.enum !== undefined && field.enum.length > 0) {
		const at = field.enum.findIndex((option) => option === value);
		return (
			<select aria-label={label} value={at < 0 ? "" : String(at)} disabled={disabled} onChange={(event) => onChange(event.target.value === "" ? null : field.enum?.[Number(event.target.value)])}>
				<option value="">{t("Not set")}</option>
				{field.enum.map((option, index) => (
					<option key={String(option)} value={String(index)}>
						{String(option)}
					</option>
				))}
			</select>
		);
	}
	switch (field.type) {
		case "boolean":
			return <input type="checkbox" aria-label={label} checked={value === true} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />;
		case "integer":
		case "number":
			return (
				<input
					type="number"
					aria-label={label}
					step={field.type === "integer" ? 1 : "any"}
					value={typeof value === "number" ? value : ""}
					disabled={disabled}
					onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
				/>
			);
		default: {
			const max = field.maxLength ?? 2000;
			const text = typeof value === "string" ? value : "";
			return max > 200 ? (
				<textarea rows={3} aria-label={label} maxLength={max} value={text} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
			) : (
				<input aria-label={label} maxLength={max} value={text} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
			);
		}
	}
}

/**
 * The type's fields as labelled rows, in its order. Values an earlier version declared are shown, read-only. Changes save
 * together, apart from the task's own draft, since they're the module's record of the ask.
 */
export function TypedFields({ item, type, canEdit }: { item: Item; type: ItemType | undefined; canEdit: boolean }) {
	const { t, describe } = useI18n();
	const client = useQueryClient();
	const values = item.fields ?? {};
	const [changes, setChanges] = useState<Record<string, unknown>>({});
	const save = useMutation({
		mutationFn: () => updateItem(item.id, { version: item.version, fields: changes }),
		onSuccess: () => {
			setChanges({});
			void client.invalidateQueries({ queryKey: ["item", item.id] });
			void client.invalidateQueries({ queryKey: ["events", item.id] });
		},
	});
	if (type === undefined) return null;
	const order = type.fields.order.filter((key) => type.fields.properties[key] !== undefined);
	const kept = Object.keys(values).filter((key) => type.fields.properties[key] === undefined && filled(values[key]));
	if (order.length === 0 && kept.length === 0) return null;
	const value = (key: string) => (key in changes ? changes[key] : values[key]);
	const dirty = Object.keys(changes).length > 0;
	return (
		<div className="side-group">
			<h2>{t("Details")}</h2>
			<div className="fields">
				{order.map((key) => {
					const field = type.fields.properties[key] as TypeField;
					const label = field.title ?? key;
					return (
						<label key={key} className={field.type === "boolean" ? "check" : undefined}>
							{label}
							<FieldInput field={field} label={label} value={value(key)} disabled={!canEdit || save.isPending} onChange={(next) => setChanges({ ...changes, [key]: next === "" ? null : next })} />
						</label>
					);
				})}
				{kept.map((key) => (
					<div key={key} className="kept-field">
						<span>{key}</span>
						<span className="plain quiet">{String(values[key])}</span>
					</div>
				))}
			</div>
			{save.isError && (
				<p className="inline-error" role="alert">
					{describe(save.error)}
				</p>
			)}
			{canEdit && dirty && (
				<div className="row-actions">
					<button type="button" className="ghost small" disabled={save.isPending} onClick={() => setChanges({})}>
						{t("Discard")}
					</button>
					<button type="button" className="primary small" disabled={save.isPending} onClick={() => save.mutate()}>
						{t("Save details")}
					</button>
				</div>
			)}
		</div>
	);
}

/** A button for each move the reader may take now. A move that asks for nothing is taken at once. */
export function TypedMoves({ item, type }: { item: Item; type: ItemType | undefined }) {
	const { t, describe } = useI18n();
	const { toast } = useFeedback();
	const client = useQueryClient();
	const [open, setOpen] = useState<Move>();
	const take = useMutation({
		mutationFn: ({ move, note, payload }: { move: Move; note?: string; payload?: MoveResult }) =>
			transitionItem(item.id, { transition: move.id, note, payload, version: item.version }),
		onSuccess: () => {
			setOpen(undefined);
			void client.invalidateQueries({ queryKey: ["item", item.id] });
			void client.invalidateQueries({ queryKey: ["items"] });
			void client.invalidateQueries({ queryKey: ["events", item.id] });
		},
		onError: (error) => toast(describe(error)),
	});
	const moves = item.moves ?? [];
	if (moves.length === 0) return null;
	const asks = (move: Move) => move.note === "required" || (move.payload ?? []).length > 0;
	return (
		<>
			<div className="typed-moves" role="group" aria-label={t("Moves")}>
				{moves.map((move) => (
					<button key={move.id} type="button" className="ghost" disabled={take.isPending} onClick={() => (asks(move) ? setOpen(move) : take.mutate({ move }))}>
						{move.label ?? stateLabel(type, move.to)}
					</button>
				))}
			</div>
			{open !== undefined && <MoveDialog move={open} item={item} type={type} pending={take.isPending} onClose={() => setOpen(undefined)} onTake={(note, payload) => take.mutate({ move: open, note, payload })} />}
		</>
	);
}

/** What a move asks for: a note, and the result it carries, a reply and links. */
function MoveDialog({ move, item, type, pending, onClose, onTake }: { move: Move; item: Item; type: ItemType | undefined; pending: boolean; onClose(): void; onTake(note: string, payload: MoveResult | undefined): void }) {
	const { t } = useI18n();
	const [note, setNote] = useState("");
	const [reply, setReply] = useState("");
	const [links, setLinks] = useState<{ url: string; title: string }[]>([]);
	const allows = (key: "reply" | "links") => (move.payload ?? []).includes(key);
	const needs = (key: string) => (move.requires ?? []).includes(key);
	const title = move.label ?? stateLabel(type, move.to);
	// Fields a move requires are filled on the task itself, so the dialog only says which are missing.
	const missing = (move.requires ?? []).filter((key) => key !== "reply" && key !== "links" && !filled(item.fields?.[key]));
	const missingNames = missing.map((key) => type?.fields.properties[key]?.title ?? key).join(", ");
	const replyNeeded = needs("reply"), linksNeeded = needs("links"), noteNeeded = move.note === "required";
	const goodLinks = links.filter((link) => link.url.trim() !== "");
	const ready =
		missing.length === 0 &&
		(!noteNeeded || note.trim() !== "") &&
		(!replyNeeded || reply.trim() !== "") &&
		(!linksNeeded || goodLinks.length > 0) &&
		goodLinks.every((link) => link.url.trim().startsWith("https://"));
	const payload: MoveResult = { ...(reply.trim() !== "" ? { reply } : {}), ...(goodLinks.length > 0 ? { links: goodLinks.map((link) => ({ url: link.url.trim(), title: link.title.trim() })) } : {}) };
	return (
		<Dialog label={title} onClose={onClose}>
			<h2>{title}</h2>
			{missing.length > 0 && (
				<p className="inline-error" role="alert">
					{t("Fill in these details first: {fields}", { fields: missingNames })}
				</p>
			)}
			{allows("reply") && (
				<label>
					{t(replyNeeded ? "Result" : "Result (optional)")}
					<textarea rows={5} maxLength={10_000} value={reply} onChange={(event) => setReply(event.target.value)} />
				</label>
			)}
			{allows("links") && (
				<div className="move-links">
					<span>{t(linksNeeded ? "Links" : "Links (optional)")}</span>
					{links.map((link, index) => (
						<div key={index} className="move-link">
							<input aria-label={t("Link")} placeholder="https://" maxLength={2000} value={link.url} onChange={(event) => setLinks(links.map((each, at) => (at === index ? { ...each, url: event.target.value } : each)))} />
							<input aria-label={t("Link title")} placeholder={t("Title")} maxLength={200} value={link.title} onChange={(event) => setLinks(links.map((each, at) => (at === index ? { ...each, title: event.target.value } : each)))} />
							<button type="button" className="icon-button" aria-label={t("Remove link")} onClick={() => setLinks(links.filter((_, at) => at !== index))}>
								<X size={14} aria-hidden="true" />
							</button>
						</div>
					))}
					{links.length < 20 && (
						<button type="button" className="link" onClick={() => setLinks([...links, { url: "", title: "" }])}>
							<Plus size={14} aria-hidden="true" />
							{t("Add a link")}
						</button>
					)}
				</div>
			)}
			<label>
				{t(noteNeeded ? "Note" : "Note (optional)")}
				<input value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} />
			</label>
			<div className="dialog-actions">
				<button type="button" className="ghost" onClick={onClose}>
					{t("Cancel")}
				</button>
				<button type="button" className="primary" disabled={!ready || pending} onClick={() => onTake(note.trim(), Object.keys(payload).length > 0 ? payload : undefined)}>
					{title}
				</button>
			</div>
		</Dialog>
	);
}
