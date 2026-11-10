import type { ThinkingLevel } from "@earendil-works/pi-ai";

export interface TranslatorConfig {
	enabled: boolean;
	sourceModels: string[];
	excludedModels?: string[];
	translatorModel: string;
	translatorThinking: ThinkingLevel;
}

export interface AvailableModelInfo {
	provider: string;
	id: string;
	name?: string;
}

export const DEFAULT_CONFIG: TranslatorConfig = {
	enabled: true,
	sourceModels: [],
	excludedModels: [],
	translatorModel: "magpie/group/ds-flash",
	translatorThinking: "low",
};

export const VALID_THINKING_LEVELS: ThinkingLevel[] = ["low", "minimal", "off", "medium", "high", "xhigh", "max"];

const DEFAULT_SOURCE_MODEL_RE = /(?:gemini|deepseek|(?<![a-z])ds)/i;

export function isDefaultSourceModel(modelOrSpec: string | AvailableModelInfo): boolean {
	if (typeof modelOrSpec === "string") {
		return DEFAULT_SOURCE_MODEL_RE.test(modelOrSpec);
	}
	return (
		DEFAULT_SOURCE_MODEL_RE.test(`${modelOrSpec.provider}/${modelOrSpec.id}`) ||
		(Boolean(modelOrSpec.name) && DEFAULT_SOURCE_MODEL_RE.test(modelOrSpec.name!))
	);
}

export function syncDefaultSourceModels(
	config: TranslatorConfig,
	availableModels: readonly AvailableModelInfo[],
): boolean {
	const existing = new Set(config.sourceModels.map((m) => m.trim().toLowerCase()));
	const excluded = new Set((config.excludedModels ?? []).map((m) => m.trim().toLowerCase()));
	let changed = false;

	for (const model of availableModels) {
		if (!isDefaultSourceModel(model)) continue;
		const fullId = `${model.provider}/${model.id}`;
		const key = fullId.toLowerCase();
		if (existing.has(key) || excluded.has(key)) continue;
		config.sourceModels.push(fullId);
		existing.add(key);
		changed = true;
	}

	return changed;
}

export function setSourceModelSelected(config: TranslatorConfig, modelId: string, selected: boolean): void {
	const trimmed = modelId.trim();
	if (!trimmed) return;
	const key = trimmed.toLowerCase();
	const sourceFiltered = config.sourceModels.filter((m) => m.trim().toLowerCase() !== key);
	const excludedFiltered = (config.excludedModels ?? []).filter((m) => m.trim().toLowerCase() !== key);

	if (selected) {
		config.sourceModels = [...sourceFiltered, trimmed];
		config.excludedModels = excludedFiltered;
	} else {
		config.sourceModels = sourceFiltered;
		config.excludedModels = [...excludedFiltered, trimmed];
	}
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
