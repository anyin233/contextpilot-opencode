import { describe, expect, it } from "bun:test"

import { createEmptySavingsSnapshot, estimateTokensSaved, recordSavings, savedRatio } from "./stats.js"

describe("ContextPilot savings stats", () => {
  it("tracks current-session and all-time token savings", () => {
    const snapshot = createEmptySavingsSnapshot()

    const next = recordSavings(snapshot, "session-a", 99, 400)

    expect(next.sessions["session-a"]?.charsSaved).toBe(99)
    expect(next.sessions["session-a"]?.charsConsumed).toBe(400)
    expect(next.sessions["session-a"]?.estimatedTokensSaved).toBe(25)
    expect(next.sessions["session-a"]?.estimatedTokensConsumed).toBe(100)
    expect(next.allTime.charsSaved).toBe(99)
    expect(next.allTime.charsConsumed).toBe(400)
    expect(next.allTime.estimatedTokensSaved).toBe(25)
    expect(next.allTime.estimatedTokensConsumed).toBe(100)
  })

  it("rounds character savings to token estimates consistently", () => {
    expect(estimateTokensSaved(0)).toBe(0)
    expect(estimateTokensSaved(1)).toBe(0)
    expect(estimateTokensSaved(2)).toBe(1)
    expect(estimateTokensSaved(99)).toBe(25)
  })

  it("computes saved ratio from consumed and saved chars", () => {
    expect(savedRatio({ charsSaved: 0, charsConsumed: 0, estimatedTokensSaved: 0, estimatedTokensConsumed: 0 })).toBe(0)
    expect(savedRatio({ charsSaved: 100, charsConsumed: 0, estimatedTokensSaved: 25, estimatedTokensConsumed: 0 })).toBe(0)
    expect(savedRatio({ charsSaved: 100, charsConsumed: 400, estimatedTokensSaved: 25, estimatedTokensConsumed: 100 })).toBe(0.25)
  })

  it("accumulates consumed chars across calls", () => {
    let snapshot = createEmptySavingsSnapshot()
    snapshot = recordSavings(snapshot, "session-a", 50, 200)
    snapshot = recordSavings(snapshot, "session-a", 50, 200)

    expect(snapshot.sessions["session-a"]?.charsSaved).toBe(100)
    expect(snapshot.sessions["session-a"]?.charsConsumed).toBe(400)
    expect(snapshot.allTime.charsSaved).toBe(100)
    expect(snapshot.allTime.charsConsumed).toBe(400)
  })
})
