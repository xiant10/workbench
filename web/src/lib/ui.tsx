import { Check, Copy, type LucideIcon } from "lucide-react";
import { createContext, type KeyboardEvent, type ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "./i18n.tsx";

const TOAST_MS = 5000;
const COPIED_MS = 1500;
const MENU_GAP = 6;
const FOCUSABLE = "input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), a[href]";

export function Logo({ size = 28 }: { size?: number }) {
	return <img className="logo" src="/logo.png" alt="t10" width={size} height={size} aria-hidden="true" />;
}

/** Colour follows the name, so a person looks the same everywhere. */
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
	const hue = [...name].reduce((sum, char) => sum + (char.codePointAt(0) ?? 0), 0) % 6;
	return (
		<span className={`avatar hue-${hue}`} style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">
			{[...name][0]?.toUpperCase() ?? "?"}
		</span>
	);
}

export function Empty({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
	return (
		<div className="empty">
			<span className="empty-icon">
				<Icon size={22} aria-hidden="true" />
			</span>
			<p className="empty-title">{title}</p>
			{children}
		</div>
	);
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
	const { t } = useI18n();
	return (
		<div className="skeleton" role="status" aria-label={t("Loading…")}>
			{Array.from({ length: rows }, (_, row) => (
				<span key={row} />
			))}
		</div>
	);
}

type SegmentedProps<T extends string> = { label: string; value: T; options: { value: T; label: string }[]; onChange(value: T): void };

export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
	return (
		<div className="segmented" role="radiogroup" aria-label={label}>
			{options.map((option) => (
				<button key={option.value} type="button" role="radio" aria-checked={value === option.value} className={value === option.value ? "active" : ""} onClick={() => onChange(option.value)}>
					{option.label}
				</button>
			))}
		</div>
	);
}

export function LanguageSwitch() {
	const { t, language, setLanguage } = useI18n();
	return (
		<Segmented
			label={t("Language")}
			value={language}
			options={[
				{ value: "en", label: "English" },
				{ value: "zh", label: "简体中文" },
			]}
			onChange={setLanguage}
		/>
	);
}

export function CopyButton({ text, label, className = "icon-button" }: { text: string | (() => string); label?: string; className?: string }) {
	const { t } = useI18n();
	const { toast } = useFeedback();
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(typeof text === "string" ? text : text());
			setCopied(true);
			setTimeout(() => setCopied(false), COPIED_MS);
		} catch {
			toast(t("Couldn't copy. Your browser blocked it."));
		}
	};
	const Icon = copied ? Check : Copy;
	return (
		<button type="button" className={className} aria-label={t(copied ? "Copied" : "Copy")} onClick={() => void copy()}>
			<Icon size={15} aria-hidden="true" />
			{label !== undefined && t(copied ? "Copied" : label)}
		</button>
	);
}

export function Dialog({ label, onClose, wide, children }: { label: string; onClose?: () => void; wide?: boolean; children: ReactNode }) {
	const box = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const before = document.activeElement as HTMLElement | null;
		box.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
		return () => before?.focus();
	}, []);
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Escape") {
			event.stopPropagation();
			onClose?.();
		}
		if (event.key !== "Tab" || box.current === null) return;
		const stops = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
		const edge = event.shiftKey ? stops[0] : stops.at(-1);
		if (document.activeElement === edge) {
			event.preventDefault();
			(event.shiftKey ? stops.at(-1) : stops[0])?.focus();
		}
	};
	return (
		<div
			className="dialog-backdrop"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose?.();
			}}
		>
			<div ref={box} className={wide === true ? "dialog wide" : "dialog"} role="dialog" aria-modal="true" aria-label={label} onKeyDown={onKeyDown}>
				{children}
			</div>
		</div>
	);
}

type MenuProps = { label: string; trigger: ReactNode; triggerClass?: string; onOpen?: () => void; panelClass?: string; children(close: () => void): ReactNode };

/** Drawn on the body, so a scrolling list can't clip it, and a sidebar's transform can't move it. */
export function Menu({ label, trigger, triggerClass, onOpen, panelClass = "", children }: MenuProps) {
	const button = useRef<HTMLButtonElement>(null);
	const panel = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [place, setPlace] = useState<{ top: number; left: number }>();
	const close = useCallback(() => setOpen(false), []);

	useLayoutEffect(() => {
		if (!open || button.current === null || panel.current === null) return;
		const anchor = button.current.getBoundingClientRect();
		const { width, height } = panel.current.getBoundingClientRect();
		const below = anchor.bottom + MENU_GAP + height <= window.innerHeight;
		setPlace({
			top: below ? anchor.bottom + MENU_GAP : Math.max(MENU_GAP, anchor.top - MENU_GAP - height),
			left: Math.max(MENU_GAP, Math.min(anchor.left, window.innerWidth - width - MENU_GAP)),
		});
	}, [open]);
	useEffect(() => {
		if (!open) return;
		panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
		const onDown = (event: MouseEvent) => {
			const target = event.target as Node;
			if (!panel.current?.contains(target) && !button.current?.contains(target)) close();
		};
		document.addEventListener("mousedown", onDown);
		window.addEventListener("resize", close);
		return () => {
			document.removeEventListener("mousedown", onDown);
			window.removeEventListener("resize", close);
		};
	}, [open, close]);

	return (
		<>
			<button
				ref={button}
				type="button"
				className={triggerClass}
				aria-label={label}
				aria-haspopup="true"
				aria-expanded={open}
				onClick={() => {
					if (!open) onOpen?.();
					setOpen(!open);
				}}
			>
				{trigger}
			</button>
			{open &&
				createPortal(
					<div
						ref={panel}
						className={`menu ${panelClass}`}
						style={place ?? { visibility: "hidden", top: 0, left: 0 }}
						onKeyDown={(event) => {
							if (event.key !== "Escape") return;
							close();
							button.current?.focus();
						}}
					>
						{children(close)}
					</div>,
					document.body,
				)}
		</>
	);
}

type ConfirmOptions = { title: string; body?: ReactNode; action: string; danger?: boolean };
type Toast = { id: number; text: string; action?: { label: string; run(): void } };
type Feedback = { confirm(options: ConfirmOptions): Promise<boolean>; toast(text: string, action?: Toast["action"]): void };

const FeedbackContext = createContext<Feedback | undefined>(undefined);

export function useFeedback(): Feedback {
	const feedback = useContext(FeedbackContext);
	if (feedback === undefined) throw new Error("useFeedback needs FeedbackProvider");
	return feedback;
}

/** Confirmations and short notices, drawn in the app's own language and theme, unlike the browser's. */
export function FeedbackProvider({ children }: { children: ReactNode }) {
	const { t } = useI18n();
	const [asking, setAsking] = useState<ConfirmOptions & { answer(yes: boolean): void }>();
	const [toasts, setToasts] = useState<Toast[]>([]);
	const nextId = useRef(1);
	const value = useMemo<Feedback>(
		() => ({
			confirm: (options) => new Promise((resolve) => setAsking({ ...options, answer: resolve })),
			toast: (text, action) => {
				const id = nextId.current++;
				setToasts((current) => [...current, { id, text, ...(action === undefined ? {} : { action }) }]);
				setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), TOAST_MS);
			},
		}),
		[],
	);
	const answer = (yes: boolean) => {
		asking?.answer(yes);
		setAsking(undefined);
	};
	return (
		<FeedbackContext.Provider value={value}>
			{children}
			{asking !== undefined && (
				<Dialog label={asking.title} onClose={() => answer(false)}>
					<h2>{asking.title}</h2>
					{asking.body !== undefined && <div className="dialog-body">{asking.body}</div>}
					<div className="dialog-actions">
						<button type="button" className="ghost" onClick={() => answer(false)}>
							{t("Cancel")}
						</button>
						<button type="button" className={asking.danger === true ? "danger" : "primary"} onClick={() => answer(true)}>
							{asking.action}
						</button>
					</div>
				</Dialog>
			)}
			<div className="toasts" role="status">
				{toasts.map((toast) => (
					<div key={toast.id} className="toast">
						<span>{toast.text}</span>
						{toast.action !== undefined && (
							<button
								type="button"
								className="link"
								onClick={() => {
									toast.action?.run();
									setToasts((current) => current.filter((other) => other.id !== toast.id));
								}}
							>
								{toast.action.label}
							</button>
						)}
					</div>
				))}
			</div>
		</FeedbackContext.Provider>
	);
}

export function Setting({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
	return (
		<div className="setting">
			<div className="setting-text">
				<span>{title}</span>
				{hint !== undefined && <span className="quiet">{hint}</span>}
			</div>
			{children}
		</div>
	);
}
