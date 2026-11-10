import type { ThinkingLevel } from "@earendil-works/pi-ai";

export interface TranslatorConfig {
	enabled: boolean;
	sourceModels: string[];
	translatorModel: string;
	translatorThinking: ThinkingLevel;
}

export const DEFAULT_CONFIG: TranslatorConfig = {
	enabled: true,
	sourceModels: ["magpie/agy-cli/gemini-4-argon"],
	translatorModel: "magpie/group/ds-flash",
	translatorThinking: "low",
};

export const VALID_THINKING_LEVELS: ThinkingLevel[] = ["low", "minimal", "off", "medium", "high", "xhigh", "max"];

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

export function matchesSourceModel(
	sourceModels: readonly string[],
	msgProvider?: string,
	msgModel?: string,
	activeModel?: { provider: string; id: string },
): boolean {
	if (sourceModels.length === 0) return false;
	const candidates = new Set<string>();
	if (msgProvider && msgModel) candidates.add(`${msgProvider}/${msgModel}`.toLowerCase());
	if (msgModel) candidates.add(msgModel.toLowerCase());
	if (activeModel) {
		candidates.add(`${activeModel.provider}/${activeModel.id}`.toLowerCase());
		candidates.add(activeModel.id.toLowerCase());
	}
	for (const pattern of sourceModels) {
		const normalized = pattern.trim().toLowerCase();
		if (normalized && candidates.has(normalized)) {
			return true;
		}
	}
	return false;
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

export function shouldTranslateThinking(text: string): boolean {
	const trimmed = text.trim();
	return trimmed.length > 0 && /[a-zA-Z]/.test(trimmed);
}

export function formatTranslatedThinking(markdown: string, translation: string | undefined): string {
	const trimmedTranslation = translation?.trim();
	if (!trimmedTranslation) return markdown;
	if (markdown.includes(trimmedTranslation)) return markdown;
	return `${markdown}\n\n---\n\n${trimmedTranslation}`;
}
