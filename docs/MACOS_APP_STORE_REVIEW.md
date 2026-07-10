# macOS App Store review checklist

HomeLedger can be distributed in two different macOS channels. They need different Apple credentials and acceptance checks:

| Channel         | Artifact                                         | Certificate              | Sandbox  | Notarization            |
| --------------- | ------------------------------------------------ | ------------------------ | -------- | ----------------------- |
| Direct download | `.app` or DMG                                    | Developer ID Application | Optional | Required                |
| Mac App Store   | Signed `.app` uploaded through App Store Connect | Apple Distribution       | Required | Not required separately |

The existing GitHub workflow validates the universal app, a DMG, the bundle identifier, and local SQLite initialization. It supports the direct-download signing/notarization route. It is not itself proof that the app is ready for Mac App Store submission.

## What is already configured

- Bundle identifier: `com.homeledger.app` in `src-tauri/tauri.conf.json`.
- App category: `Utility` in `src-tauri/tauri.conf.json`.
- macOS 14 CI build and isolated local-database startup smoke: `.github/workflows/macos-release.yml`.
- The smoke test starts the `.app` with a temporary `HOME` and checks that `home-ledger.sqlite3` is created under the app data directory.

## Account-holder preparation

An Apple Developer Program account holder must complete these items before a colleague can produce an App Store artifact:

1. Register `com.homeledger.app` as an App ID in Certificates, Identifiers & Profiles.
2. Create the app record in App Store Connect using the exact same bundle identifier.
3. Create a **Mac App Store Connect** provisioning profile for that App ID and an **Apple Distribution** certificate.
4. Give the Mac build operator the Team ID, the profile, and signing access through your approved secret-management process. Do not commit the profile, certificate, passwords, API keys, or Team ID-bearing entitlements to this repository.
5. Decide the release minimum macOS version after testing the target systems; keep universal architecture unless product requirements intentionally limit the app to Apple silicon.

## App Sandbox review

Mac App Store submission requires App Sandbox. Before enabling it for release, the Mac reviewer must create an App Store-only Tauri config and entitlements file using the actual Team ID and App ID. The entitlement set must include:

- `com.apple.security.app-sandbox = true`
- `com.apple.application-identifier = <TEAM_ID>.com.homeledger.app`
- `com.apple.developer.team-identifier = <TEAM_ID>`
- User-selected read/write file access, because HomeLedger uses explicit file dialogs for CSV import, receipts, exports, backups, and restores.

Use the smallest entitlement set that still passes the flows below. Do not enable outbound network access merely for optional local AI; HomeLedger's supported local AI endpoints are loopback-only and all core accounting functions work without AI.

## Mac reviewer commands

Run these from a clean clone on a Mac with Xcode command-line tools, Rust stable, Node.js 24+, and pnpm 11+:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm tauri build --target universal-apple-darwin --bundles app,dmg
bash scripts/macos_offline_smoke.sh
```

The final App Store build must use the separate, uncommitted App Store configuration created from the account-holder values. Follow the official Tauri App Store guide for the build-and-bundle sequence, then validate the signed app with:

```bash
codesign -dvvv --entitlements - /path/to/HomeLedger.app
```

Confirm that `com.apple.security.app-sandbox` is `true`, the Team ID and App ID are exact, and no debug entitlement is present.

## Required manual acceptance flows

Run these on the signed sandboxed app, not only on the unsigned CI app:

1. Launch with networking disabled; create income, expense, and transfer records, then reopen the app and confirm all local data remains.
2. Use the system file picker to import CSV, add an attachment, export a report, create a backup, and restore that backup. Verify that each user-selected location works under the sandbox.
3. Confirm planned rent remains outside actual spending until the user changes it to completed.
4. Verify calendar event/transaction links, monthly and annual totals, and tax-candidate hints without enabling local AI.
5. Run the backup-restore restart boundary and confirm SQLite data survives app relaunch.
6. Inspect the privacy text, App Store metadata, screenshots, age rating, support URL, and tax disclaimer in App Store Connect.
7. Archive/upload using App Store Connect, then resolve every validation warning before TestFlight or review submission.

## References

- [Tauri: App Store distribution](https://v2.tauri.app/distribute/app-store/)
- [Tauri: macOS application bundle and entitlements](https://v2.tauri.app/distribute/macos-application-bundle/)
- [Apple: Configuring the macOS App Sandbox](https://developer.apple.com/documentation/xcode/configuring-the-macos-app-sandbox)
- [Apple: Notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
