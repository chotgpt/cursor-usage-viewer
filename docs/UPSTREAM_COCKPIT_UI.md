# Cockpit Tools UI provenance and modification record

Upstream repository: <https://github.com/jlcodes99/cockpit-tools>

Fixed commit: `a0508ae815e104e931dae515389e680840008367`

License: CC BY-NC-SA 4.0. The adapted UI in this repository is non-commercial, attributed, and shared under the same license. This file is updated whenever an upstream-derived file is added, removed or materially modified.

## Product adaptation

- Keep only the classic desktop shell, Cursor account workspace and settings entry.
- Remove all other providers, API relay, sidecars, OAuth/multi-open/account-switch actions and unrelated permissions.
- Connect the derived UI to the existing Cursor Usage Viewer Tauri commands and persisted account view model.
- Add Grok/Sand as a fifth quota after Cockpit's Total, Auto + Composer, API and On-Demand groups.
- Keep the project name and neutral icon; do not use Cockpit or Cursor branding assets.

## Imported file map

| Local derived file | Upstream source file | Modifications |
|---|---|---|
| `src/App.tsx` | `src/pages/CursorAccountsPage.tsx`; `src/components/layout/SideNav.tsx`; `src/App.tsx:2129-2203` | Retained the Cursor page JSX/class structure, classic navigation structure and `light`/`dark`/`system` theme behavior. Removed every non-Cursor provider, account switching/injection, OAuth entry, remote settings and unrelated command. Connected existing local Cursor commands and added Grok/Sand as the fifth quota. |
| `src/cockpit-derived.css` | `src/styles/base.css`; `src/styles/layout.css`; `src/styles/components.css`; `src/styles/pages/github-copilot.css` | Scoped the upstream design tokens and the classic sidebar, toolbar, Cursor card, quota and footer rules to the Cursor-only application. Kept both upstream light and dark palettes; removed rules for unrelated providers, sidecars, branding, theme packs and unused controls. Added styles for the fifth Grok/Sand quota and local pagination/settings adapters. |
| `src/App.test.tsx` | Behavioral adaptation of `src/App.tsx:2129-2203` and `src/pages/CursorAccountsPage.tsx:609-773,929-1139` | Added regression coverage for persisted theme selection, live system-theme changes, the classic shell, Cursor card structure and exactly five quota groups. Test data remains fake and cannot authenticate. |

All upstream paths in this table refer to commit `a0508ae815e104e931dae515389e680840008367`. The upstream project name and logo are not copied into the application UI.
