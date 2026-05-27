# Distribution & Signing — Cairn (formerly Finance App)

## Decision

This app is distributed **unsigned** via GitHub Releases. No Apple Developer
Program enrollment ($99/yr) is required. The trade-off: macOS Gatekeeper
will show an "unidentified developer" warning the first time a friend opens
the app. Documented workaround in README.

## Build (macOS)

```bash
. "$HOME/.cargo/env"
npm run tauri build
```

Produces under `src-tauri/target/release/bundle/`:

- `dmg/Cairn_0.1.0_aarch64.dmg` (Apple Silicon)
- `macos/Cairn.app` (raw bundle, inside the .dmg)

## How a friend installs (document this in README too)

1. Download `Cairn_0.1.0_aarch64.dmg` from the GitHub Releases page.
2. Double-click the `.dmg` to mount it.
3. Drag `Cairn.app` into the `Applications` folder.
4. First-launch only: **right-click `Cairn.app` → Open → "Open" again** in the
   Gatekeeper dialog. macOS remembers the approval; subsequent launches are
   double-click.
5. Alternative: `xattr -d com.apple.quarantine /Applications/Cairn.app`
   from Terminal removes the quarantine flag entirely (no right-click needed).

## Cross-target builds

- macOS Intel: `npm run tauri build -- --target x86_64-apple-darwin`
- Windows: `npm run tauri build -- --target x86_64-pc-windows-msvc` (requires
  building on Windows; cross-compile not in scope for v1)

## Future: code signing

If/when distribution scales beyond friends, the path is:

1. Enroll in Apple Developer Program ($99/yr)
2. Issue a Developer ID Application certificate via Xcode or developer.apple.com
3. Add `signingIdentity: "Developer ID Application: <Name> (<TEAMID>)"`
   to `bundle.macOS` in `tauri.conf.json`
4. Notarize via `notarytool` (separate step; outside the build)
