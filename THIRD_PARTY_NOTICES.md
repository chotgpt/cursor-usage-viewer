# Third-party notices

## Cockpit Tools derivative UI

- Upstream: <https://github.com/jlcodes99/cockpit-tools>
- Fixed source commit: `a0508ae815e104e931dae515389e680840008367`
- Upstream author/project attribution: jlcodes99 / Cockpit Tools
- Upstream license: CC BY-NC-SA 4.0
- This project license: CC BY-NC-SA 4.0

This project adapts the upstream Cursor account page, shared account controls, classic sidebar, theme tokens and relevant light/dark CSS. Modifications remove unrelated providers and unsupported actions, connect the UI to Cursor Usage Viewer's existing storage/provider/updater boundaries, preserve the unofficial identity, and add Grok/Sand as a fifth quota.

The exact imported source paths and per-file modifications are maintained in `docs/UPSTREAM_COCKPIT_UI.md`. Cockpit branding, logos and unrelated provider assets are not used. Patent and trademark rights are not granted by CC BY-NC-SA 4.0.

## Bundled fonts

- Inter, copyright 2016 The Inter Project Authors, distributed through `@fontsource/inter` under the SIL Open Font License 1.1.
- JetBrains Mono, copyright 2020 The JetBrains Mono Project Authors, distributed through `@fontsource/jetbrains-mono` under the SIL Open Font License 1.1.

The unmodified webfont files are bundled locally so the Cockpit typography does not depend on a network connection. Their copyright statements and full license text are preserved in the installed Fontsource packages and must remain included in packaged distribution notices.

Runtime dependencies retain their respective licenses; see lockfiles and generated package metadata.
