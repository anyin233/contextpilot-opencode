import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { dedupChatCompletions } from "./engine/dedup.js"
import { recordAndPersistSavings } from "./stats.js"
import { createHash } from "node:crypto"
import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const LOG_DIR = join(process.env.XDG_DATA_HOME || join(process.env.HOME || "/tmp", ".local/share"), "opencode/log")
const LOG_FILE = join(LOG_DIR, "contextpilot.log")
function log(msg: string) {
  try {
    mkdirSync(LOG_DIR, { recursive: true })
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`)
  } catch (error) {
    console.warn(`[ContextPilot] Failed to write OpenCode plugin log at ${LOG_FILE}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ── Types mirroring OpenCode's message format ────────────────────────────

interface OpenCodeMessage {
  info: { id: string; role: string; sessionID: string; [k: string]: unknown }
  parts: OpenCodePart[]
}

interface OpenAIMessage {
  role: string
  content: string
  tool_call_id?: string
}

interface OpenAIChatBody {
  messages: OpenAIMessage[]
}

type MessageTransformInput = Record<string, never>

type MessageTransformOutput = {
  messages?: unknown
}

type OpenCodePart = {
  id: string
  sessionID: string
  messageID: string
  type: string
  [k: string]: unknown
}

interface ToolPart extends OpenCodePart {
  type: "tool"
  callID: string
  tool: string
  state: {
    status: string
    input?: Record<string, unknown>
    output?: string
    title?: string
    metadata?: Record<string, unknown>
    time?: { start: number; end?: number }
    [k: string]: unknown
  }
}

interface TextPart extends OpenCodePart {
  type: "text"
  text: string
}

// ── Helpers ──────────────────────────────────────────────────────────────

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16)
}

function isToolPart(p: OpenCodePart): p is ToolPart {
  return p.type === "tool"
}

function isCompletedToolPart(p: OpenCodePart): p is ToolPart {
  return isToolPart(p) && p.state?.status === "completed"
}

function getToolOutput(p: ToolPart): string {
  return typeof p.state?.output === "string" ? p.state.output : ""
}

// ── Convert OpenCode messages to OpenAI format for the pipeline ─────────

function toOpenAIMessages(messages: OpenCodeMessage[]): OpenAIMessage[] {
  const result: OpenAIMessage[] = []

  for (const msg of messages) {
    const role = msg.info.role

    // Collect text parts
    const textParts = msg.parts.filter((p): p is TextPart => p.type === "text")
    const toolParts = msg.parts.filter(isCompletedToolPart)

    if (textParts.length > 0) {
      result.push({
        role: role === "user" ? "user" : role === "assistant" ? "assistant" : "system",
        content: textParts.map((p) => p.text).join("\n"),
      })
    }

    // Tool results become role=tool messages
    for (const tp of toolParts) {
      result.push({
        role: "tool",
        content: getToolOutput(tp),
        tool_call_id: tp.callID || tp.id,
      })
    }
  }

  return result
}

// Map optimized OpenAI content back to OpenCode parts
function applyOptimizedContent(
  messages: OpenCodeMessage[],
  optimizedOpenAI: { role: string; content: string; tool_call_id?: string }[],
): void {
  // Build a lookup: tool_call_id → optimized content
  const optimizedToolContent = new Map<string, string>()
  for (const msg of optimizedOpenAI) {
    if (msg.role === "tool" && msg.tool_call_id) {
      optimizedToolContent.set(msg.tool_call_id, msg.content)
    }
  }

  // Apply back to OpenCode parts
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (isCompletedToolPart(part)) {
        const key = part.callID || part.id
        const optimized = optimizedToolContent.get(key)
        if (optimized !== undefined && optimized !== getToolOutput(part)) {
          part.state.output = optimized
        }
      }
    }
  }
}

// ── Session state ────────────────────────────────────────────────────────

class SessionState {
  private singleDocHashes = new Map<string, string>() // content_hash → part_id
  private optimizeCount = 0
  totalCharsSaved = 0
  totalDocsDeduped = 0

  private hasReorder = false

  async optimize(messages: OpenCodeMessage[]): Promise<void> {
    this.optimizeCount++

    let charsSaved = 0

    // ── Single-doc cross-turn dedup ──────────────────────────────────
    for (const msg of messages) {
      for (const part of msg.parts) {
        if (!isCompletedToolPart(part)) continue
        const output = getToolOutput(part)
        if (output.length < 100) continue

        const contentHash = hashText(output)
        const partId = part.callID || part.id

        if (this.singleDocHashes.has(contentHash)) {
          const prevId = this.singleDocHashes.get(contentHash)!
          if (partId !== prevId) {
            // Check the previous part still exists
            const prevExists = messages.some((m) =>
              m.parts.some((p) => {
                if (!isCompletedToolPart(p)) return false
                return (p.callID || p.id) === prevId
              }),
            )
            if (prevExists) {
              const replacement = `[Duplicate — identical to previous tool result (${prevId}). Refer to the earlier result above.]`
              const saved = output.length - replacement.length
              if (saved > 0) {
                part.state.output = replacement
                charsSaved += saved
                this.totalDocsDeduped++
              }
            }
          }
        } else {
          this.singleDocHashes.set(contentHash, partId)
        }
      }
    }

    // ── Block-level dedup via OpenAI conversion ─────────────────────
    const postDedup = toOpenAIMessages(messages)
    const systemContent = postDedup.find((m) => m.role === "system")?.content
    const body: OpenAIChatBody = { messages: postDedup }
    const dedupResult = dedupChatCompletions(body, systemContent)

    if (dedupResult.charsSaved > 0) {
      charsSaved += dedupResult.charsSaved
      applyOptimizedContent(messages, body.messages)
    }

    this.totalCharsSaved += charsSaved
    recordAndPersistSavings(messages[0]?.info.sessionID ?? "unknown", charsSaved)

    log(`[ContextPilot] Turn ${this.optimizeCount}: saved ${charsSaved} chars (~${Math.round(charsSaved / 4)} tokens) | docs deduped: ${this.totalDocsDeduped} | tracked: ${this.singleDocHashes.size} | cumulative: ${this.totalCharsSaved} chars (~${Math.round(this.totalCharsSaved / 4)} tokens)`)
  }

  getStats() {
    return {
      turns: this.optimizeCount,
      totalCharsSaved: this.totalCharsSaved,
      estimatedTokensSaved: Math.round(this.totalCharsSaved / 4),
      docsDeduped: this.totalDocsDeduped,
      trackedHashes: this.singleDocHashes.size,
      reorderAvailable: this.hasReorder,
    }
  }
}

// ── Plugin export ────────────────────────────────────────────────────────

export const ContextPilotPlugin = async () => {
  const state = new SessionState()
  log("[ContextPilot] Plugin loaded successfully")

  return {
    "experimental.chat.messages.transform": async (_input: MessageTransformInput, output: MessageTransformOutput) => {
      try {
        if (!isOpenCodeMessageArray(output.messages)) {
          log("[ContextPilot] Transform skipped — output.messages is not a valid OpenCode message array")
          return
        }
        const msgs = output.messages
        log(`[ContextPilot] Transform called — ${msgs.length} messages, ${msgs.reduce((n, m) => n + m.parts.length, 0)} parts`)
        await state.optimize(msgs)
      } catch (e) {
        log(`[ContextPilot] Transform error while optimizing OpenCode messages: ${e instanceof Error ? e.message : String(e)}`)
      }
    },
    tool: {
      contextpilot_status: tool({
        description: "Show ContextPilot cumulative token savings and dedup statistics",
        args: {},
        async execute() {
          const stats = state.getStats()
          return [
            "ContextPilot Status:",
            `  Turns optimized: ${stats.turns}`,
            `  Chars saved: ${stats.totalCharsSaved.toLocaleString()}`,
            `  Tokens saved: ~${stats.estimatedTokensSaved.toLocaleString()}`,
            `  Docs deduped: ${stats.docsDeduped}`,
            `  Tracked hashes: ${stats.trackedHashes}`,
            `  Reorder: ${stats.reorderAvailable ? "active" : "dedup-only"}`,
          ].join("\n")
        },
      }),
    },
  }
}

export default {
  id: "contextpilot",
  server: ContextPilotPlugin,
} satisfies { id: string; server: Plugin }

function isOpenCodeMessageArray(value: unknown): value is OpenCodeMessage[] {
  return Array.isArray(value) && value.every((message) => {
    if (!message || typeof message !== "object") {
      return false
    }
    const candidate = message as { info?: unknown; parts?: unknown }
    return !!candidate.info && typeof candidate.info === "object" && Array.isArray(candidate.parts)
  })
}
