"use client";

import { area, polygon } from "@turf/turf";
import { useCallback, useEffect, useRef, useState } from "react";
import { needText } from "@/components/status";
import type { WalkPoint } from "@/domain/walk";

type Task = { plotRef: string; farmer: string; need: string; declaredAreaHa: number | null; start: [number, number] | null };
type Session = { agent: { name: string; language: "am" | "en" }; demo: boolean; tasks: Task[] };

type TgLocation = { latitude: number; longitude: number; horizontal_accuracy: number | null };
type TgWebApp = {
  initData: string;
  ready(): void;
  expand(): void;
  LocationManager?: { isInited: boolean; isLocationAvailable: boolean; init(cb?: () => void): void; getLocation(cb: (l: TgLocation | null) => void): void };
};
declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

const COPY = {
  am: { title: "የእርሻ ስራዎች", walk: "ድንበሩን መራመድ ይጀምሩ", stop: "ጨርሻለሁ፣ ላክ", none: "ምንም ስራ የለም። እናመሰግናለን!" },
  en: { title: "Farm tasks", walk: "Start walking the boundary", stop: "Finish and send", none: "No tasks right now. Thank you!" },
};
const QUEUE_KEY = "kaffa.pendingWalks";
const DEMO_AGENTS = [
  ["fa_tigist", "Tigist Alemu"],
  ["fa_dawit", "Dawit Bekele"],
  ["fa_chaltu", "Chaltu Gemechu"],
] as const;

function identity(demoAgentId: string | null) {
  const initData = typeof window !== "undefined" ? window.Telegram?.WebApp?.initData : undefined;
  return initData ? { initData } : { demoAgentId: demoAgentId ?? undefined };
}

/** Sends queued walks; anything that fails for lack of signal stays queued. */
async function flushQueue(): Promise<number> {
  let queue: unknown[] = [];
  try {
    queue = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
  } catch {}
  const remaining: unknown[] = [];
  for (const item of queue) {
    try {
      const res = await fetch("/api/field/walk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(item) });
      if (res.status >= 500) remaining.push(item);
    } catch {
      remaining.push(item);
    }
  }
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  } catch {}
  return remaining.length;
}

export function FieldApp() {
  const [demoAgentId, setDemoAgentId] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Task | null>(null);
  const [points, setPoints] = useState<WalkPoint[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const stopRef = useRef<() => void>(() => {});

  const load = useCallback(async (demo: string | null) => {
    const res = await fetch("/api/field/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(identity(demo)) });
    if (res.status === 401) {
      setSession(null);
      setError(window.Telegram?.WebApp?.initData ? "This Telegram account is not connected to Kaffa yet. Open your personal link from the exporter." : null);
      return;
    }
    setError(null);
    setSession(await res.json());
  }, []);

  useEffect(() => {
    window.Telegram?.WebApp?.ready();
    window.Telegram?.WebApp?.expand();
    // Inside Telegram, signed init data identifies the field agent on first load.
    fetch("/api/field/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(identity(null)) })
      .then(async (res) => {
        if (res.ok) setSession(await res.json());
        else if (window.Telegram?.WebApp?.initData) setError("This Telegram account is not connected to Kaffa yet. Open your personal link from the exporter.");
      })
      .catch(() => setError("No connection. Try again when you have signal."));
    const online = () => void flushQueue();
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, []);

  const t = COPY[session?.agent.language ?? "en"];

  function startWalk(task: Task) {
    setActive(task);
    setPoints([]);
    setResult(null);
    const push = (lat: number, lon: number, accuracyM: number) => setPoints((p) => [...p, { lat, lon, accuracyM, t: Date.now() }]);
    const lm = window.Telegram?.WebApp?.LocationManager;
    if (lm) {
      // Telegram's LocationManager (Bot API 8.0) works where the webview blocks browser geolocation.
      const timer = setInterval(() => lm.getLocation((l) => l && push(l.latitude, l.longitude, l.horizontal_accuracy ?? 50)), 3000);
      lm.init();
      stopRef.current = () => clearInterval(timer);
    } else if ("geolocation" in navigator) {
      const id = navigator.geolocation.watchPosition((pos) => push(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy), () => setError("Location is off. Allow location access and try again."), {
        enableHighAccuracy: true,
        maximumAge: 0,
      });
      stopRef.current = () => navigator.geolocation.clearWatch(id);
    }
  }

  /** Demo only: walks a square of the declared area around the plot, as a GPS track would. */
  function simulateWalk(task: Task) {
    if (!task.start) return;
    const [lon, lat] = task.start;
    const side = Math.sqrt(Math.max(task.declaredAreaHa ?? 1, 0.3) * 10_000);
    const dLat = side / 111_320;
    const dLon = side / (111_320 * Math.cos((lat * Math.PI) / 180));
    const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
    const track = corners.flatMap(([x, y], i) => {
      const [nx, ny] = corners[(i + 1) % 4];
      return Array.from({ length: 6 }, (_, s) => ({
        lon: lon + (x + ((nx - x) * s) / 6) * dLon + (Math.random() - 0.5) * dLon * 0.02,
        lat: lat + (y + ((ny - y) * s) / 6) * dLat + (Math.random() - 0.5) * dLat * 0.02,
        accuracyM: 4 + Math.random() * 6,
        t: i * 6 + s,
      }));
    });
    setActive(task);
    setPoints(track);
    void send(task, track, true);
  }

  async function send(task: Task, track: WalkPoint[], simulated = false) {
    stopRef.current();
    const payload = { ...identity(demoAgentId), plotRef: task.plotRef, points: track, simulated };
    try {
      const res = await fetch("/api/field/walk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await res.json();
      if (body.ok) {
        setResult(`${task.plotRef}: boundary saved, ${body.areaHa.toFixed(2)} ha. Kaffa is checking it against satellite data.`);
        setActive(null);
        await load(demoAgentId);
      } else {
        setResult(
          body.reason === "too_few_points"
            ? "Too few accurate GPS points. Walk the whole boundary again, slowly."
            : body.reason === "self_intersection"
              ? "The path crossed itself. Walk the boundary in one direction."
              : "This boundary could not be accepted. Walk it again.",
        );
      }
    } catch {
      try {
        const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
        localStorage.setItem(QUEUE_KEY, JSON.stringify([...queue, payload]));
      } catch {}
      setResult("No signal. The walk is saved on this phone and will send when you are back online.");
    }
  }

  const liveArea =
    points.length >= 3
      ? area(polygon([[...points.map((p) => [p.lon, p.lat]), [points[0].lon, points[0].lat]]])) / 10_000
      : 0;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-5 bg-sheet px-4 py-6">
      {!session ? (
        <section className="flex flex-col gap-3">
          <h1 className="text-2xl font-bold">Kaffa field tasks</h1>
          {error ? <p className="text-blocked">{error}</p> : null}
          <p className="text-ink-soft">Outside Telegram, this demo lets you act as a synthetic field agent.</p>
          <div className="flex flex-col gap-2">
            {DEMO_AGENTS.map(([id, name]) => (
              <button
                key={id}
                onClick={() => {
                  setDemoAgentId(id);
                  void load(id);
                }}
                className="rounded-md border border-rule bg-white px-4 py-3 text-left hover:border-canopy"
              >
                Continue as {name}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <>
          <header>
            <h1 lang={session.agent.language} className="font-amharic text-2xl font-bold">{t.title}</h1>
            <p className="text-ink-soft">
              {session.agent.name}
              {session.demo ? ", demo mode" : ""}
            </p>
          </header>
          {result ? <p role="status" className="rounded-md bg-canopy-soft p-3 text-sm">{result}</p> : null}
          {active ? (
            <section className="flex flex-col gap-3 rounded-lg border border-canopy p-4">
              <h2 className="text-lg font-semibold">Walking {active.plotRef}</h2>
              <p className="text-sm text-ink-soft">Walk slowly along the edge of the farm and come back to where you started.</p>
              <p className="text-3xl font-bold tabular-nums">{liveArea.toFixed(2)} ha</p>
              <p className="text-sm text-ink-soft tabular-nums">{points.length} GPS points</p>
              <button onClick={() => send(active, points)} className="rounded-md bg-canopy px-4 py-3 font-semibold text-white">
                {t.stop}
              </button>
            </section>
          ) : session.tasks.length === 0 ? (
            <p lang={session.agent.language} className="font-amharic text-lg">{t.none}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {session.tasks.map((task) => (
                <li key={task.plotRef} className="flex flex-col gap-2 rounded-lg border border-rule bg-white p-4">
                  <p className="font-semibold">
                    {task.plotRef} <span className="font-normal text-ink-soft">{task.farmer}</span>
                  </p>
                  <p className="text-sm">{needText(task.need)}</p>
                  {task.need !== "photo" ? (
                    <div className="flex flex-col gap-2">
                      <button onClick={() => startWalk(task)} lang={session.agent.language} className="rounded-md bg-canopy px-4 py-2.5 font-amharic font-semibold text-white">
                        {t.walk}
                      </button>
                      {session.demo ? (
                        <button onClick={() => simulateWalk(task)} className="rounded-md border border-rule px-4 py-2 text-sm">
                          Simulate the walk (demo only)
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-sm text-ink-soft">Send the photo in the chat with Kaffa.</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
