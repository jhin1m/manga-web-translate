/**
 * Phân loại lỗi job (red team #7) → quyết định requeue/failed + backoff.
 * - provider / rate_limited: KHÔNG tính attempt (hoàn lại lượt đã cộng lúc claim), đếm provider_retries ≤ 20,
 *   run_after = max(Retry-After, 30s·2^min(n,5)).
 * - schema / internal: tính attempt, tối đa max_attempts, backoff 30s·2^n.
 * - invalid_input: failed ngay.
 */
import type { ErrorClass } from "@mtl/shared";

export const MAX_PROVIDER_RETRIES = 20;
const BASE_BACKOFF_S = 30;

export const backoffSeconds = (n: number) => BASE_BACKOFF_S * 2 ** Math.min(Math.max(n, 0), 5);

export type FailDecision =
  | { kind: "failed" }
  | { kind: "requeue"; delayS: number; refundAttempt: boolean; providerRetry: boolean };

export function decideFailure(
  errorClass: ErrorClass,
  job: { attempts: number; maxAttempts: number; providerRetries: number },
  retryAfterS: number | null,
): FailDecision {
  switch (errorClass) {
    case "provider":
    case "rate_limited": {
      if (job.providerRetries >= MAX_PROVIDER_RETRIES) return { kind: "failed" };
      const delayS = Math.max(retryAfterS ?? 0, backoffSeconds(job.providerRetries));
      return { kind: "requeue", delayS, refundAttempt: true, providerRetry: true };
    }
    case "schema":
    case "internal":
      if (job.attempts >= job.maxAttempts) return { kind: "failed" };
      return { kind: "requeue", delayS: backoffSeconds(job.attempts), refundAttempt: false, providerRetry: false };
    case "invalid_input":
      return { kind: "failed" };
  }
}

/** Lỗi nghiệp vụ ánh xạ ra HTTP ở route worker. */
export class JobHttpError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 426,
    readonly code: string,
    message = code,
  ) {
    super(message);
  }
}

/** Lease sai/hết hạn/attempt cũ/token khác → 409, không ghi gì; worker phải bỏ job. */
export const leaseLost = () => new JobHttpError(409, "lease_lost");
