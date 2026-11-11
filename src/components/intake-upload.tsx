"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";
import { buttonClass } from "./ui";

type Result = { ok: boolean; message?: string; created?: number; review?: number; createdRefs?: string[] };

export function IntakeUpload({ cooperatives, photosEnabled }: { cooperatives: { id: string; name: string }[]; photosEnabled: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const fileId = useId();
  const coopId = useId();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setResult(null);
    try {
      const res = await fetch("/api/intake", { method: "POST", body: new FormData(e.currentTarget) });
      setResult(await res.json());
      router.refresh();
    } catch {
      setResult({ ok: false, message: "The upload did not reach the server. Check the connection and try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <label
        htmlFor={fileId}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (input.current && e.dataTransfer.files.length) {
            input.current.files = e.dataTransfer.files;
            setFileName(e.dataTransfer.files[0].name);
          }
        }}
        className={`flex cursor-pointer flex-col items-center gap-3 rounded-[var(--radius-card)] px-6 py-10 text-center transition-colors ${
          dragging ? "bg-leaf-wash shadow-[inset_0_0_0_1.5px_var(--color-leaf)]" : "bg-page shadow-[inset_0_0_0_1.5px_var(--color-hairline-strong)] hover:bg-sunken"
        }`}
        style={{ borderRadius: "var(--radius-card)" }}
      >
        <span className="grid size-12 place-items-center rounded-full bg-surface shadow-[var(--shadow-card)]">
          {fileName ? <FileSpreadsheet className="size-5 text-leaf" strokeWidth={1.75} /> : <Upload className="size-5 text-ink-soft" strokeWidth={1.75} />}
        </span>
        <span className="text-[15px] font-medium">{fileName ?? "Drop a register here, or choose a file"}</span>
        <span className="max-w-md text-[13px] text-ink-soft">
          Excel or CSV with farmer, village, phone, area and coordinates. Headers in English or Amharic both work.
          {photosEnabled ? " A phone photo of a paper register works too." : " Photos of paper registers need a Gemini API key."}
        </span>
        <input
          ref={input}
          id={fileId}
          name="file"
          type="file"
          required
          accept=".xlsx,.csv,image/jpeg,image/png,image/webp"
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
          className="sr-only"
        />
      </label>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <label htmlFor={coopId} className="flex flex-col gap-1.5 text-[13px] text-ink-faint">
          Cooperative
          <select
            id={coopId}
            name="cooperativeId"
            required
            className="h-10 rounded-full bg-surface px-4 text-sm text-ink shadow-[var(--shadow-card)]"
          >
            {cooperatives.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-3">
          <a href="/samples/konga-register.csv" className={buttonClass("ghost")}>
            Sample register
          </a>
          <button type="submit" disabled={pending} className={buttonClass("primary")}>
            {pending ? "Reading register" : "Read register"}
          </button>
        </div>
      </div>
      <p role="status" aria-live="polite" className={`text-sm ${result && !result.ok ? "text-blocked" : "text-ink-soft"}`}>
        {result?.ok
          ? `Created ${result.created} plots${result.createdRefs?.length ? `: ${result.createdRefs.join(", ")}` : ""}. ${result.review ? `${result.review} ${result.review === 1 ? "row needs" : "rows need"} your check below.` : "Nothing to check."}`
          : result?.message}
      </p>
    </form>
  );
}
