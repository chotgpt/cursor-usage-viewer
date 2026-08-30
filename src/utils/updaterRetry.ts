export const CHECK_DELAYS = [800, 2000, 5000] as const;
export const DOWNLOAD_DELAYS = [1000, 2500, 5000] as const;
export function isRetryableUpdateError(error: unknown) { const text = String(error).toLowerCase(); return !["signature", "minisign", "invalid version", "format", "公钥", "签名"].some((item) => text.includes(item)); }
export async function withUpdaterRetry<T>(operation: () => Promise<T>, delays: readonly number[], wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))): Promise<T> { let last: unknown; for (let attempt=0;attempt<=delays.length;attempt+=1){try{return await operation();}catch(error){last=error;if(attempt===delays.length||!isRetryableUpdateError(error))throw error;await wait(delays[attempt]);}} throw last; }
