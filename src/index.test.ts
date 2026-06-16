import { describe, expect, it, mock } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import { Effect } from "effect"

// Mock the external dependencies before importing the plugin
const dedupChatCompletionsMock = mock(() => ({ charsSaved: 0, blocksDeduped: 0, blocksTotal: 0, systemBlocksMatched: 0 }))

mock.module("./engine/dedup.js", () => ({
  dedupChatCompletions: dedupChatCompletionsMock,
}))

mock.module("node:fs", () => ({ appendFileSync: mock(), mkdirSync: mock() }))


import pluginDefault, { ContextPilotPlugin } from "./index.js"

// ── Helpers ─────────────────────────────────────────────────────────────

interface OpenCodeMessage {
  info: { id: string; role: string; sessionID: string }
  parts: Array<{
    id: string; sessionID: string; messageID: string; type: string;
    callID?: string; tool?: string;
    state?: { status: string; output?: string };
    text?: string;
  }>
}

type TransformHook = NonNullable<Awaited<ReturnType<typeof ContextPilotPlugin>>["experimental.chat.messages.transform"]>

const transformInput: Parameters<TransformHook>[0] = {}
const toolContext: ToolContext = {
  sessionID: "s1",
  messageID: "m1",
  agent: "test",
  directory: "/tmp",
  worktree: "/tmp",
  abort: new AbortController().signal,
  metadata() {},
  ask() {
    return Effect.void
  },
}

function transformOutput(messages: OpenCodeMessage[]): Parameters<TransformHook>[1] {
  return { messages: messages.map((message) => ({ info: message.info, parts: message.parts })) }
}

function completeDedupResult(charsSaved: number) {
  return {
    charsSaved,
    blocksDeduped: charsSaved > 0 ? 2 : 0,
    blocksTotal: charsSaved > 0 ? 4 : 0,
    systemBlocksMatched: 0,
    charsBefore: charsSaved,
    charsAfter: 0,
  }
}

function makeToolMessage(id: string, parts: Array<{ partId: string; callID: string; tool: string; output: string }>): OpenCodeMessage {
  return {
    info: { id, role: "assistant", sessionID: "s1" },
    parts: parts.map((p) => ({
      id: p.partId,
      sessionID: "s1",
      messageID: id,
      type: "tool",
      callID: p.callID,
      tool: p.tool,
      state: { status: "completed", output: p.output },
    })),
  }
}

function makeTextMessage(id: string, role: string, text: string): OpenCodeMessage {
  return {
    info: { id, role, sessionID: "s1" },
    parts: [{ id: `${id}-p1`, sessionID: "s1", messageID: id, type: "text", text }],
  }
}

const LONG_OUTPUT = "x".repeat(200)

// ── Tests ───────────────────────────────────────────────────────────────

describe("plugin export format", () => {
  it("default export has id 'contextpilot' and server function", () => {
    expect(pluginDefault.id).toBe("contextpilot")
    expect(typeof pluginDefault.server).toBe("function")
  })
})

describe("plugin initialization", () => {
  it("server() returns hooks with transform and contextpilot_status tool", async () => {
    const hooks = await ContextPilotPlugin()
    expect(hooks["experimental.chat.messages.transform"]).toBeDefined()
    expect(typeof hooks["experimental.chat.messages.transform"]).toBe("function")
    expect(hooks.tool).toBeDefined()
    expect(hooks.tool!.contextpilot_status).toBeDefined()
  })
})

describe("single-doc cross-turn dedup", () => {
  it("replaces duplicate tool output with a hint on second occurrence", async () => {
    const hooks = await ContextPilotPlugin()
    const transform = hooks["experimental.chat.messages.transform"]!

    const msg1 = makeToolMessage("m1", [{ partId: "p1", callID: "c1", tool: "read_file", output: LONG_OUTPUT }])
    const msg2 = makeToolMessage("m2", [{ partId: "p2", callID: "c2", tool: "read_file", output: LONG_OUTPUT }])
    const messages = [msg1, msg2]

    await transform(transformInput, transformOutput(messages))

    expect(msg1.parts[0]!.state!.output).toBe(LONG_OUTPUT)
    expect(msg2.parts[0]!.state!.output).toContain("Duplicate")
    expect(msg2.parts[0]!.state!.output).toContain("c1")
  })
})

describe("no dedup for short outputs", () => {
  it("outputs under 100 chars are not deduped", async () => {
    const hooks = await ContextPilotPlugin()
    const transform = hooks["experimental.chat.messages.transform"]!

    const shortOutput = "short"
    const msg1 = makeToolMessage("m1", [{ partId: "p1", callID: "c1", tool: "read_file", output: shortOutput }])
    const msg2 = makeToolMessage("m2", [{ partId: "p2", callID: "c2", tool: "read_file", output: shortOutput }])
    const messages = [msg1, msg2]

    await transform(transformInput, transformOutput(messages))

    expect(msg1.parts[0]!.state!.output).toBe(shortOutput)
    expect(msg2.parts[0]!.state!.output).toBe(shortOutput)
  })
})

describe("no dedup on first occurrence", () => {
  it("first time seeing content, output is unchanged", async () => {
    const hooks = await ContextPilotPlugin()
    const transform = hooks["experimental.chat.messages.transform"]!

    const msg = makeToolMessage("m1", [{ partId: "p1", callID: "c1", tool: "read_file", output: LONG_OUTPUT }])
    const messages = [msg]

    await transform(transformInput, transformOutput(messages))

    expect(msg.parts[0]!.state!.output).toBe(LONG_OUTPUT)
  })
})

describe("block-level dedup", () => {
  it("fires dedupChatCompletions and saves chars when blocks are shared", async () => {
    dedupChatCompletionsMock.mockReturnValueOnce(completeDedupResult(500))

    const hooks = await ContextPilotPlugin()
    const transform = hooks["experimental.chat.messages.transform"]!

    const msg1 = makeToolMessage("m1", [{ partId: "p1", callID: "c1", tool: "read_file", output: "unique-a-" + "z".repeat(200) }])
    const msg2 = makeToolMessage("m2", [{ partId: "p2", callID: "c2", tool: "read_file", output: "unique-b-" + "z".repeat(200) }])
    const messages = [msg1, msg2]

    await transform(transformInput, transformOutput(messages))

    expect(dedupChatCompletionsMock).toHaveBeenCalled()
  })
})

describe("stats tracking", () => {
  it("contextpilot_status returns correct cumulative stats after optimization", async () => {
    dedupChatCompletionsMock.mockReturnValue(completeDedupResult(0))

    const hooks = await ContextPilotPlugin()
    const transform = hooks["experimental.chat.messages.transform"]!
    const statusTool = hooks.tool!.contextpilot_status

    // Run a transform with a duplicate to accumulate stats
    const msg1 = makeToolMessage("m1", [{ partId: "p1", callID: "c1", tool: "read_file", output: LONG_OUTPUT }])
    const msg2 = makeToolMessage("m2", [{ partId: "p2", callID: "c2", tool: "read_file", output: LONG_OUTPUT }])
    const messages = [msg1, msg2]

    await transform(transformInput, transformOutput(messages))

    const result = await statusTool.execute({}, toolContext)
    expect(result).toContain("Turns optimized: 1")
    expect(result).toContain("Docs deduped: 1")
    expect(result).toContain("Tracked hashes: 1")
    expect(result).toContain("Reorder: dedup-only")
  })
})

describe("transform hook error handling", () => {
  it("bad input does not crash the transform", async () => {
    const hooks = await ContextPilotPlugin()
    const transform = hooks["experimental.chat.messages.transform"]!

    // null messages
    await expect(transform(transformInput, { messages: null })).resolves.toBeUndefined()

    // messages with missing parts
    await expect(transform(transformInput, { messages: [{ info: { id: "x", role: "user", sessionID: "s" } }] })).resolves.toBeUndefined()

    // completely invalid input
    await expect(transform(transformInput, {})).resolves.toBeUndefined()
  })
})
