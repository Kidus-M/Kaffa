import { and, eq } from "drizzle-orm";
import { extractRegisterPhoto, parseCsv, parseSpreadsheet } from "@/agents/intake";
import { cooperatives } from "@/db/schema";
import { DEMO_ORG_ID } from "@/db/seed-data";
import { getAppDeps } from "@/services/deps";
import { createIntakeBatch } from "@/services/intake";
import { EVENTS } from "@/workflows/events";

const MAX_BYTES = 4 * 1024 * 1024; // under Vercel's 4.5 MB request limit
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const fail = (message: string, status = 400) => Response.json({ ok: false, message }, { status });

/** Upload a register: an Excel or CSV file, or a photo of a paper register. Tier 1 serves the demo organisation. */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const cooperativeId = String(form?.get("cooperativeId") ?? "");
  if (!(file instanceof File) || file.size === 0) return fail("Choose a file to upload.");
  if (file.size > MAX_BYTES) return fail("The file is larger than 4 MB. For a photo, take it at a lower resolution.");

  const deps = await getAppDeps();
  const [coop] = await deps.db.select().from(cooperatives).where(and(eq(cooperatives.id, cooperativeId), eq(cooperatives.orgId, DEMO_ORG_ID)));
  if (!coop) return fail("Choose a cooperative.");

  const name = file.name.toLowerCase();
  let rows;
  let usage;
  let source: "spreadsheet" | "photo" = "spreadsheet";
  try {
    if (file.type === XLSX || name.endsWith(".xlsx")) rows = await parseSpreadsheet(await file.arrayBuffer());
    else if (file.type === "text/csv" || name.endsWith(".csv")) rows = parseCsv(await file.text());
    else if (IMAGE_TYPES.includes(file.type)) {
      if (!deps.gemini) return fail("Reading photos of paper registers needs a Gemini API key (free from Google AI Studio). Spreadsheets work without one.", 503);
      source = "photo";
      const result = await extractRegisterPhoto({ mimeType: file.type, base64: Buffer.from(await file.arrayBuffer()).toString("base64") }, deps.gemini);
      rows = result.rows;
      usage = result.usage;
    } else return fail("Upload an Excel (.xlsx) or CSV file, or a JPEG, PNG or WebP photo.");
  } catch (e) {
    return fail(e instanceof Error ? e.message : "The file could not be read.", 422);
  }
  if (!rows.length) return fail("No farmer rows were found in this file.", 422);

  const batch = await createIntakeBatch(deps.db, { orgId: DEMO_ORG_ID, cooperativeId, source, fileName: file.name, rows, usage });
  for (const plotId of batch.screenable) await deps.emit({ name: EVENTS.plotScreenRequested, data: { orgId: DEMO_ORG_ID, plotId } });
  return Response.json({ ok: true, ...batch });
}
