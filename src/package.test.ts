import { describe, expect, it } from "bun:test"

type PackageJson = {
  description?: string
  keywords?: string[]
  exports?: unknown
  files?: string[]
  scripts?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
  devDependencies?: Record<string, string>
}

type TsConfigJson = {
  include?: string[]
  exclude?: string[]
}

describe("opencode plugin package metadata", () => {
  it("exposes runnable verification scripts and a plugin entrypoint", async () => {
    const packageJson: PackageJson = await Bun.file(new URL("../package.json", import.meta.url)).json()

    expect(packageJson.scripts?.test).toBe("bun test ./src")
    expect(packageJson.scripts?.typecheck).toBe("tsc --noEmit")
    expect(packageJson.scripts?.build).toBe("bun run clean && tsc")
    expect(packageJson.scripts?.clean).toBe("bun -e \"import { rmSync } from 'node:fs'; rmSync('dist', { recursive: true, force: true })\"")
    expect(packageJson.exports).toEqual({ ".": "./src/index.ts", "./tui": "./src/tui.tsx" })
    expect(packageJson.files).toEqual(["src/index.ts", "src/tui.tsx", "src/stats.ts", "src/engine/"])
  })

  it("describes the shipped dedup-only behavior without reordering claims", async () => {
    const packageJson: PackageJson = await Bun.file(new URL("../package.json", import.meta.url)).json()

    expect(packageJson.description).toContain("lossless deduplication")
    expect(packageJson.description).not.toContain("reordering")
  })

  it("uses non-overclaiming package keywords for dedup-only behavior", async () => {
    const packageJson: PackageJson = await Bun.file(new URL("../package.json", import.meta.url)).json()

    expect(packageJson.keywords).not.toContain("kv-cache")
    expect(packageJson.keywords).not.toContain("prompt-cache")
    expect(packageJson.keywords).toContain("context-optimization")
    expect(packageJson.keywords).toContain("token-savings")
  })

  it("documents the published npm OpenCode install flow", async () => {
    const readme = await Bun.file(new URL("../README.md", import.meta.url)).text()

    expect(readme).not.toContain("opencode plugin anyin233/contextpilot-opencode --global")
    expect(readme).not.toContain("git clone https://github.com/anyin233/contextpilot-opencode.git")
    expect(readme).toContain("contextpilot-opencode@latest")
    expect(readme).toContain("contextpilot-opencode@tui")
    expect(readme).toContain("OpenCode `opencode.json` plugin list")
    expect(readme).toContain("OpenCode `tui.json` plugin list")
    expect(readme).toContain("https://opencode.ai/config.json")
    expect(readme).toContain("https://opencode.ai/tui.json")
    expect(readme).toContain("Use `contextpilot-opencode@latest` for the main server plugin")
    expect(readme).toContain("oh-my-openagent@latest")
    expect(readme).toContain("https://github.com/EfficientContext/ContextPilot")
  })

  it("documents the canonical local development test command", async () => {
    const readme = await Bun.file(new URL("../README.md", import.meta.url)).text()

    expect(readme).toContain("bun test ./src")
    expect(readme).not.toContain("bun test src/**/*.test.ts")
  })

  it("keeps runtime imports inside the opencode plugin package", async () => {
    const source = await Bun.file(new URL("index.ts", import.meta.url)).text()

    expect(source).not.toContain("../openclaw-plugin")
    expect(source).toContain("./engine/dedup.js")
  })

  it("declares OpenTUI runtime dependencies needed by the TUI plugin", async () => {
    const packageJson: PackageJson = await Bun.file(new URL("../package.json", import.meta.url)).json()

    expect(packageJson.peerDependencies?.["@opentui/core"]).toBe("*")
    expect(packageJson.peerDependencies?.["@opentui/solid"]).toBe("*")
    expect(packageJson.peerDependencies?.["solid-js"]).toBe("*")
    expect(packageJson.peerDependenciesMeta?.["@opentui/core"]?.optional).toBe(true)
    expect(packageJson.peerDependenciesMeta?.["solid-js"]?.optional).toBe(true)
    expect(packageJson.devDependencies?.["@opentui/core"]).toBe("^0.3.4")
    expect(packageJson.devDependencies?.["solid-js"]).toBe("1.9.12")
  })

  it("keeps build output free of test artifacts", async () => {
    const tsconfig: TsConfigJson = await Bun.file(new URL("../tsconfig.json", import.meta.url)).json()

    expect(tsconfig.include).toEqual(["src/**/*.ts", "src/**/*.tsx"])
    expect(tsconfig.exclude).toEqual(["node_modules", "dist", "src/**/*.test.ts", "src/**/*.test.tsx"])
  })
})
