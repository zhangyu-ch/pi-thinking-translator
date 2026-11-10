import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	DEFAULT_CONFIG,
	extractThinkingRuns,
	formatTranslatedThinking,
	isDefaultSourceModel,
	matchesSourceModel,
	parseProviderAndModel,
	setSourceModelSelected,
	shouldTranslateThinking,
	syncDefaultSourceModels,
	type TranslatorConfig,
} from "../src/core.ts";

describe("pi-thinking-translator core", () => {
	it("parses provider and model with nested slashes", () => {
		assert.deepEqual(parseProviderAndModel("magpie/agy-cli/gemini-4-argon"), {
			provider: "magpie",
			modelId: "agy-cli/gemini-4-argon",
		});
		assert.deepEqual(parseProviderAndModel("magpie/group/ds-flash"), {
			provider: "magpie",
			modelId: "group/ds-flash",
		});
		assert.deepEqual(parseProviderAndModel("gemini-4-argon"), {
			modelId: "gemini-4-argon",
		});
	});

	it("matches configured source models accurately (multi-select)", () => {
		const models = ["magpie/agy-cli/gemini-4-argon", "sub2api/grok-4.7"];
		assert.equal(matchesSourceModel(models, "magpie", "agy-cli/gemini-4-argon"), true);
		assert.equal(matchesSourceModel(models, "sub2api", "grok-4.7"), true);
		assert.equal(matchesSourceModel(models, "magpie", "group/ds-flash"), false);
		assert.equal(
			matchesSourceModel(models, undefined, undefined, { provider: "magpie", id: "agy-cli/gemini-4-argon" }),
			true,
		);
	});

	it("identifies gemini, ds, and deepseek models as default source models", () => {
		assert.equal(isDefaultSourceModel({ provider: "magpie", id: "agy-cli/gemini-4-argon" }), true);
		assert.equal(isDefaultSourceModel({ provider: "magpie", id: "agy-cli/gemini-4-carbon" }), true);
		assert.equal(isDefaultSourceModel({ provider: "magpie", id: "group/ds-flash" }), true);
		assert.equal(isDefaultSourceModel({ provider: "sub2claude", id: "deepseek-v4-pro" }), true);
		assert.equal(isDefaultSourceModel({ provider: "sub2claude", id: "deepseek-flash" }), true);
		assert.equal(isDefaultSourceModel({ provider: "custom", id: "r1", name: "DeepSeek R1" }), true);
		assert.equal(isDefaultSourceModel({ provider: "sub2满血", id: "gpt-5.6-sol" }), false);
		assert.equal(isDefaultSourceModel({ provider: "magpie", id: "sanyee/claude-sonnet-5-5" }), false);
		assert.equal(isDefaultSourceModel({ provider: "windsurf", id: "gpt-5-threads" }), false);
	});

	it("auto-syncs local gemini/ds/deepseek models while respecting user exclusions", () => {
		const config: TranslatorConfig = {
			...DEFAULT_CONFIG,
			sourceModels: [],
			excludedModels: [],
		};
		const localModels = [
			{ provider: "magpie", id: "group/ds-flash" },
			{ provider: "magpie", id: "agy-cli/gemini-4-argon" },
			{ provider: "magpie", id: "agy-cli/gemini-4-carbon" },
			{ provider: "sub2claude", id: "deepseek-v4-pro" },
			{ provider: "sub2满血", id: "gpt-5.6-sol" },
			{ provider: "sub2api", id: "grok-4.7" },
		];

		assert.equal(syncDefaultSourceModels(config, localModels), true);
		assert.deepEqual(config.sourceModels, [
			"magpie/group/ds-flash",
			"magpie/agy-cli/gemini-4-argon",
			"magpie/agy-cli/gemini-4-carbon",
			"sub2claude/deepseek-v4-pro",
		]);

		// User unchecks one default model; subsequent sync must not re-add it
		setSourceModelSelected(config, "magpie/group/ds-flash", false);
		assert.equal(syncDefaultSourceModels(config, localModels), false);
		assert.equal(config.sourceModels.includes("magpie/group/ds-flash"), false);

		// Re-selecting clears exclusion
		setSourceModelSelected(config, "magpie/group/ds-flash", true);
		assert.equal(config.sourceModels.includes("magpie/group/ds-flash"), true);
		assert.deepEqual(config.excludedModels, []);
	});

	it("extracts consecutive and separated thinking runs", () => {
		const content = [
			{ type: "thinking", thinking: "First thought." },
			{ type: "thinking", thinking: "Second thought." },
			{ type: "toolCall", id: "1", name: "read", arguments: {} },
			{ type: "thinking", thinking: "Third thought after tool." },
			{ type: "text", text: "Final answer." },
		];
		const { blocks, runs } = extractThinkingRuns(content);
		assert.deepEqual(blocks, ["First thought.", "Second thought.", "Third thought after tool."]);
		assert.deepEqual(runs, [["First thought.", "Second thought."], ["Third thought after tool."]]);
	});

	it("checks if thinking text requires translation", () => {
		assert.equal(shouldTranslateThinking("We need to check the config file."), true);
		assert.equal(shouldTranslateThinking("   "), false);
		assert.equal(shouldTranslateThinking("纯中文思考内容"), false);
	});

	it("formats translated thinking below original markdown without duplication", () => {
		const original = "Let us inspect the directory.";
		const translation = "让我们检查一下目录。";
		const formatted = formatTranslatedThinking(original, translation);
		assert.equal(formatted, "Let us inspect the directory.\n\n---\n\n让我们检查一下目录。");
		assert.equal(formatTranslatedThinking(formatted, translation), formatted);
	});
});
