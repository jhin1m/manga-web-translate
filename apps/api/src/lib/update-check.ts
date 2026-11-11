/**
 * Kiểm tra bản mới của self-host: lười (chỉ khi có người hỏi), cache trong bộ nhớ, gộp request đang bay.
 * Chạy ở server để trình duyệt chỉ nói chuyện cùng origin và GitHub chỉ thấy UA chung, tối đa ~1 lần/ngày.
 */
import { isNewer, parseVersion, RELEASE_REPO, releaseUrl, type UpdateStatus } from "@mtl/shared/update";
import { env } from "../env.ts";

export type UpdateCheckResult = Pick<UpdateStatus, "check" | "latest">;
type Latest = NonNullable<UpdateStatus["latest"]>;

export const OK_TTL_MS = 24 * 60 * 60 * 1000;
export const ERROR_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const NAME_MAX = 120;

export type UpdateCheckOptions = {
  fetch?: typeof fetch;
  now?: () => number;
  /** Phiên bản đang chạy ("dev" hoặc không phải semver = bản dev). */
  current: string;
  enabled: boolean;
  /** Thay kết quả GitHub (chỉ người phát hành); không phải semver thì bị bỏ qua. */
  override?: string;
};

export type UpdateCheck = {
  readonly current: string;
  /** `fresh`: bỏ qua cache, hỏi GitHub một lần; lỗi thì trả kết quả tốt đã cache (nếu có). */
  get(opts?: { fresh?: boolean }): Promise<UpdateCheckResult>;
};

const stripV = (v: string) => (v.startsWith("v") ? v.slice(1) : v);

class CheckError extends Error {}

/** Parse body của `releases/latest`; bản nháp, prerelease hay tag không phải semver đều coi là lỗi. */
function parseRelease(body: unknown): Latest {
  if (typeof body !== "object" || body === null) throw new CheckError("phản hồi không phải object");
  const r = body as Record<string, unknown>;
  if (r.draft === true || r.prerelease === true) throw new CheckError("bản mới nhất là bản nháp/prerelease");
  if (typeof r.tag_name !== "string" || parseVersion(r.tag_name) === null) {
    throw new CheckError("tag_name không phải semver");
  }
  const version = stripV(r.tag_name);
  const name = typeof r.name === "string" ? r.name.trim().slice(0, NAME_MAX).trim() : "";
  // URL dựng từ tag đã kiểm, không dùng `html_url` của phản hồi.
  return { version, name: name || `v${version}`, url: releaseUrl(version), source: "github" };
}

export function createUpdateCheck(opts: UpdateCheckOptions): UpdateCheck {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const devBuild = parseVersion(opts.current) === null;
  let override: Latest | null = null;
  let overrideChecked = false;
  let cache: { result: UpdateCheckResult; expires: number } | null = null;
  let inflight: Promise<UpdateCheckResult> | null = null;

  const resolveOverride = (): Latest | null => {
    if (!overrideChecked) {
      overrideChecked = true;
      if (opts.override) {
        if (parseVersion(opts.override)) {
          const version = stripV(opts.override);
          override = { version, name: `v${version}`, url: releaseUrl(version), source: "override" };
        } else {
          console.warn("[update-check] MTL_UPDATE_TARGET không phải semver, bỏ qua");
        }
      }
    }
    return override;
  };

  async function request(): Promise<UpdateCheckResult> {
    try {
      const res = await doFetch(`https://api.github.com/repos/${RELEASE_REPO}/releases/latest`, {
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "mtl-selfhost",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new CheckError(`GitHub trả ${res.status}`);
      const body = await res.json().catch(() => {
        throw new CheckError("phản hồi không phải JSON");
      });
      return { check: "ok", latest: parseRelease(body) };
    } catch (err) {
      console.warn(`[update-check] ${err instanceof CheckError ? err.message : "không gọi được GitHub"}`);
      return { check: "error", latest: null };
    }
  }

  function refresh(): Promise<UpdateCheckResult> {
    inflight ??= request()
      .then((result) => {
        const goodValid = cache?.result.check === "ok" && now() < cache.expires;
        // Lỗi không ghi đè kết quả tốt còn hạn (trường hợp `fresh`).
        if (result.check === "ok" || !goodValid) {
          cache = { result, expires: now() + (result.check === "ok" ? OK_TTL_MS : ERROR_TTL_MS) };
        }
        return result;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  return {
    current: opts.current,
    async get({ fresh = false } = {}) {
      if (devBuild) return { check: "dev", latest: null };
      const forced = resolveOverride();
      if (forced) return { check: "ok", latest: forced };
      if (!opts.enabled) return { check: "disabled", latest: null };
      if (!fresh && cache && now() < cache.expires) return cache.result;
      const stale = cache;
      const result = await refresh();
      if (fresh && result.check === "error" && stale?.result.check === "ok") return stale.result;
      return result;
    },
  };
}

/** Có bản mới hơn bản đang chạy (dev build luôn false). */
export function updateAvailable(current: string, r: UpdateCheckResult): boolean {
  return r.latest !== null && isNewer(r.latest.version, current);
}

let instance: UpdateCheck | null = null;

export function getUpdateCheck(): UpdateCheck {
  instance ??= createUpdateCheck({
    current: env.MTL_VERSION,
    enabled: env.MTL_UPDATE_CHECK,
    override: env.MTL_UPDATE_TARGET,
  });
  return instance;
}

/** Test thay singleton (null = dựng lại từ env). */
export function setUpdateCheckForTest(check: UpdateCheck | null): void {
  instance = check;
}
