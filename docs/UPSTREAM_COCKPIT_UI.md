# Cockpit Tools UI provenance and modification record

Upstream repository: <https://github.com/jlcodes99/cockpit-tools>

Fixed commit: `a0508ae815e104e931dae515389e680840008367`

License: CC BY-NC-SA 4.0. The adapted UI in this repository is non-commercial, attributed, and shared under the same license. This file is updated whenever an upstream-derived file is added, removed or materially modified.

## Product adaptation

- Keep only the classic desktop shell, Cursor account workspace and settings entry.
- Remove all other providers, API relay, sidecars, OAuth/multi-open/account-switch actions and unrelated permissions.
- Connect the derived UI to the existing Cursor Usage Viewer Tauri commands and persisted account view model.
- Add Grok/Sand as a fifth quota after Cockpit's Total, Auto + Composer, API and On-Demand groups. In grid cards, present it as the product-specific B2 extension: a percentage ring beside two aligned plan/access and reset/countdown rows, with separate stale, restricted and partial-failure messages. Preserve Cockpit's On-Demand `team`/fixed-limit, unlimited and disabled distinctions instead of collapsing missing limits to an unknown percentage.
- Keep the table Cursor-specific: expose the four core quota columns plus Grok/Sand directly instead of Cockpit's provider-generic `Usage Details` cell. Split the Grok/Sand reset date and minute across lines, allow wrapped plan/reason text, and use controlled horizontal overflow at narrow widths rather than hiding semantic content.
- Use a compact 1280×800 spacing adaptation around the fifth quota so the default viewport preserves Cockpit's three-column card structure and each visible card remains complete. Pagination stays after the paged results and may require scrolling, as required by the default page size and `docs/DECISIONS.md` §D-019.
- Keep the project name and neutral icon; do not use Cockpit or Cursor branding assets.

## Imported file map

| Local derived file | Upstream source file | Modifications |
|---|---|---|
| `src/App.tsx` | `src/pages/CursorAccountsPage.tsx`; `src/components/layout/SideNav.tsx`; `src/App.tsx:2129-2203` | Retained the Cursor page JSX/class structure, classic navigation structure and `light`/`dark`/`system` theme behavior. Removed every non-Cursor provider, account switching/injection, OAuth entry, remote settings and unrelated command. Connected existing local Cursor commands, added Grok/Sand as the fifth quota with a grid-only percentage ring and aligned plan/access plus reset/countdown rows, preserved Cockpit's On-Demand cents-to-dollar presentation and the exact creation-time/remaining-Credits/cycle-end sorting semantics, and expanded the Cursor-only table into explicit quota columns. |
| `src/cockpit-derived.css` | `src/styles/base.css`; `src/styles/layout.css`; `src/styles/components.css`; `src/styles/pages/github-copilot.css` | Scoped the upstream design tokens and the classic sidebar, toolbar, Cursor card, quota and footer rules to the Cursor-only application. Kept both upstream light and dark palettes; removed rules for unrelated providers, sidecars, branding, theme packs and unused controls. Added styles for the fifth Grok/Sand quota, including the 6px SVG ring, two-row grid-card hierarchy, stale/error variants, minute-visible table reset, compact 1280×800 vertical fit and local pagination/settings adapters. |
| `src/components/accounts/AccountSelectionToolbar.tsx` | `src/components/AccountSelectionToolbar.tsx` | Retained the single-row select-all, selected-count, clear and action slots; removed provider-specific bulk operations. |
| `src/components/accounts/MultiSelectFilterDropdown.tsx` | `src/components/MultiSelectFilterDropdown.tsx` | Retained the accessible multi-select trigger and panel behavior; adapted labels and option model to Cursor membership types. |
| `src/components/accounts/SingleSelectFilterDropdown.tsx` | `src/components/SingleSelectFilterDropdown.tsx` | Retained the single-select dropdown interaction and placement; limited options to Cursor account sorting. |
| `src/components/accounts/AccountTagFilterDropdown.tsx` | `src/components/AccountTagFilterDropdown.tsx` | Retained the tag-filter panel and active-state behavior; removed tag editing, deletion and provider management actions. |
| `src/components/accounts/AccountFilterDropdown.css` | `src/components/AccountFilterDropdown.css` | Retained the upstream filter trigger, floating panel, option, active and light/dark rules, scoped to the reduced account controls. |
| `src/components/accounts/PaginationControls.tsx` | `src/components/PaginationControls.tsx` | Retained the page-size dropdown, range summary and previous/next controls; connected them to the existing local pagination hook. |
| `src/hooks/useDropdownPanelPlacement.ts` | `src/hooks/useDropdownPanelPlacement.ts` | Retained the viewport-aware floating panel placement behavior for the imported filter and pagination controls. |
| `src/components/settings/SettingsPage.tsx` | `src/pages/SettingsPageView.tsx`; `src/pages/SettingsGeneralPanel.tsx` | Retained the real General/About tab shell, grouped settings rows, loading/error guards and about layout. Removed unsupported upstream settings and connected language, theme, desktop lifecycle and updater controls that exist in this application. |
| `src/components/settings/SettingsPage.css` | `src/pages/settings/Settings.css` | Retained the upstream settings tabs, grouped rows, switches and about-page hierarchy in both themes; removed unused provider and platform settings rules. |
| `src/App.test.tsx` | Behavioral adaptation of `src/App.tsx:2129-2203` and `src/pages/CursorAccountsPage.tsx:462-487,609-773,929-1139` | Added regression coverage for persisted theme selection, live system-theme changes, the classic shell, Cursor card structure, exactly five quota groups, and Cockpit's exact Cursor sort option/default/comparator contract. Test data remains fake and cannot authenticate. |
| `tests/visual/accounts.spec.ts` | Visual-contract adaptation of the same account/settings surfaces | Uses invalid fixture accounts and mocked Tauri commands to lock the 1280×800 grid, table, settings, empty, message and modal states without touching real Cursor data or credentials. Fixtures cover the expanded Cursor sort dropdown, On-Demand currency display, supplied/unknown/long Grok/Sand plan labels, independent source failures, expired resets, English, light/dark themes, 900×600 card/list behavior, tag grouping, destructive/edit dialogs, localized provider errors, saved-export actions and the post-update version dialog. |

All upstream paths in this table refer to commit `a0508ae815e104e931dae515389e680840008367`. The upstream project name and logo are not copied into the application UI.
