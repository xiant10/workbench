import { memo, type ReactNode, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "../lib/i18n.tsx";
import { CopyButton, useFeedback } from "../lib/ui.tsx";

const ALLOWED_SCHEMES = /^(https?:|mailto:)/i;

function CodeBlock({ children }: { children: ReactNode }) {
	const code = useRef<HTMLPreElement>(null);
	return (
		<div className="code-block">
			<CopyButton text={() => code.current?.textContent ?? ""} />
			<pre ref={code}>{children}</pre>
		</div>
	);
}

/**
 * Model output is untrusted. react-markdown renders no raw HTML unless told to, which nothing here does. Links ask
 * first, showing the whole address, and an image shows as its text, so a reply can't reach out on its own. The content security policy backs this.
 */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
	const { t } = useI18n();
	const { confirm } = useFeedback();
	return (
		<div className="markdown">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					a: ({ href, children }) => {
						if (href === undefined || !ALLOWED_SCHEMES.test(href)) return <span>{children}</span>;
						return (
							<a
								href={href}
								target="_blank"
								rel="noopener noreferrer"
								onClick={(event) => {
									event.preventDefault();
									void confirm({ title: t("Open this link?"), body: <code className="url">{href}</code>, action: t("Open") }).then((yes) => {
										if (yes) window.open(href, "_blank", "noopener,noreferrer");
									});
								}}
							>
								{children}
							</a>
						);
					},
					pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
					img: ({ alt, src }) => <span className="image-text">{alt || src}</span>,
				}}
			>
				{text}
			</ReactMarkdown>
		</div>
	);
});
