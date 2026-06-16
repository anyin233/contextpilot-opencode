import type { TuiPlugin } from "@opencode-ai/plugin/tui"

import { readSavingsSnapshot, sessionSavings } from "./stats.js"

function formatTokens(value: number) {
  return value.toLocaleString()
}

function SavingsFooter(props: { sessionID: string }) {
  const snapshot = () => readSavingsSnapshot()
  const session = () => sessionSavings(snapshot(), props.sessionID)
  const current = () => formatTokens(session().estimatedTokensSaved)
  const allTime = () => formatTokens(snapshot().allTime.estimatedTokensSaved)

  return `ContextPilot\nsession saved ~${current()} tokens\nall-time saved ~${allTime()} tokens`
}

export const ContextPilotTuiPlugin: TuiPlugin = async (api) => {
  api.slots.register({
    order: 50,
    slots: {
      sidebar_content(_ctx, props) {
        return SavingsFooter({ sessionID: props.session_id })
      },
    },
  })
}

export default {
  id: "contextpilot",
  tui: ContextPilotTuiPlugin,
}
