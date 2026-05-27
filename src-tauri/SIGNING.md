# macOS code-signing — enrollment, cert, sign, build

`tauri.conf.json` ships a `bundle.macOS` scaffold with
`signingIdentity: null` + `hardenedRuntime: true`. Filling in the
identity is the only edit needed once the steps below are done.

## 1. Enroll in the Apple Developer Program

- <https://developer.apple.com/programs/enroll/> — sign in with the
  Apple ID that should own the cert. $99/yr, ~24–48h review.

## 2. Create a Developer ID Application certificate

- **Xcode → Settings → Accounts → your team → Manage Certificates → +
  → Developer ID Application**. Xcode stores the private key in your
  login Keychain.
- Verify and copy the identity string:

  ```bash
  security find-identity -v -p codesigning
  ```

  Format: `Developer ID Application: Your Name (TEAMID)`.

## 3. Wire it into Tauri (one-line edit)

In `tauri.conf.json`, replace `bundle.macOS.signingIdentity`'s `null`
with that exact string. That is the only required edit.

## 4. Build the signed `.dmg`

```bash
. "$HOME/.cargo/env"
npm run tauri build
```

Output: `src-tauri/target/release/bundle/dmg/`. Verify with
`codesign --verify --deep --strict --verbose=2 "<built .app>"`.

## TODO — Notarization (deferred)

Signing alone produces a `.dmg` that opens cleanly on the developer's
own Mac. To avoid the "unidentified developer" warning on *other* Macs,
the bundle must additionally be notarized. Set `APPLE_ID`,
`APPLE_PASSWORD` (app-specific), and `APPLE_TEAM_ID` env vars and
`tauri build` runs notarytool automatically. Out of scope for this
scaffold.
