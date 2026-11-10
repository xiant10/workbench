import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useI18n } from "../../lib/i18n.tsx";
import { Avatar } from "../../lib/ui.tsx";
import { findPeople } from "./api.ts";
import { usePeople } from "./usePeople.ts";

/** Finds a teammate by name, showing their team, and leaves out anyone in `exclude`. */
export function PersonPicker({ label, exclude, disabled, onPick }: { label: string; exclude: string[]; disabled?: boolean; onPick(userId: string): void }) {
	const { t } = useI18n();
	const { unit } = usePeople();
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState(false);
	const people = useQuery({ queryKey: ["people-search", query], queryFn: () => findPeople(query), enabled: open });
	const candidates = (people.data ?? []).filter((person) => !exclude.includes(person.user_id));
	return (
		// Focus leaving the picker closes its results.
		<div className="person-picker" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
			<input value={query} placeholder={t("Find a teammate")} aria-label={label} disabled={disabled} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true); }} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }} />
			{open && (
				<ul className="picker">
					{candidates.map((person) => (
						<li key={person.user_id}>
							<button
								type="button"
								onClick={() => {
									onPick(person.user_id);
									setQuery("");
									setOpen(false);
								}}
							>
								<Avatar name={person.display_name || t("Teammate")} size={26} />
								<span>{person.display_name || t("Teammate")}</span>
								{person.org_unit_id !== "" && <span className="quiet">{unit(person.org_unit_id)}</span>}
							</button>
						</li>
					))}
					{people.isSuccess && candidates.length === 0 && <li className="quiet picker-none">{t(query === "" ? "Everyone is already here." : "Nobody matches that name.")}</li>}
				</ul>
			)}
		</div>
	);
}
