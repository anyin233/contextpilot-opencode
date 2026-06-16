import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import { TextRenderable } from "@opentui/core"
import { createElement, type JSX } from "@opentui/solid"
import { onCleanup } from "solid-js"

import { readSavingsSnapshot, savedRatio, sessionSavings } from "./stats.js"

const DEFAULT_REFRESH_MS = 1_000

function formatTokens(value: number) {
  return value.toLocaleString()
}

function formatRatioPct(ratio: number) {
  return `${(ratio * 100).toFixed(1)}%`
}

function renderSavingsFooter(sessionID: string, statsPath?: string) {
  const snapshot = readSavingsSnapshot(statsPath)
  const session = sessionSavings(snapshot, sessionID)
  const current = formatTokens(session.estimatedTokensSaved)
  const allTime = formatTokens(snapshot.allTime.estimatedTokensSaved)
  const allTimeConsumed = formatTokens(snapshot.allTime.estimatedTokensConsumed)
  const ratioPct = formatRatioPct(savedRatio(snapshot.allTime))

  return `ContextPilot\nsession saved ~${current} tokens\nall-time saved ~${allTime} tokens\nsaved ~${ratioPct} of ~${allTimeConsumed} tokens`
}

function optionString(options: Record<string, unknown> | undefined, key: string) {
  const value = options?.[key]
  return typeof value === "string" ? value : undefined
}

function optionRefreshMs(options: Record<string, unknown> | undefined) {
  const value = options?.refreshMs
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : DEFAULT_REFRESH_MS
}

function SavingsFooter(props: { sessionID: string; statsPath?: string; refreshMs: number }) {
  const element = createElement("text")
  if (!(element instanceof TextRenderable)) {
    throw new Error("ContextPilot expected OpenTUI text renderable")
  }

  let displayed = ""
  const refresh = () => {
    const next = renderSavingsFooter(props.sessionID, props.statsPath)
    if (next === displayed) return
    displayed = next
    element.content = next
    element.requestRender()
  }

  refresh()
  element.live = true
  const interval = setInterval(refresh, props.refreshMs)
  onCleanup(() => {
    clearInterval(interval)
    element.live = false
  })

  return element as JSX.Element
}

export const ContextPilotTuiPlugin: TuiPlugin = async (api, options) => {
  const statsPath = optionString(options, "statsPath")
  const refreshMs = optionRefreshMs(options)

  api.slots.register({
    order: 50,
    slots: {
      sidebar_content(_ctx, props) {
        return SavingsFooter({ sessionID: props.session_id, statsPath, refreshMs })
      },
    },
  })
}

export default {
  id: "contextpilot",
  tui: ContextPilotTuiPlugin,
}
