import { describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRoot } from "solid-js"
import type { TuiPluginApi, TuiPluginMeta } from "@opencode-ai/plugin/tui"
import { createElement, insert, testRender, type JSX } from "@opentui/solid"

import plugin from "./tui.js"
import { createEmptySavingsSnapshot, recordSavings } from "./stats.js"

const meta = {
  id: "contextpilot",
  source: "file",
  spec: "./src/tui.tsx",
  target: "./src/tui.tsx",
  first_time: Date.now(),
  last_time: Date.now(),
  time_changed: Date.now(),
  load_count: 1,
  fingerprint: "test",
  state: "first",
} satisfies TuiPluginMeta

type SidebarContentSlot = (ctx: unknown, props: { session_id: string }) => JSX.Element

function createSlotApi(registered: unknown[]) {
  return {
    slots: {
      register(plugin: unknown) {
        registered.push(plugin)
        return "contextpilot"
      },
    },
  } as unknown as TuiPluginApi
}

function sidebarContentSlot(registered: unknown[]): SidebarContentSlot {
  const candidate = registered[0] as { slots?: { sidebar_content?: SidebarContentSlot } }
  const slot = candidate.slots?.sidebar_content
  expect(slot).toBeDefined()
  return slot!
}

function renderSlot(slot: SidebarContentSlot, sessionID: string) {
  const output = slot({}, { session_id: sessionID })
  if (typeof output === "object" && output !== null) {
    return output
  }
  const text = createElement("text")
  insert(text, () => output)
  return text
}

describe("ContextPilot TUI plugin", () => {
  it("exports a TUI plugin module with the contextpilot id", () => {
    expect(plugin.id).toBe("contextpilot")
    expect(typeof plugin.tui).toBe("function")
  })

  it("registers a sidebar content slot for savings above the path footer", async () => {
    const registered: unknown[] = []

    await plugin.tui(createSlotApi(registered), undefined, meta)

    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({
      order: 50,
      slots: {
        sidebar_content: expect.any(Function),
      },
    })
  })

  it("updates displayed savings when the stats file changes", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "contextpilot-tui-"))
    const statsPath = join(tempDir, "savings.json")
    const registered: unknown[] = []

    try {
      await plugin.tui(createSlotApi(registered), { statsPath, refreshMs: 10 }, meta)

      const slot = sidebarContentSlot(registered)
      let dispose: () => void = () => {}
      const setup = await createRoot((rootDispose) => {
        dispose = rootDispose
        return testRender(() => renderSlot(slot, "session-a"), { width: 80, height: 6 })
      })

      try {
        await setup.flush()
        expect(setup.captureCharFrame()).toContain("session saved ~0 tokens")

        const snapshot = recordSavings(createEmptySavingsSnapshot("2026-06-16T00:00:00.000Z"), "session-a", 400, 1600)
        writeFileSync(statsPath, `${JSON.stringify(snapshot, null, 2)}\n`)

        await setup.waitForFrame(
          (frame) =>
            frame.includes("session saved ~100 tokens") &&
            frame.includes("all-time saved ~100 tokens") &&
            frame.includes("saved ~25.0% of ~400 tokens"),
          { maxPasses: 30 },
        )
      } finally {
        dispose()
        setup.renderer.destroy()
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it("falls back to zero savings when the stats file is malformed", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "contextpilot-tui-"))
    const statsPath = join(tempDir, "savings.json")
    const registered: unknown[] = []

    try {
      writeFileSync(statsPath, "{not valid json")
      await plugin.tui(createSlotApi(registered), { statsPath, refreshMs: 10 }, meta)

      const slot = sidebarContentSlot(registered)
      let dispose: () => void = () => {}
      const setup = await createRoot((rootDispose) => {
        dispose = rootDispose
        return testRender(() => renderSlot(slot, "session-a"), { width: 80, height: 6 })
      })

      try {
        await setup.flush()
        const frame = setup.captureCharFrame()
        expect(frame).toContain("session saved ~0 tokens")
        expect(frame).toContain("all-time saved ~0 tokens")
        expect(frame).toContain("saved ~0.0% of ~0 tokens")
      } finally {
        dispose()
        setup.renderer.destroy()
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
