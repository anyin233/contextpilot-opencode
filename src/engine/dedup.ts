import { createHash } from "node:crypto"

const MIN_BLOCK_CHARS = 80
const MIN_CONTENT_CHARS = 500
const CHUNK_MODULUS = 13
const CHUNK_MIN_LINES = 5
const CHUNK_MAX_LINES = 40

type SeenBlock = [number, string, number]

type TextContentBlock = {
  type?: string
  text?: string
}

type OpenAIToolCall = {
  id?: string
  function?: {
    name?: string
  }
}

type OpenAIChatMessage = {
  role?: string
  content?: unknown
  tool_call_id?: string
  name?: string
  tool_calls?: OpenAIToolCall[]
}

type ChatCompletionsBody = {
  messages?: OpenAIChatMessage[]
}

type DedupOptions = {
  minBlockChars?: number
  minContentChars?: number
  chunkModulus?: number
}

type DedupResult = {
  blocksDeduped: number
  blocksTotal: number
  systemBlocksMatched: number
  charsBefore: number
  charsAfter: number
  charsSaved: number
}

function emptyDedupResult(): DedupResult {
  return {
    blocksDeduped: 0,
    blocksTotal: 0,
    systemBlocksMatched: 0,
    charsBefore: 0,
    charsAfter: 0,
    charsSaved: 0,
  }
}

function hashString(str: string): number {
  let hash = 5381
  for (let index = 0; index < str.length; index++) {
    hash = (Math.imul(hash, 33) + str.charCodeAt(index)) | 0
  }
  return hash >>> 0
}

function hashBlock(block: string): string {
  return createHash("sha256").update(block.trim(), "utf8").digest("hex").slice(0, 20)
}

function contentDefinedChunking(text: string, chunkModulus: number): string[] {
  const lines = text.split("\n")
  if (lines.length <= CHUNK_MIN_LINES) {
    return [text]
  }

  const blocks: string[] = []
  let current: string[] = []

  for (const line of lines) {
    current.push(line)
    const isBoundary = (hashString(line.trim()) % chunkModulus === 0 && current.length >= CHUNK_MIN_LINES)
      || current.length >= CHUNK_MAX_LINES

    if (!isBoundary) continue
    blocks.push(current.join("\n"))
    current = []
  }

  if (current.length === 0) {
    return blocks
  }
  if (blocks.length > 0 && current.length < CHUNK_MIN_LINES) {
    blocks[blocks.length - 1] += `\n${current.join("\n")}`
    return blocks
  }
  blocks.push(current.join("\n"))
  return blocks
}

function buildToolNameMap(messages: OpenAIChatMessage[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  for (const message of messages) {
    if (message.role !== "assistant") continue
    for (const toolCall of message.tool_calls ?? []) {
      if (!toolCall.id || !toolCall.function?.name) continue
      mapping[toolCall.id] = toolCall.function.name
    }
  }
  return mapping
}

function normalizeDedupArgs(
  systemContentOrOpts?: string | DedupOptions,
  maybeOpts?: DedupOptions,
): { systemContent: string | undefined; opts: DedupOptions } {
  if (typeof systemContentOrOpts === "string") {
    return { systemContent: systemContentOrOpts, opts: maybeOpts ?? {} }
  }
  return { systemContent: undefined, opts: systemContentOrOpts ?? {} }
}

function prescanSystemBlocks(systemContent: string | undefined, minBlockChars: number, chunkModulus: number) {
  const preSeen = new Map<string, SeenBlock>()
  if (!systemContent?.trim()) {
    return preSeen
  }

  contentDefinedChunking(systemContent, chunkModulus).forEach((block, blockIndex) => {
    if (block.trim().length < minBlockChars) return
    const hash = hashBlock(block)
    if (!preSeen.has(hash)) {
      preSeen.set(hash, [-1, "system prompt", blockIndex])
    }
  })
  return preSeen
}

function extractTextContent(content: unknown): string | undefined {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return undefined
  const textParts = content.flatMap((block) => {
    if (!block || typeof block !== "object") return []
    const textBlock = block as TextContentBlock
    if (textBlock.type === "text" && typeof textBlock.text === "string") return [textBlock.text]
    return []
  })
  return textParts.join("\n")
}

function applyTextContent(message: OpenAIChatMessage, text: string): void {
  if (!Array.isArray(message.content)) {
    message.content = text
    return
  }
  const textBlock = message.content.find((block): block is TextContentBlock => {
    return !!block && typeof block === "object" && (block as TextContentBlock).type === "text"
  })
  if (textBlock) {
    textBlock.text = text
  }
}

function dedupText(
  text: string,
  seenBlocks: Map<string, SeenBlock>,
  msgIndex: number,
  toolName: string,
  result: DedupResult,
  minBlockChars: number,
  chunkModulus: number,
): string | undefined {
  const blocks = contentDefinedChunking(text, chunkModulus)
  const newBlocks = blocks.map((block, blockIndex) => {
    if (block.trim().length < minBlockChars) return block

    const hash = hashBlock(block)
    result.blocksTotal += 1
    const seen = seenBlocks.get(hash)
    if (!seen || seen[0] === msgIndex) {
      seenBlocks.set(hash, [msgIndex, toolName, blockIndex])
      return block
    }

    const firstLine = block.trim().split("\n")[0]?.slice(0, 80) ?? "matching content"
    const ref = `[..., "${firstLine}" — identical to earlier ${seen[1]} result, see above ...]`
    const charsSaved = block.length - ref.length
    if (charsSaved <= 0) return block

    if (seen[0] === -1) {
      result.systemBlocksMatched += 1
    }
    result.blocksDeduped += 1
    return ref
  })

  const deduped = newBlocks.join("\n\n")
  if (deduped === text) return undefined
  return deduped
}

export function dedupChatCompletions(body: ChatCompletionsBody, opts?: DedupOptions): DedupResult
export function dedupChatCompletions(
  body: ChatCompletionsBody,
  systemContent?: string,
  opts?: DedupOptions,
): DedupResult
export function dedupChatCompletions(
  body: ChatCompletionsBody,
  systemContentOrOpts?: string | DedupOptions,
  maybeOpts?: DedupOptions,
): DedupResult {
  const normalized = normalizeDedupArgs(systemContentOrOpts, maybeOpts)
  const minBlockChars = normalized.opts.minBlockChars ?? MIN_BLOCK_CHARS
  const minContentChars = normalized.opts.minContentChars ?? MIN_CONTENT_CHARS
  const chunkModulus = normalized.opts.chunkModulus ?? CHUNK_MODULUS
  const messages = body.messages

  if (!Array.isArray(messages) || messages.length === 0) {
    return emptyDedupResult()
  }

  const result = emptyDedupResult()
  const seenBlocks = prescanSystemBlocks(normalized.systemContent, minBlockChars, chunkModulus)
  const toolNames = buildToolNameMap(messages)

  messages.forEach((message, msgIndex) => {
    if (message.role !== "tool" && message.role !== "toolResult") return

    const content = extractTextContent(message.content)
    if (!content || content.length < minContentChars) return

    const dedupedContent = dedupText(
      content,
      seenBlocks,
      msgIndex,
      toolNames[message.tool_call_id ?? ""] ?? message.name ?? "tool",
      result,
      minBlockChars,
      chunkModulus,
    )
    if (dedupedContent === undefined) return

    applyTextContent(message, dedupedContent)
    result.charsBefore += content.length
    result.charsAfter += dedupedContent.length
    result.charsSaved += content.length - dedupedContent.length
  })

  return result
}
