"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

type Result = { ok: boolean; message?: string; created?: number; review?: number; createdRefs?: string[] };

export function IntakeUpload({ cooperatives, photosEnabled }: { cooperatives: { id: string; name: string }[]; photosEnabled: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
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
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-lg border border-rule bg-sheet p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label htmlFor={coopId} className="flex flex-col gap-1 text-sm font-medium">
          Cooperative
          <select id={coopId} name="cooperativeId" required className="rounded-md border border-rule bg-white p-2 font-normal">
            {cooperatives.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={fileId} className="flex flex-col gap-1 text-sm font-medium">
          Register file
          <input
            id={fileId}
            name="file"
            type="file"
            required
            accept=".xlsx,.csv,image/jpeg,image/png,image/webp"
            className="rounded-md border border-rule bg-white p-1.5 font-normal file:mr-3 file:rounded file:border-0 file:bg-canopy-soft file:px-3 file:py-1"
          />
        </label>
      </div>
      <p className="text-sm text-ink-soft">
        Excel or CSV with columns for farmer, village, phone, area and coordinates; headers in English or Amharic work.{" "}
        {photosEnabled ? "A phone photo of a paper register also works." : "Photos of paper registers need a Gemini API key."}{" "}
        <a href="/samples/konga-register.csv" className="text-canopy underline underline-offset-2">
          Download a sample register
        </a>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-md bg-canopy px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink disabled:opacity-60">
          {pending ? "Reading register…" : "Read register"}
        </button>
        <p role="status" aria-live="polite" className={`text-sm ${result && !result.ok ? "text-blocked" : "text-ink-soft"}`}>
          {result?.ok
            ? `Created ${result.created} plots${result.createdRefs?.length ? ` (${result.createdRefs.join(", ")})` : ""}. ${result.review} rows need your check below.`
            : result?.message}
        </p>
      </div>
    </form>
  );
}
