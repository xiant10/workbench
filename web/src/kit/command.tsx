import { Bell as BellIcon, CheckCheck, Search } from "lucide-react";
import { type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { Icon } from "./frame.tsx";
import { useI18n } from "./i18n.tsx";
import { Dialog, Menu } from "./ui.tsx";

export const SHORTCUT = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘K" : "Ctrl K";

/** Opens search on ⌘K or Ctrl K, in every app. */
export function useSearchShortcut(open: () => void): void {
	useEffect(() => {
		const onKeyDown = (event: globalThis.KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				open();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [open]);
}

/** The rail's way into search, for a pointer or a tap. */
export function SearchButton({ onClick }: { onClick(): void }) {
	const { t } = useI18n();
	return (
		<button type="button" className="search-button" onClick={onClick}>
			<Search size={15} aria-hidden="true" />
			<span>{t("Search")}</span>
			<kbd>{SHORTCUT}</kbd>
		</button>
	);
}

/** One thing search can reach: a place in this app, a section of another, an action. `hint` says where or when. */
export type PaletteEntry = { key: string; label: string; icon: Icon; hint?: string; run(): void };

type PaletteProps = {
	/** The entries for what's typed, already matched and in order. */
	search(query: string): PaletteEntry[];
	placeholder: string;
	/** One line under the box on what search covers, so nobody expects more. */
	scope: string;
	onClose(): void;
};

/** One place to jump anywhere, the same in every app; each app says what it can reach. */
export function Palette({ search, placeholder, scope, onClose }: PaletteProps) {
	const { t } = useI18n();
	const list = useRef<HTMLUListElement>(null);
	const [query, setQuery] = useState("");
	const [at, setAt] = useState(0);
	const entries = search(query);

	useEffect(() => setAt(0), [query]);
	useEffect(() => {
		list.current?.children[at]?.scrollIntoView({ block: "nearest" });
	}, [at]);

	const choose = (entry: PaletteEntry | undefined) => {
		if (entry === undefined) return;
		onClose();
		entry.run();
	};
	const onKeyDown = (event: KeyboardEvent) => {
		if (entries.length === 0) return;
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const step = event.key === "ArrowDown" ? 1 : -1;
			setAt((at + step + entries.length) % entries.length);
		}
		// Enter also confirms an IME's candidate.
		if (event.key === "Enter" && !event.nativeEvent.isComposing) choose(entries[at]);
	};

	return (
		<Dialog label={t("Search")} onClose={onClose} className="palette" backdropClassName="palette-backdrop">
			<div className="palette-input">
				<Search size={17} aria-hidden="true" />
				<input
					role="combobox"
					aria-expanded="true"
					aria-controls="palette-list"
					aria-activedescendant={entries[at] === undefined ? undefined : `palette-${at}`}
					value={query}
					placeholder={placeholder}
					aria-label={t("Search")}
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={onKeyDown}
				/>
				<kbd>Esc</kbd>
			</div>
			<p className="quiet search-scope">{scope}</p>
			<ul id="palette-list" ref={list} role="listbox" aria-label={t("Results")}>
				{entries.map((entry, index) => (
					<li key={entry.key} id={`palette-${index}`} role="option" aria-selected={index === at} className={index === at ? "active" : ""} onMouseMove={() => setAt(index)} onClick={() => choose(entry)}>
						<entry.icon size={16} aria-hidden="true" />
						<span className="palette-label">{entry.label}</span>
						{entry.hint !== undefined && <span className="quiet">{entry.hint}</span>}
					</li>
				))}
				{entries.length === 0 && <li className="palette-none">{t("Nothing found.")}</li>}
			</ul>
		</Dialog>
	);
}

/** An unread notification, already in the reader's words, with where it leads. `app` names the app that sent it. */
export type BellItem = { id: string; label: string; href: string; app?: string; icon?: Icon };

type BellProps = {
	items: BellItem[];
	/** Marks it read where it came from, and goes there. Plain clicks only: a new tab just follows the link. */
	onOpen(item: BellItem): void;
	onReadAll(): void;
	/** Anything after the list, such as a way to turn on browser notifications. */
	footer?: ReactNode;
};

/** Unread notifications in the frame, so they reach a person on any page of any app. */
export function Bell({ items, onOpen, onReadAll, footer }: BellProps) {
	const { t } = useI18n();
	const plain = (event: MouseEvent) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
	return (
		<Menu
			label={items.length > 0 ? t("Notifications: {count} unread", { count: items.length }) : t("Notifications")}
			triggerClass="icon-button bell"
			panelClass="bell-panel"
			trigger={
				<>
					<BellIcon size={17} aria-hidden="true" />
					{items.length > 0 && <span className="bell-count" data-testid="bell-count">{items.length > 99 ? "99+" : items.length}</span>}
				</>
			}
		>
			{(close) => (
				<>
					<h2>{t("Notifications")}</h2>
					{items.length === 0 && <p className="quiet bell-none">{t("Nothing new.")}</p>}
					{items.map((item) => (
						<a
							key={item.id}
							href={item.href}
							data-testid="bell-item"
							onClick={(event) => {
								if (!plain(event)) return;
								event.preventDefault();
								close();
								onOpen(item);
							}}
						>
							{item.icon !== undefined && <item.icon size={15} aria-hidden="true" />}
							<span className="bell-label">{item.label}</span>
							{item.app !== undefined && <span className="quiet">{item.app}</span>}
						</a>
					))}
					{items.length > 0 && (
						<button
							type="button"
							className="bell-read-all"
							onClick={() => {
								close();
								onReadAll();
							}}
						>
							<CheckCheck size={15} aria-hidden="true" />
							{t("Mark all read")}
						</button>
					)}
					{footer}
				</>
			)}
		</Menu>
	);
}
