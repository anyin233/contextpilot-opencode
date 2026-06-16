import { describe, expect, it } from "bun:test"

import { createEmptySavingsSnapshot, estimateTokensSaved, recordSavings } from "./stats.js"

describe("ContextPilot savings stats", () => {
  it("tracks current-session and all-time token savings", () => {
    const snapshot = createEmptySavingsSnapshot()

    const next = recordSavings(snapshot, "session-a", 99)

    expect(next.sessions["session-a"]?.charsSaved).toBe(99)
    expect(next.sessions["session-a"]?.estimatedTokensSaved).toBe(25)
    expect(next.allTime.charsSaved).toBe(99)
    expect(next.allTime.estimatedTokensSaved).toBe(25)
  })

  it("rounds character savings to token estimates consistently", () => {
    expect(estimateTokensSaved(0)).toBe(0)
    expect(estimateTokensSaved(1)).toBe(0)
    expect(estimateTokensSaved(2)).toBe(1)
    expect(estimateTokensSaved(99)).toBe(25)
  })
})
