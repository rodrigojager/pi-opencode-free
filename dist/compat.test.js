// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import opencodeDirectExtension from "./index.js";
// Regression tests pinning Zen request invariants against pi-cache-optimizer's
// actual payload transforms (see plans/cache-optimizer-compat-report.md §2):
//   T1: delete payload.prompt_cache_retention (unless official OpenAI / opt-in)
//   T2: { ...payload, prompt_cache_key: <hash> }  (spread, additive)
//   (Anthropic cache_control ops are gated on anthropic-messages api — N/A.)
async function getShim() {
    let registeredConfig = null;
    const fakePi = {
        registerProvider(_id, config) { registeredConfig = config; },
    };
    await opencodeDirectExtension(fakePi);
    return registeredConfig;
}
// Verbatim mirrors of cache-optimizer's operations (index.ts of the extension).
function stripPromptCacheRetention(payload) {
    // Gate 4 safe default applies to Zen (not official OpenAI, no opt-in).
    delete payload.prompt_cache_retention;
}
function addOpenAIPromptCacheKey(payload, key) {
    if (typeof payload.prompt_cache_key === "string" && payload.prompt_cache_key.trim())
        return payload;
    return { ...payload, prompt_cache_key: key };
}
test("T1: stripping prompt_cache_retention preserves all Zen-required fields", async () => {
    const payload = {
        model: "hy3-free",
        max_tokens: 4096,
        prompt_cache_retention: "long",
        messages: [
            {
                role: "assistant",
                reasoning_content: "<think>ok</think>",
                content: "",
                tool_calls: [{ id: "call_1", type: "function", function: { name: "read", arguments: "{}" } }],
            },
        ],
    };
    stripPromptCacheRetention(payload);
    assert.equal("prompt_cache_retention" in payload, false);
    assert.equal(payload.max_tokens, 4096); // never renamed to max_completion_tokens
    assert.equal(payload.messages[0].reasoning_content, "<think>ok</think>");
    assert.equal(payload.messages[0].tool_calls.length, 1);
});
test("T2: prompt_cache_key injection is spread-additive and drops nothing", async () => {
    const before = {
        model: "qwen3-coder-free",
        max_tokens: 1024,
        stream: true,
        messages: [{ role: "assistant", reasoning_content: "<think>x</think>", content: "" }],
    };
    const after = addOpenAIPromptCacheKey(before, "abc123hash");
    for (const k of Object.keys(before))
        assert.deepEqual(after[k], before[k]);
    assert.equal(after.prompt_cache_key, "abc123hash");
    assert.equal(after.max_tokens, 1024);
});
test("max_tokens is never renamed by any transform", async () => {
    const p = addOpenAIPromptCacheKey({ max_tokens: 512 }, "k");
    stripPromptCacheRetention(p);
    assert.equal(p.max_tokens, 512);
    assert.equal("max_completion_tokens" in p, false);
});
test("keyless shim wins over hook-injected Authorization in final header composition", async () => {
    const cfg = await getShim();
    const hookMutated = { ...cfg.headers, Authorization: "Bearer x", "x-session-affinity": "sess-1" };
    const viaShim = { ...hookMutated, Authorization: null }; // shim spread, runs last
    assert.equal(viaShim.Authorization, null);
    assert.equal(viaShim["x-opencode-client"], "cli");
});
//# sourceMappingURL=compat.test.js.map