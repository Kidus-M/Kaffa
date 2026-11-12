"use server";

import { and, eq, gte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { questions } from "@/db/schema";
import { getShipmentByToken } from "@/lib/queries";
import { askQuestion } from "@/services/copilot";
import { getAppDeps } from "@/services/deps";

export type PortalAskState =
  | { ok: true; question: string; status: "answered" | "drafted" | "needs_person"; answer: string; citations: { id: string; label: string }[] }
  | { ok: false; message: string }
  | null;

/** Questions per shipment per ten minutes; the portal is public behind its token. */
const LIMIT = 10;

export async function askPortalQuestion(_prev: PortalAskState, form: FormData): Promise<PortalAskState> {
  const token = String(form.get("token") ?? "");
  const question = String(form.get("question") ?? "").trim();
  if (question.length < 8) return { ok: false, message: "Ask a full question." };
  if (question.length > 500) return { ok: false, message: "Keep the question under 500 characters." };
  const deps = await getAppDeps();
  const shipment = await getShipmentByToken(deps.db, token);
  if (!shipment) return { ok: false, message: "This portal link is no longer valid." };
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const [{ n }] = await deps.db
    .select({ n: sql<number>`count(*)::int` })
    .from(questions)
    .where(and(eq(questions.shipmentId, shipment.id), gte(questions.createdAt, since)));
  if (n >= LIMIT) return { ok: false, message: "Too many questions in a short time; please try again in a few minutes." };

  const r = await askQuestion(deps, { orgId: shipment.orgId, question, channel: "portal", asker: shipment.buyerName, shipmentId: shipment.id });
  revalidatePath(`/portal/${token}`);
  return { ok: true, question, status: r.status, answer: r.answer, citations: r.citations };
}
