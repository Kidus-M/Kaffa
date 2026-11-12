/**
 * Fixed chase messages, used when Gemini is unavailable and as the reference the
 * Gemini version must match. The Amharic needs a native speaker's check before use.
 */
import type { GapNeed } from "@/domain/gaps";

export type ChaseItem = { plotRef: string; farmer: string; need: GapNeed };
export type Language = "am" | "en";

const NEED_TEXT: Record<Language, Record<GapNeed, string>> = {
  am: {
    boundary: "የእርሻውን ድንበር ዙሪያውን በመራመድ ይመዝግቡ",
    location: "የእርሻውን ትክክለኛ ቦታ (location) ይላኩ",
    photo: "የእርሻውን ፎቶ ይላኩ",
    confirm: "እርሻው ላይ ሆነው ቦታውን ያረጋግጡ",
  },
  en: {
    boundary: "walk the farm boundary to record it",
    location: "send the farm's exact location",
    photo: "send a photo of the farm",
    confirm: "confirm the location while standing on the farm",
  },
};

const WORDS: Record<Language, { hello: string; intro: string; outro: string; reminder: string }> = {
  am: {
    hello: "ሰላም",
    intro: "ለአውሮፓ ገበያ የሚከተሉት እርሻዎች መረጃ ያስፈልጋቸዋል፦",
    outro: "ከታች ያለውን ቁልፍ ተጭነው ይጀምሩ። እናመሰግናለን!",
    reminder: "አስታዋሽ፦",
  },
  en: {
    hello: "Hello",
    intro: "These farms need information before their coffee can go to Europe:",
    outro: "Tap the button below to start. Thank you!",
    reminder: "Reminder:",
  },
};

export function chaseTemplate(input: { agentName: string; language: Language; items: ChaseItem[]; reminder?: boolean }): string {
  const w = WORDS[input.language];
  const firstName = input.agentName.split(" ")[0];
  const lines = input.items.map((i) => `• ${i.plotRef} (${i.farmer}): ${NEED_TEXT[input.language][i.need]}`);
  return [input.reminder ? `${w.reminder} ${w.hello} ${firstName},` : `${w.hello} ${firstName},`, w.intro, ...lines, w.outro].join("\n");
}

export function escalationText(input: { agentName: string; items: ChaseItem[]; hours: number }): string {
  const refs = input.items.map((i) => i.plotRef).join(", ");
  return `${input.agentName} has not replied in ${input.hours} hours about ${refs}. These plots hold their lots until fixed.`;
}

const PLAN_WORDS: Record<Language, { title: (date: string) => string; start: string; rain: string; home: (min: number) => string }> = {
  am: {
    title: (date) => `የ${date} የጉብኝት እቅድ፦`,
    start: "ከማህበሩ ይጀምሩ፤ በዚህ ቅደም ተከተል ይጎብኙ፦",
    rain: "ዝናብ ስለሚጠበቅ ይህ ቀን ተዘሏል።",
    home: (min) => `ጠቅላላ የጉዞ ጊዜ፦ ${min} ደቂቃ ገደማ።`,
  },
  en: {
    title: (date) => `Visit plan for ${date}:`,
    start: "Start from the cooperative and visit in this order:",
    rain: "Heavy rain is forecast, so this day was skipped.",
    home: (min) => `Total travel about ${min} minutes.`,
  },
};

/** The day plan a field agent receives in Telegram. Amharic needs a native speaker's check. */
export function dayPlanText(input: { language: Language; date: string; stops: { label: string; need: string }[]; travelMinutes: number; skippedRain?: string[] }): string {
  const w = PLAN_WORDS[input.language];
  const lines = input.stops.map((s, i) => `${i + 1}. ${s.label}: ${NEED_TEXT[input.language][s.need as GapNeed] ?? s.need}`);
  return [w.title(input.date), w.start, ...lines, w.home(input.travelMinutes), ...(input.skippedRain?.length ? [`${input.skippedRain.join(", ")}: ${w.rain}`] : [])].join("\n");
}
