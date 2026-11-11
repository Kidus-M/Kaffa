import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type { GeminiLike, GenerateJsonRequest } from "@/integrations/gemini";
import { extractRegisterPhoto, parseCsv, parseSpreadsheet, rowToPlotInput, triage, type IntakeRow } from "./intake";

async function xlsx(rows: (string | number | null)[][]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Register");
  rows.forEach((r) => ws.addRow(r));
  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}

const field = <T,>(value: T, confidence = 1) => ({ value, confidence });

describe("parseSpreadsheet", () => {
  it("reads a register with English and Amharic headers", async () => {
    const buf = await xlsx([
      ["Farmer", "ቀበሌ", "Phone", "Area (ha)", "Lat", "Lon"],
      ["Abebe Kebede", "Konga", "+251911000001", 1.2, 6.101234, 38.211234],
      ["Almaz Tadesse", "Konga", null, "0.8", "6.102345", "38.212345"],
    ]);
    const rows = await parseSpreadsheet(buf);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ farmerName: field("Abebe Kebede"), village: field("Konga"), areaHa: field(1.2), lat: field(6.101234), lon: field(38.211234) });
    expect(rows[1].areaHa).toEqual(field(0.8));
    expect(rows[1].phone).toEqual(field(null, 1));
  });

  it("gives zero confidence to a cell that is not a number where one is expected", async () => {
    const rows = await parseSpreadsheet(await xlsx([["Name", "Area", "Latitude", "Longitude"], ["Bekele Hailu", "about two", 6.1, 38.2]]));
    expect(rows[0].areaHa).toEqual(field(null, 0));
  });

  it("skips empty rows and throws a clear error when no farmer column exists", async () => {
    expect(await parseSpreadsheet(await xlsx([["Farmer", "Lat", "Lon"], [null, null, null], ["Dawit", 6.1, 38.2]]))).toHaveLength(1);
    await expect(parseSpreadsheet(await xlsx([["Colour", "Size"], ["red", 2]]))).rejects.toThrow(/farmer/i);
  });
});

describe("parseCsv", () => {
  it("reads quoted fields with commas", () => {
    const rows = parseCsv('Farmer,Village,Area,Lat,Lon\n"Kebede, Alemu",Konga,1.5,6.1,38.2\n');
    expect(rows[0].farmerName).toEqual(field("Kebede, Alemu"));
    expect(rows[0].areaHa).toEqual(field(1.5));
  });
});

describe("triage", () => {
  const row = (latConfidence: number): IntakeRow => ({
    farmerName: field("Abebe Kebede"),
    village: field("Konga"),
    phone: field(null),
    areaHa: field(1.2),
    lat: field(6.101234, latConfidence),
    lon: field(38.211234),
  });

  it("accepts confident rows and sends uncertain fields to review, naming them", () => {
    const { accepted, review } = triage([row(1), row(0.6)]);
    expect(accepted).toHaveLength(1);
    expect(review).toEqual([{ row: row(0.6), fields: ["lat"] }]);
  });

  it("sends a row with a missing location or area to review", () => {
    const r = { ...row(1), lon: field<number | null>(null, 1) };
    expect(triage([r]).review[0].fields).toEqual(["lon"]);
  });
});

describe("rowToPlotInput", () => {
  it("makes a point plot and lets the rules flag swapped coordinates", () => {
    const swapped = rowToPlotInput({
      farmerName: field("A"),
      village: field("K"),
      phone: field(null),
      areaHa: field(1),
      lat: field(38.211234),
      lon: field(6.101234),
    });
    expect(swapped.geometry).toEqual({ type: "Point", coordinates: [6.101234, 38.211234] });
    expect(swapped.validation.issues.map((i) => i.code)).toContain("swapped_coordinates");
  });
});

describe("extractRegisterPhoto", () => {
  it("returns Gemini's rows with per-field confidence, and sends the image as data", async () => {
    const calls: GenerateJsonRequest<unknown>[] = [];
    const gemini: GeminiLike = {
      async generateJson<T>(req: GenerateJsonRequest<T>) {
        calls.push(req as GenerateJsonRequest<unknown>);
        return {
          data: req.schema.parse({
            rows: [
              {
                farmerName: { value: "ተስፋዬ ግርማ", confidence: 0.92 },
                village: { value: "Konga", confidence: 0.9 },
                phone: { value: null, confidence: 0.5 },
                areaHa: { value: 0.75, confidence: 0.7 },
                lat: { value: 6.103, confidence: 0.95 },
                lon: { value: 38.213, confidence: 0.95 },
              },
            ],
          }),
          usage: { inputTokens: 900, outputTokens: 120 },
        };
      },
    };
    const { rows, usage } = await extractRegisterPhoto({ mimeType: "image/jpeg", base64: "AAAA" }, gemini);
    expect(rows[0].farmerName.value).toBe("ተስፋዬ ግርማ");
    expect(triage(rows).review[0].fields).toEqual(["areaHa"]);
    expect(usage.inputTokens).toBe(900);
    expect(JSON.stringify(calls[0].parts)).toContain("inlineData");
  });
});
