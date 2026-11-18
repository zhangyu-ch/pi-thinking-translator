import type { ThinkingLevel } from "@earendil-works/pi-ai";

export interface TranslatorConfig {
	enabled: boolean;
	excludedModels: string[];
	translatorModel: string;
	translatorThinking: ThinkingLevel;
}

export const DEFAULT_CONFIG: TranslatorConfig = {
	enabled: true,
	excludedModels: [],
	translatorModel: "magpie/group/ds-flash",
	translatorThinking: "low",
};

export const VALID_THINKING_LEVELS: ThinkingLevel[] = ["low", "minimal", "off", "medium", "high", "xhigh", "max"];

export function setModelExcluded(config: TranslatorConfig, modelId: string, excluded: boolean): void {
	const trimmed = modelId.trim();
	if (!trimmed) return;
	const key = trimmed.toLowerCase();
	const filtered = config.excludedModels.filter((m) => m.trim().toLowerCase() !== key);
	config.excludedModels = excluded ? [...filtered, trimmed] : filtered;
}

export function parseProviderAndModel(spec: string): { provider?: string; modelId: string } {
	const trimmed = spec.trim();
	const slashIndex = trimmed.indexOf("/");
	if (slashIndex <= 0) {
		return { modelId: trimmed };
	}
	return {
		provider: trimmed.slice(0, slashIndex),
		modelId: trimmed.slice(slashIndex + 1),
	};
}

export function shouldTranslateModel(
	excludedModels: readonly string[],
	msgProvider?: string,
	msgModel?: string,
	activeModel?: { provider: string; id: string },
): boolean {
	const candidates = new Set<string>();
	if (msgProvider && msgModel) candidates.add(`${msgProvider}/${msgModel}`.toLowerCase());
	if (msgModel) candidates.add(msgModel.toLowerCase());
	if (activeModel) {
		candidates.add(`${activeModel.provider}/${activeModel.id}`.toLowerCase());
		candidates.add(activeModel.id.toLowerCase());
	}
	return !excludedModels.some((pattern) => {
		const normalized = pattern.trim().toLowerCase();
		return normalized && candidates.has(normalized);
	});
}

export function extractThinkingRuns(content: unknown): { blocks: string[]; runs: string[][] } {
	if (!Array.isArray(content)) return { blocks: [], runs: [] };
	const blocks: string[] = [];
	const runs: string[][] = [];

	for (let i = 0; i < content.length; i++) {
		const item = content[i] as { type?: string; thinking?: string } | null | undefined;
		if (item?.type !== "thinking") continue;

		const run: string[] = [];
		for (; i < content.length; i++) {
			const cur = content[i] as { type?: string; thinking?: string } | null | undefined;
			if (cur?.type !== "thinking") break;
			const text = typeof cur.thinking === "string" ? cur.thinking.trim() : "";
			if (text) {
				blocks.push(text);
				run.push(text);
			}
		}
		i--;
		if (run.length > 0) {
			runs.push(run);
		}
	}

	return { blocks, runs };
}

export function splitThinkingParagraphs(text: string): string[] {
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	const paragraphs: string[] = [];
	let current: string[] = [];
	let fenceMarker: string | null = null;

	const flush = () => {
		const joined = current.join("\n").trim();
		if (joined) paragraphs.push(joined);
		current = [];
	};

	for (const line of lines) {
		const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
		if (fenceMatch) {
			const marker = fenceMatch[1];
			if (!fenceMarker) {
				fenceMarker = marker;
			} else if (
				marker[0] === fenceMarker[0] &&
				marker.length >= fenceMarker.length &&
				/^\s{0,3}(?:`+|~+)\s*$/.test(line)
			) {
				fenceMarker = null;
			}
			current.push(line);
			continue;
		}

		if (!fenceMarker && line.trim() === "") {
			flush();
			continue;
		}

		current.push(line);
	}
	flush();

	const merged: string[] = [];
	for (let i = 0; i < paragraphs.length; i++) {
		const p = paragraphs[i];
		if (/^#{1,6}\s+\S[^\n]*$/.test(p) && i + 1 < paragraphs.length) {
			paragraphs[i + 1] = `${p}\n\n${paragraphs[i + 1]}`;
		} else {
			merged.push(p);
		}
	}
	return merged;
}

export function shouldTranslateThinking(text: string): boolean {
	const withoutFencedCode = text.replace(/^\s{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s{0,3}\1\s*$/gm, "");
	const withoutInlineCode = withoutFencedCode.replace(/`[^`\n]+`/g, "");
	const trimmed = withoutInlineCode.trim();
	return trimmed.length > 0 && /[a-zA-Z]/.test(trimmed);
}

function toTranslationQuote(translation: string): string {
	return translation
		.trim()
		.replace(/\r\n/g, "\n")
		.split("\n")
		.map((line) => (line.trim() ? `> ${line}` : ">"))
		.join("\n");
}

export function formatTranslatedThinking(
	markdown: string,
	getTranslation: (paragraph: string) => string | undefined,
): string {
	const trimmedMarkdown = markdown.trim();
	if (!trimmedMarkdown) return markdown;

	const paragraphs = splitThinkingParagraphs(trimmedMarkdown);
	if (paragraphs.length === 0) return markdown;

	let hasParagraphTranslation = false;
	const rendered: string[] = [];

	for (let i = 0; i < paragraphs.length; i++) {
		const paragraph = paragraphs[i];
		const rawTranslation = getTranslation(paragraph)?.trim();
		if (!rawTranslation) {
			rendered.push(paragraph);
			continue;
		}
		const quoted = toTranslationQuote(rawTranslation);
		if (paragraph.includes(quoted) || paragraphs[i + 1] === quoted) {
			rendered.push(paragraph);
			continue;
		}
		hasParagraphTranslation = true;
		rendered.push(`${paragraph}\n\n${quoted}`);
	}

	if (hasParagraphTranslation) {
		return rendered.join("\n\n");
	}

	if (paragraphs.length > 1) {
		const wholeTranslation = getTranslation(trimmedMarkdown)?.trim();
		if (wholeTranslation) {
			const quoted = toTranslationQuote(wholeTranslation);
			if (!markdown.includes(quoted) && !markdown.includes(wholeTranslation)) {
				return `${markdown}\n\n${quoted}`;
			}
		}
	}

	return markdown;
}
