/**
 * API worker `/worker/v1/*` (pull-only, worker chỉ gọi ra ngoài → chạy sau NAT). Auth Bearer token worker;
 * mọi lệnh sau claim fenced bằng {lease_token, attempt} — xem jobs/queue.ts.
 */
import { isUuid } from "@mtl/db";
import {
  ClaimRequest,
  CompleteRequest,
  FailRequest,
  HeartbeatRequest,
  PresignOutputsRequest,
  SessionsEndRequest,
} from "@mtl/shared";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { endSession } from "../jobs/dispatcher.ts";
import { JobHttpError } from "../jobs/errors.ts";
import { claim, complete, fail, heartbeat, presignJobOutputs } from "../jobs/queue.ts";
import { parseJson } from "../lib/validate.ts";
import { authenticateWorker, type WorkerIdentity } from "../lib/worker-token.ts";

type WorkerEnv = { Variables: { worker: WorkerIdentity } };

const requireWorker = createMiddleware<WorkerEnv>(async (c, next) => {
  const m = /^Bearer (\S+)$/.exec(c.req.header("authorization") ?? "");
  const w = m?.[1] ? await authenticateWorker(m[1]) : null;
  if (!w) throw new HTTPException(401, { message: "invalid worker token" });
  c.set("worker", w);
  await next();
});

const jobId = (id: string) => {
  // id lạ coi như lease không còn → 409, worker bỏ job.
  if (!isUuid(id)) throw new JobHttpError(409, "lease_lost");
  return id;
};

export const workerRoutes = new Hono<WorkerEnv>();
workerRoutes.use("*", requireWorker);

workerRoutes.onError((err, c) => {
  if (err instanceof JobHttpError) return c.json({ error: err.code, message: err.message }, err.status);
  throw err;
});

workerRoutes.post("/claim", async (c) => {
  const body = await parseJson(c, ClaimRequest);
  return c.json({ jobs: await claim(c.get("worker"), body) });
});

workerRoutes.post("/jobs/:id/heartbeat", async (c) => {
  const body = await parseJson(c, HeartbeatRequest);
  return c.json(await heartbeat(c.get("worker"), jobId(c.req.param("id")), body));
});

workerRoutes.post("/jobs/:id/presign-outputs", async (c) => {
  const body = await parseJson(c, PresignOutputsRequest);
  return c.json(await presignJobOutputs(c.get("worker"), jobId(c.req.param("id")), body));
});

workerRoutes.post("/jobs/:id/complete", async (c) => {
  const body = await parseJson(c, CompleteRequest);
  const r = await complete(c.get("worker"), jobId(c.req.param("id")), body);
  if (r.rejected) return c.json({ error: r.rejected }, 409);
  return c.json(r);
});

workerRoutes.post("/jobs/:id/fail", async (c) => {
  const body = await parseJson(c, FailRequest);
  return c.json(await fail(c.get("worker"), jobId(c.req.param("id")), body));
});

// Container Modal báo lúc thoát (chỉ token nền tảng): GPU rỗi = lifetime − busy → ledger chi phí nền tảng.
workerRoutes.post("/sessions/end", async (c) => {
  if (c.get("worker").workspaceId) throw new JobHttpError(403, "platform_token_required");
  const body = await parseJson(c, SessionsEndRequest);
  return c.json(await endSession(body));
});
