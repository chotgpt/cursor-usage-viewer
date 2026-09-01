import { invoke } from "@tauri-apps/api/core";
import type { BatchAccountResult, CursorAccountView } from "../types";
export const isTauri = () => "__TAURI_INTERNALS__" in window;
export async function listAccounts() { return isTauri() ? invoke<CursorAccountView[]>("list_cursor_accounts") : []; }
export async function importAccounts(payload: string) { return invoke<CursorAccountView[]>("import_cockpit_accounts_json", { payload }); }
export async function readLocalAccount() { return invoke<CursorAccountView>("load_current_cursor_account"); }
export async function refreshAccount(accountId: string) { return invoke<CursorAccountView>("refresh_cursor_account", { accountId }); }
export async function refreshAccounts(accountIds: string[]) { return invoke<BatchAccountResult[]>("refresh_cursor_accounts", { accountIds }); }
export async function deleteAccount(accountId: string) { return invoke<void>("delete_cursor_account", { accountId }); }
export async function deleteAccounts(accountIds: string[]) { return invoke<void>("delete_cursor_accounts", { accountIds }); }
export async function updateAccountTags(accountId: string, tags: string[]) { return invoke<CursorAccountView>("update_cursor_account_tags", { accountId, tags }); }
export async function exportAccounts(accountIds: string[]) { return invoke<string>("export_cursor_accounts", { accountIds }); }
export async function saveExport(accountIds: string[], path: string) { return invoke<void>("save_cursor_accounts_export", { accountIds, path }); }
export async function revealSavedExport(path: string) { return invoke<void>("reveal_saved_cursor_accounts_export", { path }); }
export async function performClose(action: "tray" | "exit", remember: boolean) { return invoke<void>("perform_close_action", { action, remember }); }
