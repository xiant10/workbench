import { ArrowUp, AudioLines, Check, CircleAlert, LoaderCircle, Mic, Paperclip, Square, X } from "lucide-react";
import { type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useI18n } from "../lib/i18n.tsx";
import type { PromptInput } from "../lib/agent.ts";
import type { Dictation, DictationError, DictationEvents } from "../lib/dictation.ts";
import { load, save } from "../lib/storage.ts";
import type { ComposerMode } from "./reducer.ts";

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
	autoFocus?: boolean;
	suggestion?: { text: string; id: number };
	toolbar?: ReactNode;
	onSend(input: PromptInput, text: string, images: number): void | Promise<void>;
	onStop?(): void;
	onStopAndSend?(input: PromptInput, text: string, images: number): void;
	onRetry?(): void;
	/** Starts a call. With nothing typed, the send button offers it instead. */
	onVoice?(): void;
	/** What the call button says, as a tooltip and to screen readers. */
	voiceLabel?: string;
	/** A call is being started, so the button waits. */
	voiceStarting?: boolean;
	onSignIn?(): void;
	/** Starts a voice message: the words fill the box as they're heard. */
	onDictate?(events: DictationEvents): Promise<Dictation>;
};

/** Joins dictated text to what was typed, with a space only between words of a spaced script. */
function joinDictated(typed: string, heard: string): string {
	if (typed === "" || heard === "") return typed + heard;
	return /[\s\u3000-\u9fff\uff00-\uffef]$/.test(typed) ? typed + heard : `${typed} ${heard}`;
}

type Listening = { typed: string; heard: string; started: number; finishing: boolean };

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

export function Composer({ draftKey, mode, canAddToRun = true, inCall, placeholder, autoFocus, suggestion, toolbar, onSend, onStop, onStopAndSend, onRetry, onVoice, voiceLabel, voiceStarting = false, onSignIn, onDictate }: ComposerProps) {
	const { t } = useI18n();
	const [text, setText] = useState(() => load(`draft:${draftKey}`) ?? "");
	const [images, setImages] = useState<Image[]>([]);
	const [problem, setProblem] = useState("");
	const [dragging, setDragging] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [failed, setFailed] = useState(false);
	const sending = useRef(false);
	const [listening, setListening] = useState<Listening>();
	const [now, setNow] = useState(0);
	const dictation = useRef<Dictation>();
	const finishRef = useRef<(send: boolean) => void>(() => {});
	const applied = useRef<number>();
	const box = useRef<HTMLTextAreaElement>(null);
	const file = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (suggestion === undefined || applied.current === suggestion.id) return;
		applied.current = suggestion.id;
		setText((current) => current.trim() === "" ? suggestion.text : `${current}\n\n${suggestion.text}`);
		box.current?.focus();
	}, [suggestion]);

	useEffect(() => save(`draft:${draftKey}`, text), [draftKey, text]);
	useEffect(() => {
		const element = box.current;
		if (element === null) return;
		element.style.height = "auto";
		element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
	}, [text]);

	const payload = (typed = text): { input: PromptInput; text: string; images: number } => ({
		input: images.length === 0 ? typed : [...(typed === "" ? [] : [{ type: "text" as const, text: typed }]), ...images.map(({ data, mimeType }) => ({ type: "image" as const, data, mimeType }))],
		text: typed,
		images: images.length,
	});
	const clear = () => {
		save(`draft:${draftKey}`, undefined);
		setText("");
		setImages([]);
		setProblem("");
	};
	const canSendNow = (typed: string) =>
		!submitting && (typed.trim() !== "" || images.length > 0) && mode !== "reconnecting" && mode !== "signed-out" && (canAddToRun || (mode !== "running" && mode !== "stalled"));
	const canSend = listening === undefined && canSendNow(text);
	const submit = async (dictated?: string) => {
		if (dictated === undefined ? !canSend : !canSendNow(dictated)) return;
		if (sending.current) return;
		sending.current = true;
		setSubmitting(true);
		setProblem("");
		const { input, text: typed, images: count } = payload(dictated);
		try {
			await onSend(input, typed, count);
			setFailed(false);
			clear();
		} catch {
			setFailed(true);
			setProblem(t("Your message wasn't sent. Retry when you're ready."));
		} finally {
			sending.current = false;
			setSubmitting(false);
		}
	};
	const dictationProblem = (reason: DictationError | string) =>
		reason === "microphone"
			? t("The microphone isn't available. Allow it in the browser to talk.")
			: reason === "unavailable"
				? t("Voice messages aren't available right now.")
				: reason === "too_long"
					? t("A voice message is at most a minute.")
					: reason === "idle"
						? t("Nothing was heard, so listening stopped.")
						: t("The voice message couldn't be heard. What was heard is kept.");
	const startListening = async () => {
		if (onDictate === undefined || listening !== undefined || submitting) return;
		setProblem("");
		const typed = text;
		setListening({ typed, heard: "", started: Date.now(), finishing: false });
		setNow(Date.now());
		try {
			dictation.current = await onDictate({
				onText: (heard) => setListening((current) => (current === undefined ? current : { ...current, heard })),
				onError: (reason) => {
					dictation.current = undefined;
					setListening((current) => {
						if (current !== undefined) setText(joinDictated(current.typed, current.heard));
						return undefined;
					});
					setProblem(dictationProblem(reason));
				},
				onLimit: () => finishRef.current(false),
			});
		} catch (error) {
			setListening(undefined);
			setProblem(dictationProblem(error instanceof Error ? error.message : "failed"));
		}
	};
	/** Ends listening. The final text replaces what was heard; with send, it goes at once. */
	const finishListening = async (send: boolean) => {
		const current = dictation.current;
		if (current === undefined || listening === undefined || listening.finishing) return;
		setListening({ ...listening, finishing: true });
		let heard: string;
		try {
			heard = await current.finish();
		} catch (error) {
			heard = (error as { text?: string }).text || listening.heard;
			setProblem(dictationProblem(error instanceof Error ? error.message : "failed"));
			send = false;
		}
		dictation.current = undefined;
		setListening(undefined);
		const joined = joinDictated(listening.typed, heard);
		setText(joined);
		box.current?.focus();
		if (send) await submit(joined);
	};
	finishRef.current = (send) => void finishListening(send);
	const cancelListening = () => {
		dictation.current?.cancel();
		dictation.current = undefined;
		setListening(undefined);
	};
	useEffect(() => {
		if (listening === undefined || listening.finishing) return;
		const timer = setInterval(() => setNow(Date.now()), 500);
		return () => clearInterval(timer);
	}, [listening]);
	useEffect(() => () => dictation.current?.cancel(), []);

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		// Enter also confirms an IME's candidate, and most users will type Chinese.
		if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
			event.preventDefault();
			if (listening !== undefined) void finishListening(true);
			else void submit();
		}
		if (event.key === "Escape" && listening !== undefined) cancelListening();
	};
	const add = async (files: Iterable<File>) => {
		if (sending.current) return;
		for (const candidate of files) {
			if (!candidate.type.startsWith("image/")) {
				setProblem(t("{name} isn't an image. Paste document text into the message instead.", { name: candidate.name }));
				continue;
			}
			if (candidate.size > MAX_IMAGE_BYTES) {
				setProblem(t("{name} is over the 8 MB limit.", { name: candidate.name }));
				continue;
			}
			try {
				const image = await readImage(candidate);
				setImages((current) => [...current, image]);
			} catch {
				setProblem(t("Couldn't read {name}. Try attaching it again.", { name: candidate.name }));
			}
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
	// One button, the right one for what's in the box: send what was typed, or talk when nothing was.
	const offersVoice = onVoice !== undefined && inCall !== true && mode === "idle" && !submitting && !failed && text.trim() === "" && images.length === 0 && listening === undefined;
	const shown = listening === undefined ? text : joinDictated(listening.typed, listening.heard);
	const seconds = listening === undefined ? 0 : Math.max(0, Math.floor((now - listening.started) / 1000));
	const status =
		mode === "reconnecting" ? t("Sending is paused until the connection returns.") : mode === "stalled" ? t("No reply yet. It may be stalled.") : mode === "signed-out" ? t("You've been signed out. What you typed is kept.") : problem;

	return (
		<div className="composer">
			{submitting && <p className="composer-status" role="status">{t("Sending…")}</p>}
			{listening !== undefined && (
				<p className="composer-status listening" role="status">
					<span className="listening-dot" aria-hidden="true" />
					{listening.finishing ? t("Finishing…") : t("Listening {time} · Enter sends, Esc cancels", { time: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` })}
				</p>
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
							<button type="button" disabled={submitting} aria-label={t("Remove")} onClick={() => setImages((current) => current.filter((other) => other !== image))}>
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
					value={shown}
					readOnly={submitting || listening !== undefined}
					placeholder={placeholder}
					aria-label={placeholder}
					autoFocus={autoFocus}
					onChange={(event) => setText(event.target.value)}
					onKeyDown={onKeyDown}
					onPaste={onPaste}
				/>
				<div className="composer-actions">
					{toolbar}
					<button type="button" className="icon-button" disabled={submitting || listening !== undefined} aria-label={t("Attach an image")} title={t("Attach an image")} onClick={() => file.current?.click()}>
						<Paperclip size={17} aria-hidden="true" />
					</button>
					{onDictate !== undefined && listening === undefined && (
						<button type="button" className="icon-button" disabled={submitting || mode === "signed-out"} aria-label={t("Talk instead of typing")} title={t("Talk instead of typing")} onClick={() => void startListening()}>
							<Mic size={17} aria-hidden="true" />
						</button>
					)}
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
					{listening === undefined && <span className="composer-hint">{t("Enter to send, Shift+Enter for a new line")}</span>}
					<span className="spacer" />
					{listening !== undefined && (
						<>
							<button type="button" className="icon-button" disabled={listening.finishing} aria-label={t("Cancel")} title={t("Cancel")} onClick={cancelListening}>
								<X size={17} aria-hidden="true" />
							</button>
							<button type="button" className="ghost" disabled={listening.finishing} onClick={() => void finishListening(false)}>
								<Check size={15} aria-hidden="true" />
								{t("Stop and edit")}
							</button>
							<button type="button" className="primary send" disabled={listening.finishing} aria-label={t("Send")} title={t("Send")} onClick={() => void finishListening(true)}>
								{listening.finishing ? <LoaderCircle size={17} className="spin" aria-hidden="true" /> : <ArrowUp size={17} aria-hidden="true" />}
							</button>
						</>
					)}
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
						<button type="button" className="primary send" aria-label={t("Send")} onClick={() => void submit()}>
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
					{/* A call ends from its own bar, so a run can still be stopped while talking. */}
					{busy && onStop !== undefined && (
						<button type="button" className="stop send" aria-label={t("Stop")} onClick={onStop}>
							<Square size={13} fill="currentColor" aria-hidden="true" />
						</button>
					)}
					{listening !== undefined ? null : offersVoice ? (
						<button type="button" className="primary send" aria-label={voiceLabel ?? t("Start a call")} title={voiceLabel ?? t("Start a call")} disabled={voiceStarting} onClick={onVoice}>
							{voiceStarting ? <LoaderCircle size={17} className="spin" aria-hidden="true" /> : <AudioLines size={17} aria-hidden="true" />}
						</button>
					) : (
						(mode === "idle" || mode === "reconnecting") && (
							<button type="button" className="primary send" aria-label={t(failed ? "Retry" : "Send")} disabled={!canSend} onClick={() => void submit()}>
								<ArrowUp size={17} aria-hidden="true" />
							</button>
						)
					)}
				</div>
			</div>
		</div>
	);
}
