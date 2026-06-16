import { describe, expect, it } from "bun:test"
import type { TuiPluginApi, TuiPluginMeta } from "@opencode-ai/plugin/tui"

import plugin from "./tui.js"

describe("ContextPilot TUI plugin", () => {
  it("exports a TUI plugin module with the contextpilot id", () => {
    expect(plugin.id).toBe("contextpilot")
    expect(typeof plugin.tui).toBe("function")
  })

  it("registers a sidebar content slot for savings above the path footer", async () => {
    const registered: unknown[] = []
    const api = {
      slots: {
        register(plugin: unknown) {
          registered.push(plugin)
          return "contextpilot"
        },
      },
    }

    await plugin.tui(api as unknown as TuiPluginApi, undefined, {
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
    } satisfies TuiPluginMeta)

    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({
      order: 50,
      slots: {
        sidebar_content: expect.any(Function),
      },
    })
  })
})
