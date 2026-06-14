export function nowIso() {
  return new Date().toISOString();
}

export function zonedDateKey(date = new Date(), timeZone = "Europe/Moscow") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function previousDateKey(dateKey) {
  const date = dateKeyToUtc(dateKey);
  date.setUTCDate(date.getUTCDate() - 1);
  return utcDateToKey(date);
}

export function dayKeysBetween(startKey, endKey) {
  if (!startKey || !endKey || startKey > endKey) return [];

  const days = [];
  const cursor = dateKeyToUtc(startKey);
  const end = dateKeyToUtc(endKey);

  while (cursor <= end) {
    days.push(utcDateToKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

export function gameWindowDateKeys(game, timeZone) {
  if (!game.startAt || !game.endAt) return [];
  return dayKeysBetween(
    zonedDateKey(new Date(game.startAt), timeZone),
    zonedDateKey(new Date(game.endAt), timeZone)
  );
}

function dateKeyToUtc(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function utcDateToKey(date) {
  return date.toISOString().slice(0, 10);
}
