export function formatGCalDate(date: string, time: string): string {
  // date "YYYY-MM-DD", time "HH:mm" or "HH:mm:ss"
  const [y, m, d] = date.split("-");
  const t = time.length >= 5 ? time.slice(0, 5).replace(":", "") : time;
  return `${y}${m}${d}T${t}00`;
}

export interface GCalParams {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  description?: string;
  location?: string;
  emails?: string[];
}

export function googleCalendarLink(p: GCalParams): string {
  const start = formatGCalDate(p.date, p.startTime);
  const end = formatGCalDate(p.date, p.endTime);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: p.title,
    dates: `${start}/${end}`,
  });
  if (p.description) params.set("details", p.description);
  if (p.location) params.set("location", p.location);
  const emails = (p.emails || []).filter(Boolean);
  if (emails.length) params.set("add", emails.join(","));
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
