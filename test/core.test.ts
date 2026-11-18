import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	DEFAULT_CONFIG,
	extractThinkingRuns,
	formatTranslatedThinking,
	parseProviderAndModel,
	setModelExcluded,
	shouldTranslateModel,
	shouldTranslateThinking,
	splitThinkingParagraphs,
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

	it("translates every model by default and honors exclusions", () => {
		assert.equal(shouldTranslateModel([], "magpie", "agy-cli/gemini-4-argon"), true);
		assert.equal(shouldTranslateModel([], "sub2api", "grok-4.7"), true);
		assert.equal(shouldTranslateModel([], "sub2满血", "gpt-5.6-sol"), true);
		assert.equal(shouldTranslateModel([], "magpie", "sanyee/claude-sonnet-5-5"), true);

		const excluded = ["sub2api/grok-4.7", "gpt-5.6-sol"];
		assert.equal(shouldTranslateModel(excluded, "sub2api", "grok-4.7"), false);
		assert.equal(shouldTranslateModel(excluded, "another-provider", "gpt-5.6-sol"), false);
		assert.equal(shouldTranslateModel(excluded, "magpie", "group/ds-flash"), true);
		assert.equal(
			shouldTranslateModel(excluded, undefined, undefined, { provider: "sub2api", id: "grok-4.7" }),
			false,
		);
	});

	it("toggles model exclusions without duplicates", () => {
		const config: TranslatorConfig = {
			...DEFAULT_CONFIG,
			excludedModels: [],
		};

		setModelExcluded(config, "magpie/group/ds-flash", true);
		setModelExcluded(config, "magpie/group/ds-flash", true);
		assert.deepEqual(config.excludedModels, ["magpie/group/ds-flash"]);
		assert.equal(shouldTranslateModel(config.excludedModels, "magpie", "group/ds-flash"), false);

		setModelExcluded(config, "magpie/group/ds-flash", false);
		assert.deepEqual(config.excludedModels, []);
		assert.equal(shouldTranslateModel(config.excludedModels, "magpie", "group/ds-flash"), true);
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

	it("splits thinking into paragraphs while preserving code fences and attaching headings", () => {
		const raw = [
			"### Phase 1",
			"",
			"First paragraph checking requirements.",
			"",
			"```ts",
			"const a = 1;",
			"",
			"const b = 2;",
			"```",
			"",
			"*   Bullet paragraph one.",
			"",
			"*   Bullet paragraph two.",
		].join("\n");

		assert.deepEqual(splitThinkingParagraphs(raw), [
			"### Phase 1\n\nFirst paragraph checking requirements.",
			"```ts\nconst a = 1;\n\nconst b = 2;\n```",
			"*   Bullet paragraph one.",
			"*   Bullet paragraph two.",
		]);
	});

	it("checks if thinking text requires translation", () => {
		assert.equal(shouldTranslateThinking("We need to check the config file."), true);
		assert.equal(shouldTranslateThinking("   "), false);
		assert.equal(shouldTranslateThinking("纯中文思考内容"), false);
		assert.equal(shouldTranslateThinking("检查 `src/index.ts` 的实现"), false);
		assert.equal(shouldTranslateThinking("```ts\nconst x = 1;\n\nreturn x;\n```"), false);
	});

	it("formats per-paragraph translations directly below each paragraph without duplication", () => {
		const p1 = "Let us inspect the directory.";
		const p2 = "Next, verify external links and CSS.";
		const p3 = "Finally, run the test suite.";
		const map = new Map<string, string>([
			[p1, "让我们检查一下目录。"],
			[p2, "接下来，验证外链与 CSS。\n\n确保无外部依赖。"],
		]);

		const markdown = `${p1}\n\n${p2}\n\n${p3}`;
		const formatted = formatTranslatedThinking(markdown, (s) => map.get(s));
		assert.equal(
			formatted,
			[
				"Let us inspect the directory.",
				"",
				"> 让我们检查一下目录。",
				"",
				"Next, verify external links and CSS.",
				"",
				"> 接下来，验证外链与 CSS。\n>\n> 确保无外部依赖。",
				"",
				"Finally, run the test suite.",
			].join("\n"),
		);

		// Idempotent when called again on already-transformed markdown
		assert.equal(formatTranslatedThinking(formatted, (s) => map.get(s)), formatted);

		// Falls back to legacy whole-block cache if no per-paragraph entry exists
		const legacyOnly = new Map<string, string>([[markdown, "整段旧缓存译文。"]]);
		assert.equal(
			formatTranslatedThinking(markdown, (s) => legacyOnly.get(s)),
			`${markdown}\n\n> 整段旧缓存译文。`,
		);

		// Untouched when no translation exists
		assert.equal(formatTranslatedThinking(markdown, () => undefined), markdown);
	});
});
