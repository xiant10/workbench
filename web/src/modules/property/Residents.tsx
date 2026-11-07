import { useQuery } from "@tanstack/react-query";
import { Copy, Phone } from "lucide-react";
import { type FormEvent, useState } from "react";
import { postJSON, request } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { Dialog, useFeedback } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { useCommand } from "./Admin.tsx";
import { type Resident, root } from "./api.ts";

const CONSENT: Record<string, string> = { unknown: "Consent not recorded", granted: "Consent granted", refused: "Consent refused" };
const RELATIONS: Record<string, string> = { owner: "Property owner", tenant: "Tenant", family: "Family", other: "Other" };

/** Dialing and copying each ask the service, which rechecks and records it. */
function ContactButtons({ account, resident }: { account: string; resident: Resident }) {
	const { t } = useI18n();
	const { toast } = useFeedback();
	const number = (purpose: "dial" | "copy") => postJSON<{ phone: string }>(`${root}/residents/${encodeURIComponent(resident.id)}/contact-access`, { account_id: account, purpose }).then((body) => body.phone);
	const fail = () => toast(t("You can't contact this resident right now."));
	return (
		<>
			<button type="button" onClick={() => void number("dial").then((phone) => { window.location.href = `tel:${phone}`; }, fail)}><Phone size={14} aria-hidden="true" /> {t("Call")}</button>
			<button type="button" onClick={() => void number("copy").then((phone) => navigator.clipboard.writeText(phone)).then(() => toast(t("Number copied")), fail)}><Copy size={14} aria-hidden="true" /> {t("Copy")}</button>
		</>
	);
}

/** One account's residents. A page that already has them passes `rows`, so a read isn't made and audited twice. */
export function Residents({ account, canWrite, admin, rows }: { account: string; canWrite: boolean; admin: boolean; rows?: Resident[] }) {
	const { t } = useI18n();
	const { tenant } = useWorkspace();
	const [editor, setEditor] = useState<{ kind: "resident" | "consent"; resident?: Resident }>();
	const cmd = useCommand();
	const query = useQuery({
		queryKey: ["property", tenant, "residents", account],
		queryFn: () => request<{ residents: Resident[] }>(`${root}/accounts/${encodeURIComponent(account)}/residents`),
		retry: false,
		gcTime: 0,
		enabled: rows === undefined,
	});
	const residents = rows ?? query.data?.residents;
	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (editor === undefined) return;
		const data = new FormData(event.currentTarget);
		const body: Record<string, unknown> = { account_id: account, id: editor.resident?.id ?? "", revision: editor.resident?.revision ?? 0 };
		for (const [key, value] of data) body[key] = value;
		if (editor.kind === "resident") body.main_contact = data.has("main_contact");
		if (await cmd.save(editor.kind, body, false)) setEditor(undefined);
	}
	const title = editor?.kind === "consent" ? t("Record consent") : editor?.resident !== undefined ? t("Edit resident") : t("Add resident");
	return (
		<div className="property-residents">
			<div className="property-section">
				<div>
					<h2>{t("Residents & consent")}</h2>
					<p>{t("A number shows when the resident has consented. Extended details and AI also need consent.")}</p>
				</div>
				{canWrite && <button type="button" onClick={() => setEditor({ kind: "resident" })}>{t("Add resident")}</button>}
			</div>
			{residents === undefined && query.isPending && <p role="status">{t("Loading…")}</p>}
			{residents === undefined && query.isError && <p role="alert">{t("Residents could not be loaded. Your access may have changed.")}</p>}
			{residents !== undefined && (
				<div className="property-access-list">
					{residents.map((resident) => (
						<div key={resident.id}>
							<div>
								<strong>{resident.name}</strong>
								<p>{t(RELATIONS[resident.relation] ?? "Other")} · {resident.main_contact ? t("Main contact") : t("Household member")}</p>
								<p>{t(CONSENT[resident.consent] ?? "Consent not recorded")}{resident.phone !== "" && ` · ${resident.phone}`}</p>
								{resident.identity !== "" && <p>{t("ID: {value}", { value: resident.identity })}</p>}
								{resident.plate !== "" && <p>{t("Vehicle: {value}", { value: resident.plate })}</p>}
							</div>
							<div className="property-form-actions">
								{resident.contactable && <ContactButtons account={account} resident={resident} />}
								{canWrite && <button type="button" onClick={() => setEditor({ kind: "resident", resident })}>{t("Edit resident")}</button>}
								{admin && <button type="button" onClick={() => setEditor({ kind: "consent", resident })}>{t("Record consent")}</button>}
							</div>
						</div>
					))}
					{residents.length === 0 && <p>{t("No residents registered for this account.")}</p>}
				</div>
			)}
			{editor !== undefined && (
				<Dialog label={title} onClose={cmd.busy ? undefined : () => setEditor(undefined)}>
					<form className="property-editor" onSubmit={(event) => void submit(event)}>
						<h2>{title}</h2>
						{editor.kind === "resident" ? (
							<>
								<label>{t("Resident name")}<input name="resident_name" required maxLength={160} defaultValue={editor.resident?.name ?? ""} /></label>
								<label>{t("Relationship")}
									<select name="relation" aria-label={t("Relationship")} defaultValue={editor.resident?.relation ?? "owner"}>
										{Object.entries(RELATIONS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
									</select>
								</label>
								<label className="property-check"><input type="checkbox" name="main_contact" defaultChecked={editor.resident?.main_contact ?? false} />{t("Main contact")}</label>
								<label>{t("Phone number")}<input name="phone" type="tel" maxLength={30} placeholder={t("Leave blank to keep the current number")} /></label>
								<p>{t("Phones are stored encrypted. Adding one doesn't grant contact or AI consent.")}</p>
							</>
						) : (
							<>
								<p>{t("Record the resident's decision and a reference to the offline evidence. Refusal hides extended details and the full number.")}</p>
								<label>{t("Consent decision")}
									<select name="consent" aria-label={t("Consent decision")} required defaultValue={editor.resident?.consent === "granted" ? "granted" : "refused"}>
										<option value="refused">{t("Refused")}</option>
										<option value="granted">{t("Granted")}</option>
									</select>
								</label>
								<label>{t("Offline evidence reference")}<input name="evidence_ref" required maxLength={160} placeholder={t("Signed form or offline record reference")} /></label>
							</>
						)}
						{cmd.error !== "" && <p role="alert" className="property-form-error">{t(cmd.error)}</p>}
						<div className="property-form-actions">
							<button type="button" disabled={cmd.busy} onClick={() => setEditor(undefined)}>{t("Cancel")}</button>
							<button type="submit" disabled={cmd.busy}>{cmd.busy ? t("Saving…") : t("Save")}</button>
						</div>
					</form>
				</Dialog>
			)}
		</div>
	);
}
