import { invoke } from "@tauri-apps/api/core";
import type { BatchAccountResult, CursorAccountView } from "../types";
export const isTauri = () => "__TAURI_INTERNALS__" in window;
export async function listAccounts() { return isTauri() ? invoke<CursorAccountView[]>("list_cursor_accounts") : []; }
export async function importAccounts(payload: string) { return invoke<CursorAccountView[]>("import_cockpit_accounts_json", { payload }); }
export async function readLocalAccount() { return invoke<CursorAccountView>("load_current_cursor_account"); }
export async function refreshAccount(accountId: string) { return invoke<CursorAccountView>("refresh_cursor_account", { accountId }); }
export async function refreshAccounts(accountIds: string[]) { return invoke<BatchAccountResult[]>("refresh_cursor_accounts", { accountIds }); }
export async function deleteAccount(accountId: string) { return invoke<void>("delete_cursor_account", { accountId }); }
export async function exportAccounts(accountIds: string[]) { return invoke<string>("export_cursor_accounts", { accountIds }); }
