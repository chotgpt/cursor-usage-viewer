# Cockpit Tools UI provenance and modification record

Upstream repository: <https://github.com/jlcodes99/cockpit-tools>

Fixed commit: `a0508ae815e104e931dae515389e680840008367`

License: CC BY-NC-SA 4.0. The adapted UI in this repository is non-commercial, attributed, and shared under the same license. This file is updated whenever an upstream-derived file is added, removed or materially modified.

## Product adaptation

- Keep only the classic desktop shell, Cursor account workspace and settings entry.
- Remove all other providers, API relay, sidecars, multi-open/account-switch actions and unrelated permissions. Keep only Cockpit's Cursor-specific web login/device flow and account-import behavior approved by D-022.
- Connect the derived UI to the existing Cursor Usage Viewer Tauri commands and persisted account view model.
- Add Grok/Sand as a fifth quota after Cockpit's Total, Auto + Composer, API and On-Demand groups. In grid cards, present it as the product-specific B2 extension: a percentage ring beside two aligned plan/access and reset/countdown rows, with separate stale, restricted and partial-failure messages. Preserve Cockpit's On-Demand `team`/fixed-limit, unlimited and disabled distinctions instead of collapsing missing limits to an unknown percentage.
- Keep the table Cursor-specific: expose the four core quota columns plus Grok/Sand directly instead of Cockpit's provider-generic `Usage Details` cell. Split the Grok/Sand reset date and minute across lines, allow wrapped plan/reason text, and use controlled horizontal overflow at narrow widths rather than hiding semantic content.
- Use a compact 1280×800 spacing adaptation around the fifth quota so the default viewport preserves Cockpit's three-column card structure and each visible card remains complete. Pagination stays after the paged results and may require scrolling, as required by the default page size and `docs/DECISIONS.md` §D-019.
- Keep the project name and neutral icon; do not use Cockpit or Cursor branding assets.
- Use one primary `+` account action with three tabs: Cursor web login; access token/Cockpit JSON; and read-only import of the current local Cursor account with a separate JSON-file action. The adjacent actions are refresh all, privacy, export and settings, in that order.
- Adapt Cockpit's Cursor auto-refresh contract into a single Rust/Tauri scheduler: default 10 minutes, off/2/5/10/15/custom choices, 5-second tick, one concurrent refresh, stable-key staggering and run protection. It remains active while the window is hidden to tray and shares the manual-refresh backend path.

## Imported file map

| Local derived file | Upstream source file | Modifications |
|---|---|---|
| `src/App.tsx` | `src/pages/CursorAccountsPage.tsx`; `src/components/layout/SideNav.tsx`; `src/App.tsx:2129-2203` | Retained the Cursor page JSX/class structure, classic navigation structure and `light`/`dark`/`system` theme behavior. Removed every non-Cursor provider, account switching/injection, remote settings and unrelated command; adapted the approved Cursor `+` add flow and action order to local commands. Connected existing local Cursor commands, added Grok/Sand as the fifth quota with a grid-only percentage ring and aligned plan/access plus reset/countdown rows, preserved Cockpit's On-Demand cents-to-dollar presentation and the exact creation-time/remaining-Credits/cycle-end sorting semantics, and expanded the Cursor-only table into explicit quota columns. |
| `src/components/accounts/AddAccountModal.tsx` | `src/pages/CursorAccountsPage.tsx` | Adapted the Cursor-only three-path add dialog and its order. Replaced upstream provider routing with this project's fixed Cursor web login, access-token/Cockpit JSON, read-only current-account and bounded JSON-file commands; retained no other provider or account-switch action. |
| `src/components/accounts/AddAccountModal.css` | Cursor dialog/tab rules used by `src/pages/CursorAccountsPage.tsx` and shared upstream account components | Scoped the three-tab dialog to the existing local modal tokens and both local themes; omitted unrelated provider artwork and styles. |
| `src/styles.css` | `src/styles/pages/loading.css`; reduced-motion rule in `src/styles/base.css` | Retained Cockpit's essential 20px, 2px-border loading ring, 0.8-second rotation and reduced-motion exception for progress feedback. Scoped the visible busy state to controls marked with `aria-busy` so disabled refresh/import actions remain legible without weakening unrelated disabled states. |
| `src/cockpit-derived.css` | `src/styles/base.css`; `src/styles/layout.css`; `src/styles/components.css`; `src/styles/pages/github-copilot.css` | Scoped the upstream design tokens and the classic sidebar, toolbar, Cursor card, quota and footer rules to the Cursor-only application. Kept both upstream light and dark palettes; removed rules for unrelated providers, sidecars, branding, theme packs and unused controls. Added styles for the fifth Grok/Sand quota, including the 6px SVG ring, two-row grid-card hierarchy, stale/error variants, minute-visible table reset, compact 1280×800 vertical fit and local pagination/settings adapters. |
| `src/components/accounts/AccountSelectionToolbar.tsx` | `src/components/AccountSelectionToolbar.tsx` | Retained the single-row select-all, selected-count, clear and action slots; removed provider-specific bulk operations. |
| `src/components/accounts/MultiSelectFilterDropdown.tsx` | `src/components/MultiSelectFilterDropdown.tsx` | Retained the accessible multi-select trigger and panel behavior; adapted labels and option model to Cursor membership types. |
| `src/components/accounts/SingleSelectFilterDropdown.tsx` | `src/components/SingleSelectFilterDropdown.tsx` | Retained the single-select dropdown interaction and placement; limited options to Cursor account sorting. |
| `src/components/accounts/AccountTagFilterDropdown.tsx` | `src/components/AccountTagFilterDropdown.tsx` | Retained the tag-filter panel and active-state behavior; removed tag editing, deletion and provider management actions. |
| `src/components/accounts/AccountFilterDropdown.css` | `src/components/AccountFilterDropdown.css` | Retained the upstream filter trigger, floating panel, option, active and light/dark rules, scoped to the reduced account controls. |
| `src/components/accounts/PaginationControls.tsx` | `src/components/PaginationControls.tsx` | Retained the page-size dropdown, range summary and previous/next controls; connected them to the existing local pagination hook. |
| `src/hooks/useDropdownPanelPlacement.ts` | `src/hooks/useDropdownPanelPlacement.ts` | Retained the viewport-aware floating panel placement behavior for the imported filter and pagination controls. |
| `src/components/settings/SettingsPage.tsx` | `src/pages/SettingsPageView.tsx`; `src/pages/SettingsGeneralPanel.tsx` | Retained the real General/About tab shell, grouped settings rows, loading/error guards and about layout. Removed unsupported upstream settings and connected language, theme, desktop lifecycle, Cursor auto-refresh and updater controls that exist in this application. |
| `src/components/settings/SettingsPage.css` | `src/pages/settings/Settings.css` | Retained the upstream settings tabs, grouped rows, switches and about-page hierarchy in both themes; removed unused provider and platform settings rules. |
| `src/App.test.tsx` | Behavioral adaptation of `src/App.tsx:2129-2203` and `src/pages/CursorAccountsPage.tsx:462-487,609-773,929-1139` | Added regression coverage for persisted theme selection, live system-theme changes, the classic shell, Cursor card structure, exactly five quota groups, and Cockpit's exact Cursor sort option/default/comparator contract. Test data remains fake and cannot authenticate. |
| `tests/visual/accounts.spec.ts` | Visual-contract adaptation of the same account/settings surfaces | Uses invalid fixture accounts and mocked Tauri commands to lock the 1280×800 grid, table, settings, empty, message and modal states without touching real Cursor data or credentials. Fixtures cover the five-action toolbar, all three add-account tabs, Cursor auto-refresh setting, English, light/dark themes and 900×600 layout in addition to the existing quota, error, export and destructive-dialog states. |

## Behavior references that are independently adapted

The following files at the same fixed commit define behavior rather than UI assets. Their contracts are reimplemented against this repository's Rust/Tauri state, storage and endpoint allowlist; no unrelated provider code is imported:

| Upstream source | Local adaptation | Retained contract |
|---|---|---|
| `src/hooks/useAutoRefresh.ts`; `src/utils/autoRefreshScheduler.ts` | `src-tauri/src/cursor_settings.rs`; `src-tauri/src/scheduler.rs`; existing shared refresh command path | Cursor default 10 minutes; off/2/5/10/15/custom settings; 5-second tick; single concurrency; stable-key staggering; run protection and stop/reschedule behavior. The scheduler lives in the Tauri process so hiding the WebView does not pause it. |
| `src-tauri/src/modules/cursor_oauth.rs` | Cursor-only provider/command implementation | `loginDeepControl` plus `auth/poll`, two-second polling, 300-second expiry and cancellation. Local validators narrow the allowed host, path and query; ordinary DTOs and events remain credential-free. |

All upstream paths in this table refer to commit `a0508ae815e104e931dae515389e680840008367`. The upstream project name and logo are not copied into the application UI.
