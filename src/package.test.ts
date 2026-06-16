import { describe, expect, it } from "bun:test"

type PackageJson = {
  exports?: unknown
  files?: string[]
  scripts?: Record<string, string>
}

describe("opencode plugin package metadata", () => {
  it("exposes runnable verification scripts and a plugin entrypoint", async () => {
    const packageJson: PackageJson = await Bun.file(new URL("../package.json", import.meta.url)).json()

    expect(packageJson.scripts?.test).toBe("bun test src/**/*.test.ts")
    expect(packageJson.scripts?.typecheck).toBe("tsc --noEmit")
    expect(packageJson.scripts?.build).toBe("tsc")
    expect(packageJson.exports).toEqual({ ".": "./src/index.ts", "./tui": "./src/tui.tsx" })
    expect(packageJson.files).toEqual(["src/index.ts", "src/tui.tsx", "src/stats.ts", "src/engine/"])
  })

  it("keeps runtime imports inside the opencode plugin package", async () => {
    const source = await Bun.file(new URL("index.ts", import.meta.url)).text()

    expect(source).not.toContain("../openclaw-plugin")
    expect(source).toContain("./engine/dedup.js")
  })
})
