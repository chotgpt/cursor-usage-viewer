export const WINDOWS_OPERATION_PREFIX = "WINDOWS_OPERATION_ERROR:";

export type WindowsOperationKind =
  | "launch_app"
  | "stop_process"
  | "write_file"
  | "replace_file"
  | "delete_file"
  | "start_sidecar"
  | "open_path"
  | "backup"
  | "unknown";

export type WindowsOperationErrorCode =
  | "access_denied"
  | "file_in_use"
  | "program_not_found"
  | "port_denied"
  | "operation_failed";

export type WindowsOperationErrorDetail = {
  code: WindowsOperationErrorCode;
  operation: WindowsOperationKind;
  summary: string;
  originalReason: string;
  target: string | null;
  pids: number[];
  retryable: boolean;
  canElevate: boolean;
  manualActionAvailable: boolean;
  attemptedRecoveries: string[];
};

export function isWindowsRuntime(platform = currentPlatform()): boolean {
  return platform.toLowerCase().includes("win");
}

export function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export function redactWindowsOperationError(raw: string): string {
  return raw
    .replace(/\b(authorization)\s*:\s*bearer\s+[A-Za-z0-9._~+/-]+/gi, "$1: Bearer [REDACTED]")
    .replace(/\b(access_token|id_token|refresh_token|api[_-]?key|password|cookie)\b(\s*[=:]\s*["']?)([^\s,"'}]+)/gi, "$1$2[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_JWT]")
    .replace(/\brt\.[A-Za-z0-9._~-]{20,}\b/g, "[REDACTED_REFRESH_TOKEN]");
}

export function parseWindowsOperationError(error: unknown): WindowsOperationErrorDetail | null {
  const raw = errorText(error);
  const marker = raw.indexOf(WINDOWS_OPERATION_PREFIX);
  if (marker < 0) return null;
  try {
    const payload = JSON.parse(raw.slice(marker + WINDOWS_OPERATION_PREFIX.length).trim()) as Record<string, unknown>;
    const originalReason = redactWindowsOperationError(
      typeof payload.originalReason === "string" ? payload.originalReason : raw,
    );
    return {
      code: typeof payload.code === "string" ? payload.code as WindowsOperationErrorCode : classifyCode(originalReason),
      operation: typeof payload.operation === "string" ? payload.operation as WindowsOperationKind : "unknown",
      summary: typeof payload.summary === "string" && payload.summary.trim() ? payload.summary.trim() : originalReason,
      originalReason,
      target: typeof payload.target === "string" && payload.target.trim() ? payload.target.trim() : null,
      pids: normalizePids(payload.pids),
      retryable: payload.retryable !== false,
      canElevate: payload.canElevate === true,
      manualActionAvailable: payload.manualActionAvailable === true,
      attemptedRecoveries: Array.isArray(payload.attemptedRecoveries)
        ? payload.attemptedRecoveries.map(String).filter(Boolean)
        : [],
    };
  } catch {
    return null;
  }
}

function currentPlatform(): string {
  if (typeof navigator === "undefined") return "";
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return nav.userAgentData?.platform || navigator.platform || navigator.userAgent || "";
}

function normalizePids(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0 && item <= 0xffff_ffff))];
}

function classifyCode(raw: string): WindowsOperationErrorCode {
  const lower = raw.toLowerCase();
  if (lower.includes("os error 5") || lower.includes("permissiondenied") || lower.includes("permission denied") || lower.includes("access is denied") || lower.includes("access denied") || raw.includes("拒绝访问")) {
    return "access_denied";
  }
  if (lower.includes("os error 32") || lower.includes("sharing violation") || lower.includes("being used by another process") || lower.includes("file is in use") || raw.includes("文件被占用") || raw.includes("正在使用")) {
    return "file_in_use";
  }
  if (lower.includes("program not found") || lower.includes("the system cannot find the file specified") || lower.includes("os error 2")) {
    return "program_not_found";
  }
  if (lower.includes("os error 10013") || lower.includes("wsaeacces")) {
    return "port_denied";
  }
  return "operation_failed";
}
