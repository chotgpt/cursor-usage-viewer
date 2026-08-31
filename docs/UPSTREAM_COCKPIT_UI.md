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

This table starts empty and is filled during the UI port before any derived file is committed.

| Local derived file | Upstream source file | Modifications |
|---|---|---|
