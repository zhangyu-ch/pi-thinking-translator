import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	getAgentDir,
	getSelectListTheme,
	getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import { Container, type SelectItem, SelectList, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";
import {
	DEFAULT_CONFIG,
	extractThinkingRuns,
	formatTranslatedThinking,
	matchesSourceModel,
	parseProviderAndModel,
	shouldTranslateThinking,
	type TranslatorConfig,
	VALID_THINKING_LEVELS,
} from "./core.ts";

interface TranslationCacheEntry {
	source: string;
	translation: string;
}

const TRANSLATION_TIMEOUT_MS = 30_000;
const CUSTOM_ENTRY_TYPE = "thinking-translation";

const SYSTEM_PROMPT =
	"You are a professional technical translator. Translate the following AI thinking process (chain-of-thought) from English into concise, natural Chinese. Keep Markdown formatting, code blocks, identifiers, file paths, and technical terms intact. Output ONLY the translated Chinese text without any preamble or explanation.";

function getConfigPath(): string {
	return join(getAgentDir(), "thinking-translator.json");
}

function loadConfig(): TranslatorConfig {
	const path = getConfigPath();
	if (!existsSync(path)) {
		return { ...DEFAULT_CONFIG, sourceModels: [...DEFAULT_CONFIG.sourceModels] };
	}
	try {
		const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<TranslatorConfig>;
		return {
			enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_CONFIG.enabled,
			sourceModels: Array.isArray(raw.sourceModels)
				? raw.sourceModels.filter((m): m is string => typeof m === "string" && m.trim().length > 0)
				: [...DEFAULT_CONFIG.sourceModels],
			translatorModel:
				typeof raw.translatorModel === "string" && raw.translatorModel.trim()
					? raw.translatorModel.trim()
					: DEFAULT_CONFIG.translatorModel,
			translatorThinking:
				typeof raw.translatorThinking === "string" &&
				VALID_THINKING_LEVELS.includes(raw.translatorThinking as ThinkingLevel)
					? (raw.translatorThinking as ThinkingLevel)
					: DEFAULT_CONFIG.translatorThinking,
		};
	} catch {
		return { ...DEFAULT_CONFIG, sourceModels: [...DEFAULT_CONFIG.sourceModels] };
	}
}

function saveConfig(config: TranslatorConfig): void {
	const path = getConfigPath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

export default function thinkingTranslatorExtension(pi: ExtensionAPI) {
	let config = loadConfig();
	const translations = new Map<string, string>();
	const inFlight = new Map<string, string>();
	const inFlightPromises = new Map<string, Promise<string | undefined>>();
	const persistedKeys = new Set<string>();

	function restoreTranslationsFromBranch(ctx: ExtensionContext) {
		translations.clear();
		persistedKeys.clear();
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === CUSTOM_ENTRY_TYPE) {
				const data = entry.data as TranslationCacheEntry | undefined;
				if (data?.source && data?.translation) {
					translations.set(data.source, data.translation);
					persistedKeys.add(data.source);
				}
			}
		}
	}

	function resolveTranslatorModel(ctx: ExtensionContext) {
		const { provider, modelId } = parseProviderAndModel(config.translatorModel);
		if (provider) {
			const exact = ctx.modelRegistry.find(provider, modelId);
			if (exact) return exact;
		}
		return ctx.modelRegistry.getAll().find((m) => `${m.provider}/${m.id}` === config.translatorModel || m.id === modelId);
	}

	function translateText(sourceText: string, ctx: ExtensionContext): Promise<string | undefined> {
		const key = sourceText.trim();
		if (!shouldTranslateThinking(key)) return Promise.resolve(undefined);

		const cached = translations.get(key);
		if (cached) return Promise.resolve(cached);

		const existingPromise = inFlightPromises.get(key);
		if (existingPromise) return existingPromise;

		const model = resolveTranslatorModel(ctx);
		if (!model) {
			return Promise.resolve(undefined);
		}

		const promise = (async (): Promise<string | undefined> => {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), TRANSLATION_TIMEOUT_MS);
			const onAbort = () => controller.abort();
			ctx.signal?.addEventListener("abort", onAbort, { once: true });

			try {
				inFlight.set(key, "⏳ 正在翻译思维链...");
				const stream = ctx.modelRegistry.streamSimple(
					model,
					{
						systemPrompt: SYSTEM_PROMPT,
						messages: [
							{
								role: "user",
								content: [{ type: "text", text: key }],
								timestamp: Date.now(),
							},
						],
					},
					{
						reasoning: config.translatorThinking,
						cacheRetention: "none",
						signal: controller.signal,
					},
				);

				let partial = "";
				for await (const ev of stream) {
					if (ev.type === "text_delta" && ev.delta) {
						partial += ev.delta;
						inFlight.set(key, partial.trim());
					}
				}

				const result = await stream.result();
				const finalText = result.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("")
					.trim();

				if (finalText) {
					translations.set(key, finalText);
					if (!persistedKeys.has(key)) {
						persistedKeys.add(key);
						pi.appendEntry<TranslationCacheEntry>(CUSTOM_ENTRY_TYPE, {
							source: key,
							translation: finalText,
						});
					}
					return finalText;
				}
				return undefined;
			} catch {
				return undefined;
			} finally {
				clearTimeout(timer);
				ctx.signal?.removeEventListener("abort", onAbort);
				inFlight.delete(key);
				inFlightPromises.delete(key);
			}
		})();

		inFlightPromises.set(key, promise);
		return promise;
	}

	pi.registerMarkdownTransformer(
		(markdown) => {
			if (!config.enabled) return markdown;
			const key = markdown.trim();
			if (!key) return markdown;
			const translated = translations.get(key) ?? inFlight.get(key);
			return formatTranslatedThinking(markdown, translated);
		},
		{ messageTypes: ["assistant-thinking"] },
	);

	pi.on("session_start", async (_event, ctx) => {
		config = loadConfig();
		restoreTranslationsFromBranch(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		restoreTranslationsFromBranch(ctx);
	});

	pi.on("message_update", async (event, ctx) => {
		if (!config.enabled || event.message.role !== "assistant") return;
		if (!matchesSourceModel(config.sourceModels, event.message.provider, event.message.model, ctx.model)) return;

		if (event.assistantMessageEvent.type === "thinking_end") {
			void translateText(event.assistantMessageEvent.content, ctx);
		}
	});

	pi.on("message_end", async (event, ctx) => {
		if (!config.enabled || event.message.role !== "assistant") return;
		if (!matchesSourceModel(config.sourceModels, event.message.provider, event.message.model, ctx.model)) return;

		const { blocks, runs } = extractThinkingRuns(event.message.content);
		if (blocks.length === 0) return;

		await Promise.all(blocks.map((block) => translateText(block, ctx)));

		for (const run of runs) {
			if (run.length <= 1) continue;
			const runKey = run.join("\n\n");
			if (translations.has(runKey)) continue;
			const translatedParts = run.map((block) => translations.get(block)).filter((t): t is string => Boolean(t));
			if (translatedParts.length === run.length) {
				translations.set(runKey, translatedParts.join("\n\n"));
			}
		}
	});

	async function openConfigUi(ctx: ExtensionCommandContext) {
		const allModels = ctx.modelRegistry.getAll().map((m) => `${m.provider}/${m.id}`);
		const modelSet = new Set<string>([...config.sourceModels, ...DEFAULT_CONFIG.sourceModels, ...allModels]);
		const selectedSet = new Set<string>(config.sourceModels);

		const sortedModels = Array.from(modelSet).sort((a, b) => {
			const aSel = selectedSet.has(a) ? 0 : 1;
			const bSel = selectedSet.has(b) ? 0 : 1;
			if (aSel !== bSel) return aSel - bSel;
			return a.localeCompare(b);
		});

		await ctx.ui.custom((tui, theme, _kb, done) => {
			const items: SettingItem[] = [
				{
					id: "__enabled__",
					label: "插件开关 (Enabled)",
					description: "是否自动翻译选中模型的英文思维链",
					currentValue: config.enabled ? "开启" : "关闭",
					values: ["开启", "关闭"],
				},
				{
					id: "__translator_model__",
					label: "翻译模型 (Translator Model)",
					description: "用于翻译思维链的模型 (Enter 选择)",
					currentValue: config.translatorModel,
					submenu: (currentVal, submenuDone) => {
						const selectItems: SelectItem[] = Array.from(modelSet).map((m) => ({
							value: m,
							label: m === currentVal ? `${m} (当前)` : m,
						}));
						const selectList = new SelectList(
							selectItems,
							Math.min(selectItems.length + 2, 12),
							getSelectListTheme(),
						);
						selectList.onSelect = (item) => {
							config.translatorModel = item.value;
							saveConfig(config);
							submenuDone(item.value);
						};
						selectList.onCancel = () => submenuDone();
						return selectList;
					},
				},
				{
					id: "__translator_thinking__",
					label: "翻译思考等级 (Translator Thinking)",
					description: "翻译模型使用的思考预算等级 (默认 low)",
					currentValue: config.translatorThinking,
					values: VALID_THINKING_LEVELS,
				},
				...sortedModels.map(
					(modelId): SettingItem => ({
						id: `model:${modelId}`,
						label: `[源模型] ${modelId}`,
						description: "按 Enter/Space 切换是否翻译该模型的思维链（支持多选）",
						currentValue: selectedSet.has(modelId) ? "✓ 已选中" : "未选中",
						values: ["✓ 已选中", "未选中"],
					}),
				),
			];

			const container = new Container();
			container.addChild(
				new Text(
					`${theme.fg("accent", theme.bold("思维链翻译配置 (Thinking Translator)"))} ${theme.fg("dim", "— 输入可搜索过滤，Enter/Space 切换，Esc 关闭")}`,
					0,
					0,
				),
			);

			const settingsList = new SettingsList(
				items,
				Math.min(items.length + 2, 16),
				getSettingsListTheme(),
				(id, newValue) => {
					if (id === "__enabled__") {
						config.enabled = newValue === "开启";
					} else if (id === "__translator_thinking__") {
						config.translatorThinking = newValue as ThinkingLevel;
					} else if (id.startsWith("model:")) {
						const modelId = id.slice("model:".length);
						if (newValue === "✓ 已选中") {
							selectedSet.add(modelId);
						} else {
							selectedSet.delete(modelId);
						}
						config.sourceModels = Array.from(selectedSet);
					}
					saveConfig(config);
				},
				() => done(undefined),
				{ enableSearch: true },
			);

			container.addChild(settingsList);

			return {
				capturesViewportInput: settingsList.capturesViewportInput,
				render: (width: number) => container.render(width),
				invalidate: () => container.invalidate(),
				handleInput: (data: string) => {
					settingsList.handleInput(data);
					tui.requestRender();
				},
			};
		});
	}

	pi.registerCommand("thinking-translate", {
		description: "配置英文思维链自动翻译 (支持多选源模型、指定翻译模型)",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const sub = parts[0]?.toLowerCase();

			if (!sub) {
				if (ctx.mode === "tui") {
					await openConfigUi(ctx);
					return;
				}
				ctx.ui.notify(
					`思维链翻译: ${config.enabled ? "开启" : "关闭"} | 源模型: ${config.sourceModels.join(", ")} | 翻译模型: ${config.translatorModel} (${config.translatorThinking})`,
					"info",
				);
				return;
			}

			if (sub === "status") {
				ctx.ui.notify(
					`思维链翻译: ${config.enabled ? "开启" : "关闭"} | 源模型: ${config.sourceModels.join(", ") || "(无)"} | 翻译模型: ${config.translatorModel} (${config.translatorThinking})`,
					"info",
				);
				return;
			}

			if (sub === "on" || sub === "enable") {
				config.enabled = true;
				saveConfig(config);
				ctx.ui.notify("已开启思维链自动翻译", "info");
				return;
			}

			if (sub === "off" || sub === "disable") {
				config.enabled = false;
				saveConfig(config);
				ctx.ui.notify("已关闭思维链自动翻译", "info");
				return;
			}

			if (sub === "add" && parts[1]) {
				const modelId = parts[1].trim();
				if (!config.sourceModels.includes(modelId)) {
					config.sourceModels.push(modelId);
					saveConfig(config);
				}
				ctx.ui.notify(`已添加源模型: ${modelId} (当前: ${config.sourceModels.join(", ")})`, "info");
				return;
			}

			if ((sub === "remove" || sub === "del") && parts[1]) {
				const modelId = parts[1].trim();
				config.sourceModels = config.sourceModels.filter((m) => m !== modelId);
				saveConfig(config);
				ctx.ui.notify(`已移除源模型: ${modelId} (当前: ${config.sourceModels.join(", ") || "无"})`, "info");
				return;
			}

			if (sub === "translator" && parts[1]) {
				config.translatorModel = parts[1].trim();
				if (parts[2] && VALID_THINKING_LEVELS.includes(parts[2] as ThinkingLevel)) {
					config.translatorThinking = parts[2] as ThinkingLevel;
				}
				saveConfig(config);
				ctx.ui.notify(`已设置翻译模型: ${config.translatorModel} (${config.translatorThinking})`, "info");
				return;
			}

			ctx.ui.notify(
				"用法: /thinking-translate [status | on | off | add <model> | remove <model> | translator <model> [thinking]]",
				"info",
			);
		},
	});
}
