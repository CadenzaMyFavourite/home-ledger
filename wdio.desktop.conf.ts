import fs from "node:fs"
import path from "node:path"

const artifacts = path.resolve("artifacts/desktop-e2e")
const application = path.resolve("src-tauri/target/debug/home-ledger.exe")

fs.mkdirSync(path.join(artifacts, "screenshots"), { recursive: true })

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./tests/desktop/**/*.desktop.e2e.ts"],
  maxInstances: 1,
  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath: application,
        driverProvider: "embedded",
        embeddedPort: 4445,
        startTimeout: 60_000,
        commandTimeout: 60_000,
      },
    ],
  ],
  capabilities: [{ browserName: "tauri" }],
  logLevel: "info",
  outputDir: path.join(artifacts, "logs"),
  bail: 1,
  waitforTimeout: 15_000,
  connectionRetryTimeout: 90_000,
  connectionRetryCount: 2,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { ui: "bdd", timeout: 120_000 },
  afterTest: async function (test, _context, result) {
    if (result.passed) return
    const safeName = test.title.replaceAll(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80)
    await browser.saveScreenshot(path.join(artifacts, "screenshots", `failed-${safeName}.png`))
  },
}
