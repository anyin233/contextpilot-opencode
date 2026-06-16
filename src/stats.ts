import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const STATS_FILE = join(
  process.env.XDG_DATA_HOME || join(process.env.HOME || "/tmp", ".local/share"),
  "opencode/contextpilot/savings.json",
)

export type SavingsCounter = {
  charsSaved: number
  charsConsumed: number
  estimatedTokensSaved: number
  estimatedTokensConsumed: number
}

export type SavingsSession = SavingsCounter & {
  updatedAt: string
}

export type SavingsSnapshot = {
  installedAt: string
  updatedAt: string
  allTime: SavingsCounter
  sessions: Record<string, SavingsSession>
}

export function estimateTokensSaved(charsSaved: number) {
  return Math.round(charsSaved / 4)
}

export function savedRatio(counter: SavingsCounter): number {
  if (counter.charsConsumed <= 0) return 0
  return counter.charsSaved / counter.charsConsumed
}

export function createEmptySavingsSnapshot(now = new Date().toISOString()): SavingsSnapshot {
  return {
    installedAt: now,
    updatedAt: now,
    allTime: {
      charsSaved: 0,
      charsConsumed: 0,
      estimatedTokensSaved: 0,
      estimatedTokensConsumed: 0,
    },
    sessions: {},
  }
}

export function readSavingsSnapshot(path = STATS_FILE): SavingsSnapshot {
  if (!existsSync(path)) {
    return createEmptySavingsSnapshot()
  }

  try {
    return normalizeSavingsSnapshot(JSON.parse(readFileSync(path, "utf8")))
  } catch (error) {
    console.warn(`[ContextPilot] Failed to read savings stats at ${path}: ${error instanceof Error ? error.message : String(error)}`)
    return createEmptySavingsSnapshot()
  }
}

export function recordSavings(
  snapshot: SavingsSnapshot,
  sessionID: string,
  charsSaved: number,
  charsConsumed: number,
  now = new Date().toISOString(),
) {
  const current = snapshot.sessions[sessionID] ?? {
    charsSaved: 0,
    charsConsumed: 0,
    estimatedTokensSaved: 0,
    estimatedTokensConsumed: 0,
    updatedAt: now,
  }
  const nextChars = current.charsSaved + charsSaved
  const nextConsumed = current.charsConsumed + charsConsumed
  const allTimeChars = snapshot.allTime.charsSaved + charsSaved
  const allTimeConsumed = snapshot.allTime.charsConsumed + charsConsumed

  return {
    ...snapshot,
    updatedAt: now,
    allTime: {
      charsSaved: allTimeChars,
      charsConsumed: allTimeConsumed,
      estimatedTokensSaved: estimateTokensSaved(allTimeChars),
      estimatedTokensConsumed: estimateTokensSaved(allTimeConsumed),
    },
    sessions: {
      ...snapshot.sessions,
      [sessionID]: {
        charsSaved: nextChars,
        charsConsumed: nextConsumed,
        estimatedTokensSaved: estimateTokensSaved(nextChars),
        estimatedTokensConsumed: estimateTokensSaved(nextConsumed),
        updatedAt: now,
      },
    },
  }
}

export function recordAndPersistSavings(
  sessionID: string,
  charsSaved: number,
  charsConsumed: number,
  path = STATS_FILE,
) {
  if (charsSaved <= 0 && charsConsumed <= 0) {
    return readSavingsSnapshot(path)
  }

  const next = recordSavings(readSavingsSnapshot(path), sessionID, charsSaved, charsConsumed)
  try {
    mkdirSync(dirname(path), { recursive: true })
    const tempPath = `${path}.${process.pid}.tmp`
    writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`)
    renameSync(tempPath, path)
  } catch (error) {
    console.warn(`[ContextPilot] Failed to write savings stats at ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return next
}

export function sessionSavings(snapshot: SavingsSnapshot, sessionID: string): SavingsCounter {
  return snapshot.sessions[sessionID] ?? {
    charsSaved: 0,
    charsConsumed: 0,
    estimatedTokensSaved: 0,
    estimatedTokensConsumed: 0,
  }
}

function normalizeSavingsSnapshot(value: unknown): SavingsSnapshot {
  if (!value || typeof value !== "object") {
    return createEmptySavingsSnapshot()
  }

  const record = value as Partial<SavingsSnapshot>
  const fallback = createEmptySavingsSnapshot()
  const sessions = record.sessions && typeof record.sessions === "object" ? record.sessions : {}
  const allTimeChars = typeof record.allTime?.charsSaved === "number" ? record.allTime.charsSaved : 0
  const allTimeConsumed = typeof record.allTime?.charsConsumed === "number" ? record.allTime.charsConsumed : 0

  return {
    installedAt: typeof record.installedAt === "string" ? record.installedAt : fallback.installedAt,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : fallback.updatedAt,
    allTime: {
      charsSaved: allTimeChars,
      charsConsumed: allTimeConsumed,
      estimatedTokensSaved: estimateTokensSaved(allTimeChars),
      estimatedTokensConsumed: estimateTokensSaved(allTimeConsumed),
    },
    sessions: Object.fromEntries(
      Object.entries(sessions).flatMap(([sessionID, session]) => {
        if (!session || typeof session !== "object") return []
        const item = session as Partial<SavingsSession>
        const charsSaved = typeof item.charsSaved === "number" ? item.charsSaved : 0
        const charsConsumed = typeof item.charsConsumed === "number" ? item.charsConsumed : 0
        return [[sessionID, {
          charsSaved,
          charsConsumed,
          estimatedTokensSaved: estimateTokensSaved(charsSaved),
          estimatedTokensConsumed: estimateTokensSaved(charsConsumed),
          updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : fallback.updatedAt,
        }]]
      }),
    ),
  }
}
