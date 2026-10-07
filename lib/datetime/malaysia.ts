const MALAYSIA_OFFSET_MILLISECONDS = 8 * 60 * 60 * 1000;
const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function parseLocalDateTime(value: string): DateTimeParts {
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  if (!match) throw new RangeError("Invalid local date-time value");

  const [, year, month, day, hour, minute, second = "00"] = match;
  const parts = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  };
  const malaysiaTimestamp = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const reconstructed = new Date(malaysiaTimestamp);

  if (
    reconstructed.getUTCFullYear() !== parts.year
    || reconstructed.getUTCMonth() !== parts.month - 1
    || reconstructed.getUTCDate() !== parts.day
    || reconstructed.getUTCHours() !== parts.hour
    || reconstructed.getUTCMinutes() !== parts.minute
    || reconstructed.getUTCSeconds() !== parts.second
  ) {
    throw new RangeError("Invalid local date-time value");
  }

  return parts;
}

function malaysiaTimestamp(value: string) {
  const parts = parseLocalDateTime(value);
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  ) - MALAYSIA_OFFSET_MILLISECONDS;
}

/** Converts an HTML datetime-local wall time in Malaysia (UTC+08:00) to UTC ISO. */
export function malaysiaDateTimeLocalToIso(value: string) {
  return new Date(malaysiaTimestamp(value)).toISOString();
}

/** Inclusive calendar-day boundaries for an HTML date in Malaysia time. */
export function malaysiaCalendarDateToIso(value: string, boundary: "start" | "end") {
  const start = malaysiaTimestamp(`${value}T00:00`);
  return new Date(start + (boundary === "end" ? 24 * 60 * 60 * 1000 - 1 : 0)).toISOString();
}

export function isInvalidMalaysiaDateRange(startsOn: string, endsOn: string) {
  if (!startsOn || !endsOn) return false;
  try {
    return malaysiaCalendarDateToIso(endsOn, "start") < malaysiaCalendarDateToIso(startsOn, "start");
  } catch {
    return true;
  }
}

export function isMalaysiaFullDayRange(startsAt: string, endsAt: string) {
  if (!startsAt || !endsAt) return false;
  try {
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return false;
    const startDate = new Date(start.getTime() + MALAYSIA_OFFSET_MILLISECONDS).toISOString().slice(0, 10);
    const endDate = new Date(end.getTime() + MALAYSIA_OFFSET_MILLISECONDS).toISOString().slice(0, 10);
    return start.getTime() === Date.parse(malaysiaCalendarDateToIso(startDate, "start"))
      && end.getTime() === Date.parse(malaysiaCalendarDateToIso(endDate, "end"));
  } catch {
    return false;
  }
}

/** Incomplete ranges remain valid while the user is still filling the form. */
export function isInvalidDateTimeRange(startsAt: string, endsAt: string) {
  if (!startsAt || !endsAt) return false;
  try {
    return malaysiaTimestamp(endsAt) <= malaysiaTimestamp(startsAt);
  } catch {
    return true;
  }
}
