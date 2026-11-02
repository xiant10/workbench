import { ArrowUp, CircleAlert, Clock, Paperclip, Square, X } from "lucide-react";
import { type ClipboardEvent, type DragEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useI18n } from "../lib/i18n.tsx";
import type { PromptInput } from "../lib/agent.ts";
import { load, save } from "../lib/storage.ts";
import type { ComposerMode, Pending } from "./reducer.ts";

const MAX_IMAGE_BYTES = 8 << 20;

type Image = { name: string; data: string; mimeType: string; url: string };

export type ComposerProps = {
	/** Where the draft is kept, so it survives a reload or a sign-in. */
	draftKey: string;
	mode: ComposerMode;
	/** Whether a message can join a run under way. Without it, sending waits until the run ends. */
	canAddToRun?: boolean;
	inCall?: boolean;
	placeholder: string;
	queued?: Pending[];
	autoFocus?: boolean;
	onSend(input: PromptInput, text: string, images: number): void;
	onStop?(): void;
	onStopAndSend?(input: PromptInput, text: string, images: number): void;
	onRetry?(): void;
	onEndCall?(): void;
	onSignIn?(): void;
};

function readImage(file: File): Promise<Image> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(reader.error);
		reader.onload = () => {
			const url = reader.result as string;
			resolve({ name: file.name, data: url.slice(url.indexOf(",") + 1), mimeType: file.type, url });
		};
		reader.readAsDataURL(file);
	});
}

export function Composer({ draftKey, mode, canAddToRun = true, inCall, placeholder, queued = [], autoFocus, onSend, onStop, onStopAndSend, onRetry, onEndCall, onSignIn }: ComposerProps) {
	const { t } = useI18n();
	const [text, setText] = useState(() => load(`draft:${draftKey}`) ?? "");
	const [images, setImages] = useState<Image[]>([]);
	const [problem, setProblem] = useState("");
	const [dragging, setDragging] = useState(false);
	const box = useRef<HTMLTextAreaElement>(null);
	const file = useRef<HTMLInputElement>(null);

	useEffect(() => save(`draft:${draftKey}`, text), [draftKey, text]);
	useEffect(() => {
		const element = box.current;
		if (element === null) return;
		element.style.height = "auto";
		element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
	}, [text]);

	const payload = (): { input: PromptInput; text: string; images: number } => ({
		input: images.length === 0 ? text : [...(text === "" ? [] : [{ type: "text" as const, text }]), ...images.map(({ data, mimeType }) => ({ type: "image" as const, data, mimeType }))],
		text,
		images: images.length,
	});
	const clear = () => {
		setText("");
		setImages([]);
		setProblem("");
	};
	const canSend = (text.trim() !== "" || images.length > 0) && mode !== "reconnecting" && mode !== "signed-out" && (canAddToRun || (mode !== "running" && mode !== "stalled"));
	const submit = () => {
		if (!canSend) return;
		const { input, text: typed, images: count } = payload();
		onSend(input, typed, count);
		clear();
	};
	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		// Enter also confirms an IME's candidate, and most users will type Chinese.
		if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
			event.preventDefault();
			submit();
		}
	};
	const add = async (files: Iterable<File>) => {
		for (const candidate of files) {
			if (!candidate.type.startsWith("image/")) continue;
			if (candidate.size > MAX_IMAGE_BYTES) {
				setProblem(t("{name} is over the 8 MB limit.", { name: candidate.name }));
				continue;
			}
			const image = await readImage(candidate);
			setImages((current) => [...current, image]);
		}
	};
	const onPaste = (event: ClipboardEvent) => {
		if (event.clipboardData.files.length > 0) void add(event.clipboardData.files);
	};

	const onDrop = (event: DragEvent) => {
		event.preventDefault();
		setDragging(false);
		void add(event.dataTransfer.files);
	};

	const busy = mode === "running" || mode === "stalled";
	const status =
		mode === "reconnecting" ? t("Sending is paused until the connection returns.") : mode === "stalled" ? t("No reply yet. It may be stalled.") : mode === "signed-out" ? t("You've been signed out. What you typed is kept.") : problem;

	return (
		<div className="composer">
			{queued.length > 0 && (
				<ul className="queued" aria-label={t("Queued")}>
					{queued.map((item) => (
						<li key={item.requestId}>
							<Clock size={13} aria-hidden="true" />
							{t("Queued")}: {item.text}
						</li>
					))}
				</ul>
			)}
			{status !== "" && (
				<p className="composer-status" role="status">
					<CircleAlert size={14} aria-hidden="true" />
					{status}
				</p>
			)}
			{images.length > 0 && (
				<ul className="attachments">
					{images.map((image) => (
						<li key={image.url}>
							<img src={image.url} alt={image.name} />
							<button type="button" aria-label={t("Remove")} onClick={() => setImages((current) => current.filter((other) => other !== image))}>
								<X size={12} aria-hidden="true" />
							</button>
						</li>
					))}
				</ul>
			)}
			<div
				className={dragging ? "composer-box dragging" : "composer-box"}
				onDragOver={(event) => {
					event.preventDefault();
					setDragging(true);
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={onDrop}
			>
				<textarea
					ref={box}
					rows={1}
					value={text}
					placeholder={placeholder}
					aria-label={placeholder}
					autoFocus={autoFocus}
					onChange={(event) => setText(event.target.value)}
					onKeyDown={onKeyDown}
					onPaste={onPaste}
				/>
				<div className="composer-actions">
					<button type="button" className="icon-button" aria-label={t("Attach")} title={t("Attach an image")} onClick={() => file.current?.click()}>
						<Paperclip size={17} aria-hidden="true" />
					</button>
					<input
						ref={file}
						type="file"
						accept="image/*"
						multiple
						hidden
						onChange={(event) => {
							void add(event.target.files ?? []);
							event.target.value = "";
						}}
					/>
					<span className="composer-hint">{t("Enter to send, Shift+Enter for a new line")}</span>
					<span className="spacer" />
					{busy && canSend && onStopAndSend !== undefined && (
						<button
							type="button"
							className="ghost"
							onClick={() => {
								const { input, text: typed, images: count } = payload();
								onStopAndSend(input, typed, count);
								clear();
							}}
						>
							{t("Stop and send this instead")}
						</button>
					)}
					{busy && canSend && (
						<button type="button" className="primary send" aria-label={t("Send")} onClick={submit}>
							<ArrowUp size={17} aria-hidden="true" />
						</button>
					)}
					{mode === "signed-out" && (
						<button type="button" className="primary" onClick={onSignIn}>
							{t("Sign in again")}
						</button>
					)}
					{mode === "stalled" && onRetry !== undefined && (
						<button type="button" className="primary" onClick={onRetry}>
							{t("Retry")}
						</button>
					)}
					{inCall === true ? (
						<button type="button" className="danger" onClick={onEndCall}>
							{t("End call")}
						</button>
					) : (
						busy &&
						onStop !== undefined && (
							<button type="button" className="stop send" aria-label={t("Stop")} onClick={onStop}>
								<Square size={13} fill="currentColor" aria-hidden="true" />
							</button>
						)
					)}
					{(mode === "idle" || mode === "reconnecting") && (
						<button type="button" className="primary send" aria-label={t("Send")} disabled={!canSend} onClick={submit}>
							<ArrowUp size={17} aria-hidden="true" />
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
