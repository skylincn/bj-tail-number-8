import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SOURCE_URL = "https://jtgl.beijing.gov.cn/jgj/lszt/659722/660341/";
const TIMEZONE = "Asia/Shanghai";
const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR"] as const;

type Weekday = (typeof WEEKDAYS)[number];

type RestrictionCycle = {
  startDate: string;
  endDate: string;
  restrictions: Record<Weekday, string[]>;
};

const FALLBACK_CYCLES: RestrictionCycle[] = [
  {
    startDate: "2026-06-29",
    endDate: "2026-09-27",
    restrictions: {
      MO: ["1", "6"],
      TU: ["2", "7"],
      WE: ["3", "8"],
      TH: ["4", "9"],
      FR: ["5", "0"],
    },
  },
  {
    startDate: "2026-09-28",
    endDate: "2026-12-27",
    restrictions: {
      MO: ["5", "0"],
      TU: ["1", "6"],
      WE: ["2", "7"],
      TH: ["3", "8"],
      FR: ["4", "9"],
    },
  },
  {
    startDate: "2026-12-28",
    endDate: "2027-03-28",
    restrictions: {
      MO: ["4", "9"],
      TU: ["5", "0"],
      WE: ["1", "6"],
      TH: ["2", "7"],
      FR: ["3", "8"],
    },
  },
];

async function main() {
  const plateTail = normalizePlateTail(process.env.PLATE_TAIL ?? "8");
  const cycles = await loadCycles();
  const restrictedCycles = cycles
    .map((cycle) => ({
      cycle,
      days: restrictedWeekdays(cycle, plateTail),
    }))
    .filter(({ days }) => days.length > 0);

  if (restrictedCycles.length === 0) {
    throw new Error(`No restriction cycles found for plate tail ${plateTail}.`);
  }

  const calendar = buildCalendar(plateTail, restrictedCycles);
  const outputPath = path.join("dist", `plate-${plateTail}.ics`);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, calendar, "utf8");

  console.log(`Generated ${outputPath}`);
}

async function loadCycles(): Promise<RestrictionCycle[]> {
  try {
    const response = await fetch(SOURCE_URL, {
      headers: {
        "user-agent": "beijing-moto-calendar/0.1 (+https://github.com/)",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const cycles = parseRestrictionCycles(html);
    if (cycles.length === 0) {
      throw new Error("No restriction cycle rows parsed from official page.");
    }

    return cycles;
  } catch (error) {
    console.warn(
      `Failed to parse official restriction page, using fallback cycles: ${formatError(error)}`,
    );
    return FALLBACK_CYCLES;
  }
}

function parseRestrictionCycles(html: string): RestrictionCycle[] {
  const text = htmlToText(html);
  const tableStart = text.indexOf("轮换日期");
  const scopedText = tableStart >= 0 ? text.slice(tableStart) : text;
  const pair = "(\\d)\\s*和\\s*(\\d)";
  const rowPattern = new RegExp(
    [
      "(\\d{4}年\\d{1,2}月\\d{1,2}日)",
      "\\s*(?:至)?\\s*",
      "(\\d{4}年\\d{1,2}月\\d{1,2}日)",
      "\\s+",
      pair,
      "\\s+",
      pair,
      "\\s+",
      pair,
      "\\s+",
      pair,
      "\\s+",
      pair,
    ].join(""),
    "g",
  );

  const cycles: RestrictionCycle[] = [];
  for (const match of scopedText.matchAll(rowPattern)) {
    const [
      ,
      startDate,
      endDate,
      moA,
      moB,
      tuA,
      tuB,
      weA,
      weB,
      thA,
      thB,
      frA,
      frB,
    ] = match;

    cycles.push({
      startDate: parseChineseDate(startDate),
      endDate: parseChineseDate(endDate),
      restrictions: {
        MO: [moA, moB],
        TU: [tuA, tuB],
        WE: [weA, weB],
        TH: [thA, thB],
        FR: [frA, frB],
      },
    });
  }

  return cycles;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#40;/g, "(")
    .replace(/&#41;/g, ")")
    .replace(/\s+/g, " ")
    .trim();
}

function parseChineseDate(value: string): string {
  const match = value.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (!match) {
    throw new Error(`Invalid Chinese date: ${value}`);
  }

  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function normalizePlateTail(value: string): string {
  const trimmed = value.trim().toUpperCase();
  if (/^[0-9]$/.test(trimmed)) {
    return trimmed;
  }

  if (/^[A-Z]$/.test(trimmed)) {
    return "0";
  }

  throw new Error("PLATE_TAIL must be a single digit or English letter.");
}

function restrictedWeekdays(cycle: RestrictionCycle, plateTail: string): Weekday[] {
  return WEEKDAYS.filter((day) => cycle.restrictions[day].includes(plateTail));
}

function buildCalendar(
  plateTail: string,
  restrictedCycles: Array<{ cycle: RestrictionCycle; days: Weekday[] }>,
): string {
  const calendarName = `北京尾号${plateTail}限行`;
  const now = formatUtcDateTime(new Date());
  const events = restrictedCycles.map(({ cycle, days }) =>
    buildEvent(plateTail, cycle, days, now),
  );

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//beijing-moto-calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    `X-WR-TIMEZONE:${TIMEZONE}`,
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

function buildEvent(
  plateTail: string,
  cycle: RestrictionCycle,
  days: Weekday[],
  now: string,
): string {
  const firstDate = firstMatchingDate(cycle.startDate, cycle.endDate, days);
  if (!firstDate) {
    throw new Error(
      `Cycle ${cycle.startDate} to ${cycle.endDate} has no matching weekdays.`,
    );
  }

  const title = `🚫 北京尾号${plateTail}限行`;
  const description = `北京交管局 ${SOURCE_URL}`;

  return [
    "BEGIN:VEVENT",
    `UID:plate-${plateTail}-${cycle.startDate}-${cycle.endDate}@beijing-moto-calendar`,
    `DTSTAMP:${now}`,
    `SUMMARY:${escapeText(title)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `DTSTART;TZID=${TIMEZONE}:${formatLocalDateTime(firstDate, "070000")}`,
    `DTEND;TZID=${TIMEZONE}:${formatLocalDateTime(firstDate, "200000")}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${days.join(",")};UNTIL=${formatUntil(cycle.endDate)}`,
    "END:VEVENT",
  ].join("\r\n");
}

function firstMatchingDate(
  startDate: string,
  endDate: string,
  days: Weekday[],
): string | null {
  const targetDays = new Set(days.map(weekdayToDateDay));
  const current = parseIsoDateAsUtc(startDate);
  const end = parseIsoDateAsUtc(endDate);

  while (current <= end) {
    if (targetDays.has(current.getUTCDay())) {
      return formatIsoDate(current);
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return null;
}

function weekdayToDateDay(day: Weekday): number {
  return {
    MO: 1,
    TU: 2,
    WE: 3,
    TH: 4,
    FR: 5,
  }[day];
}

function parseIsoDateAsUtc(value: string): Date {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid ISO date: ${value}`);
  }

  const [, year, month, day] = match.map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatIsoDate(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function formatLocalDateTime(date: string, time: string): string {
  return `${date.replaceAll("-", "")}T${time}`;
}

function formatUntil(date: string): string {
  return `${date.replaceAll("-", "")}T235959`;
}

function formatUtcDateTime(date: Date): string {
  return (
    [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, "0"),
      String(date.getUTCDate()).padStart(2, "0"),
    ].join("") +
    "T" +
    [
      String(date.getUTCHours()).padStart(2, "0"),
      String(date.getUTCMinutes()).padStart(2, "0"),
      String(date.getUTCSeconds()).padStart(2, "0"),
    ].join("") +
    "Z"
  );
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error) => {
  console.error(formatError(error));
  process.exitCode = 1;
});
