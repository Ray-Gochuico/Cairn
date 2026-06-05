# Distribution & Signing — Cairn (formerly Finance App)

## Decision

This app is distributed **unsigned** via GitHub Releases. No Apple Developer
Program enrollment ($99/yr) is required. The trade-off: macOS Gatekeeper
will show an "unidentified developer" warning the first time a friend opens
the app. Documented workaround in README.

## Build & release procedure

The detailed release runbook is kept in the maintainer's local working tree
(not in this public repo). This file covers only the *signing posture* (the
unsigned decision above and the future code-signing path below).

In short: `npm run tauri build -- --target universal-apple-darwin` emits a
universal `src-tauri/target/universal-apple-darwin/release/bundle/macos/
Cairn.app` (no `.dmg` — `bundle.targets` is `["app"]` because
`bundle_dmg.sh` fails on macOS 26). The release artifact is a
minisign-signed **`Cairn_<version>_universal.app.tar.gz`** (gzip+tar — the
format the Tauri macOS updater requires; the README explains the why). It
runs natively on both Apple Silicon and Intel Macs.

## How a friend installs (mirrored in README)

1. Download `Cairn_<version>_universal.app.tar.gz` from the GitHub
   Releases page (one universal build for Apple Silicon + Intel).
2. Double-click it. macOS Archive Utility unarchives it to `Cairn.app`
   in the same folder.
3. Drag `Cairn.app` into the `Applications` folder.
4. First-launch only: **right-click `Cairn.app` → Open → "Open" again** in the
   Gatekeeper dialog. This is the recommended way in — it clears Gatekeeper
   while keeping macOS's quarantine/tamper check intact and records the user's
   consent. macOS remembers the approval; subsequent launches are double-click.

> **Advanced — only if you trust the source.** `xattr -d com.apple.quarantine
> /Applications/Cairn.app` clears Gatekeeper from Terminal, but it strips the
> quarantine flag outright, which **removes macOS's tamper check** on this
> unsigned download. Don't recommend it as the default path; the right-click →
> Open flow above is safer and just as permanent.

## Cross-target builds

- macOS (universal, both arches): `npm run tauri build -- --target universal-apple-darwin`
  (the CI default — one bundle that runs on Apple Silicon + Intel)
- Windows: built **on `windows-latest` in CI** via
  `npm run tauri build -- --bundles nsis`. Ships as an unsigned
  `*_x64-setup.exe` — SmartScreen shows "Windows protected your PC"; the
  user clicks "More info → Run anyway" (same one-time posture as the macOS
  Gatekeeper warning). No in-app updater on Windows yet — users re-download
  the latest `…_x64-setup.exe` from the Releases page to update.
  Cross-compiling Windows from macOS is not in scope.

## Future: code signing

If/when distribution scales beyond friends, the path is:

1. Enroll in Apple Developer Program ($99/yr).
2. Issue a Developer ID Application certificate via Xcode or developer.apple.com.
3. Add `signingIdentity: "Developer ID Application: <Name> (<TEAMID>)"`
   to `bundle.macOS` in `tauri.conf.json`.
4. Notarize the build via `notarytool` (a separate submit-and-wait step,
   outside the Tauri build).
5. Staple the notarization ticket to the `.app` with `xcrun stapler staple`
   so Gatekeeper validates offline.

This is a multi-step process, not a one-line flag — the README points
here precisely so that nuance isn't lost.
