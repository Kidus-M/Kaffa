import { z } from "zod";
import { env } from "@/config/env";
import { getAppDeps } from "@/services/deps";
import { demoModeEnabled, resolveFieldAgent, submitWalk } from "@/services/field-app";

const point = z.object({ lon: z.number().min(-180).max(180), lat: z.number().min(-90).max(90), accuracyM: z.number().min(0).max(10_000), t: z.number() });
const body = z.object({
  initData: z.string().max(4096).optional(),
  demoAgentId: z.string().max(64).optional(),
  plotRef: z.string().regex(/^[A-Z]{3}-\d{3}$/),
  points: z.array(point).min(1).max(5000),
  simulated: z.boolean().optional(),
});

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });
  const deps = await getAppDeps();
  const agent = await resolveFieldAgent(deps.db, parsed.data, { botToken: env().TELEGRAM_BOT_TOKEN, demoMode: demoModeEnabled() });
  if (!agent) return Response.json({ error: "unauthorized" }, { status: 401 });
  // Only demo mode (no bot token, DEMO_MODE in production) may submit a simulated walk.
  const simulated = Boolean(parsed.data.simulated) && !env().TELEGRAM_BOT_TOKEN && demoModeEnabled();
  const result = await submitWalk(deps, agent, { plotRef: parsed.data.plotRef, points: parsed.data.points, simulated });
  return Response.json(result, { status: result.ok ? 200 : 422 });
}
