import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const STATS_FILE = join(
  process.env.XDG_DATA_HOME || join(process.env.HOME || "/tmp", ".local/share"),
  "opencode/contextpilot/savings.json",
)

export type SavingsCounter = {
  charsSaved: number
  estimatedTokensSaved: number
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

export function createEmptySavingsSnapshot(now = new Date().toISOString()): SavingsSnapshot {
  return {
    installedAt: now,
    updatedAt: now,
    allTime: {
      charsSaved: 0,
      estimatedTokensSaved: 0,
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

export function recordSavings(snapshot: SavingsSnapshot, sessionID: string, charsSaved: number, now = new Date().toISOString()) {
  const current = snapshot.sessions[sessionID] ?? {
    charsSaved: 0,
    estimatedTokensSaved: 0,
    updatedAt: now,
  }
  const nextChars = current.charsSaved + charsSaved
  const allTimeChars = snapshot.allTime.charsSaved + charsSaved

  return {
    ...snapshot,
    updatedAt: now,
    allTime: {
      charsSaved: allTimeChars,
      estimatedTokensSaved: estimateTokensSaved(allTimeChars),
    },
    sessions: {
      ...snapshot.sessions,
      [sessionID]: {
        charsSaved: nextChars,
        estimatedTokensSaved: estimateTokensSaved(nextChars),
        updatedAt: now,
      },
    },
  }
}

export function recordAndPersistSavings(sessionID: string, charsSaved: number, path = STATS_FILE) {
  if (charsSaved <= 0) {
    return readSavingsSnapshot(path)
  }

  const next = recordSavings(readSavingsSnapshot(path), sessionID, charsSaved)
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
  return snapshot.sessions[sessionID] ?? { charsSaved: 0, estimatedTokensSaved: 0 }
}

function normalizeSavingsSnapshot(value: unknown): SavingsSnapshot {
  if (!value || typeof value !== "object") {
    return createEmptySavingsSnapshot()
  }

  const record = value as Partial<SavingsSnapshot>
  const fallback = createEmptySavingsSnapshot()
  const sessions = record.sessions && typeof record.sessions === "object" ? record.sessions : {}
  const allTimeChars = typeof record.allTime?.charsSaved === "number" ? record.allTime.charsSaved : 0

  return {
    installedAt: typeof record.installedAt === "string" ? record.installedAt : fallback.installedAt,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : fallback.updatedAt,
    allTime: {
      charsSaved: allTimeChars,
      estimatedTokensSaved: estimateTokensSaved(allTimeChars),
    },
    sessions: Object.fromEntries(
      Object.entries(sessions).flatMap(([sessionID, session]) => {
        if (!session || typeof session !== "object") return []
        const item = session as Partial<SavingsSession>
        const charsSaved = typeof item.charsSaved === "number" ? item.charsSaved : 0
        return [[sessionID, {
          charsSaved,
          estimatedTokensSaved: estimateTokensSaved(charsSaved),
          updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : fallback.updatedAt,
        }]]
      }),
    ),
  }
}
