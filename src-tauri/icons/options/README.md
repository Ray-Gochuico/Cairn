# Cairn icon mockups (2026-05-27)

Five hand-coded SVG icon options to replace the placeholder `icon.png`
the app currently ships with. Each follows the **stacked-stones cairn**
metaphor (matches the brand name Cairn and the app's "roadmap to FI"
narrative) and deliberately avoids the green-gradient-bars-with-$
trope that every other personal finance app uses.

All SVGs are 1024 x 1024 viewBox. 256 x 256 PNG previews live alongside
each one (rendered via `qlmanage`) so you can flip between them
without re-rendering.

| File | Concept | Best for | Weak spot |
|---|---|---|---|
| `cairn-1.svg` | **Classic Cairn** — five organic stones, warm earth palette (ochre + slate + taupe) | Standard app icon at 128px+; reads as a literal trail marker | Six colors compete a little at favicon sizes |
| `cairn-2.svg` | **Geometric Cairn** — five flat polygon stones, single off-white silhouette on deep forest plate | macOS dock + Windows taskbar; high contrast holds together at 16px | A bit corporate; less "outdoorsy" than the brief implies |
| `cairn-3.svg` | **Trail Marker** — cairn perched on a horizon with an S-curve path leading to it | Splash screen / About dialog; tells a story | Fine details collapse below 48px |
| `cairn-4.svg` | **Compass-stone** — uniform green-grey stack with a compass-rose etched on the second-from-top stone, deep forest plate | App icon for users who lean into the navigation metaphor | Compass etch only legible at 128px+ |
| `cairn-5.svg` | **Minimal mark** — three rounded-rect stones in off-white on a brand-warm orange plate | Favicon, monogram, letterhead, anywhere the icon needs to read at 16x16 | Only three stones, so less "cairn-like" without context |

## Rendering the previews

```sh
cd src-tauri/icons/options
for f in cairn-*.svg; do
  qlmanage -t -s 256 -o . "$f"
  mv "$f.png" "${f%.svg}.preview.png"
done
```

`sips -Z 256 -s format png cairn-1.svg --out cairn-1.preview.png` is
the cross-platform fallback if `qlmanage` isn't available.

## Once a winner is picked

Run the full ICNS / ICO / multi-size PNG pipeline (e.g.
`@tauri-apps/cli`'s `tauri icon` command) against the chosen SVG to
regenerate the artifacts under `src-tauri/icons/` proper:

```sh
npx tauri icon src-tauri/icons/options/cairn-N.svg
```

That step is **not** part of this commit — the rebrand teammate owns
the tauri.conf.json / final-asset render to avoid stepping on the
naming sweep's territory.
