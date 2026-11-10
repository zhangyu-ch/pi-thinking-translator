import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	DEFAULT_CONFIG,
	extractThinkingRuns,
	formatTranslatedThinking,
	matchesSourceModel,
	parseProviderAndModel,
	shouldTranslateThinking,
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
		const models = [...DEFAULT_CONFIG.sourceModels, "sub2api/grok-4.7"];
		assert.equal(matchesSourceModel(models, "magpie", "agy-cli/gemini-4-argon"), true);
		assert.equal(matchesSourceModel(models, "sub2api", "grok-4.7"), true);
		assert.equal(matchesSourceModel(models, "magpie", "group/ds-flash"), false);
		assert.equal(
			matchesSourceModel(models, undefined, undefined, { provider: "magpie", id: "agy-cli/gemini-4-argon" }),
			true,
		);
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
