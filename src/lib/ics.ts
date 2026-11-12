/**
 * A minimal iCalendar file for a field agent's visit days. Any calendar app imports it,
 * which covers the design's calendar step without asking for Google Calendar access.
 */
export type IcsEvent = { uid: string; date: string; startMinute: number; minutes: number; title: string; description: string };

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const compact = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
/** Visits start at 08:00 Addis Ababa time (05:00 UTC). */
const stamp = (date: string, minute: number) => compact(new Date(new Date(`${date}T05:00:00Z`).getTime() + minute * 60_000));

export function toIcs(events: IcsEvent[], now = new Date()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Kaffa//Visit plans//EN", "CALSCALE:GREGORIAN"];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${compact(now)}`,
      `DTSTART:${stamp(e.date, e.startMinute)}`,
      `DTEND:${stamp(e.date, e.startMinute + e.minutes)}`,
      `SUMMARY:${esc(e.title)}`,
      `DESCRIPTION:${esc(e.description)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
