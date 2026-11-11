import { z } from "zod";
import { env } from "@/config/env";
import { getDb } from "@/db/client";
import { demoModeEnabled, fieldTasks, resolveFieldAgent } from "@/services/field-app";

const body = z.object({ initData: z.string().max(4096).optional(), demoAgentId: z.string().max(64).optional() });

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });
  const db = await getDb();
  const agent = await resolveFieldAgent(db, parsed.data, { botToken: env().TELEGRAM_BOT_TOKEN, demoMode: demoModeEnabled() });
  if (!agent) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({
    agent: { name: agent.name.replace(" (synthetic)", ""), language: agent.language },
    demo: !env().TELEGRAM_BOT_TOKEN && demoModeEnabled(),
    tasks: await fieldTasks(db, agent),
  });
}
