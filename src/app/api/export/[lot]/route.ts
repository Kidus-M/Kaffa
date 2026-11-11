import { getDb } from "@/db/client";
import { exportLot } from "@/services/lot-export";

/**
 * GET /api/export/{lotRef}?token=…&file=geojson|sheet
 * The portal token scopes access to one shipment's lots.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/export/[lot]">) {
  const { lot } = await ctx.params;
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const result = await exportLot(await getDb(), { lotRef: decodeURIComponent(lot), token });
  if (!result) return Response.json({ error: "not found" }, { status: 404 });

  if (url.searchParams.get("file") === "sheet") {
    return Response.json(result.sheet, {
      headers: { "content-disposition": `attachment; filename="${result.lot.ref}-dds-data-sheet.json"` },
    });
  }
  const part = Math.max(1, Number(url.searchParams.get("part") ?? 1));
  const file = result.files[part - 1];
  if (!file) return Response.json({ error: "no such part" }, { status: 404 });
  return new Response(JSON.stringify(file), {
    headers: {
      "content-type": "application/geo+json",
      "content-disposition": `attachment; filename="${result.fileNames[part - 1]}"`,
    },
  });
}
