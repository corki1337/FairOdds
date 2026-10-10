/** Parse known timestamps without silently replacing an explicit timezone. */
export function timestamp(value?: string | null): number | null {
  if (!value) return null;
  const iso = value.trim().replace(" ", "T");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso)) return null;
  const date = iso.slice(0, 10),
    [year, month, day] = date.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    Number(iso.slice(11, 13)) >= 24 ||
    Number(iso.slice(14, 16)) >= 60
  )
    return null;
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso}Z`;
  const ms = Date.parse(withZone);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}
export function eventTime(
  iso?: string | null,
  date?: string | null,
  time?: string | null,
) {
  const exact =
    timestamp(iso) ?? (date && time ? timestamp(`${date}T${time}`) : null);
  if (exact !== null) return { startTime: exact, timeTBD: false };
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const fallback = timestamp(`${date}T12:00:00Z`);
  if (
    fallback === null ||
    new Date(fallback * 1000).toISOString().slice(0, 10) !== date
  )
    return null;
  return { startTime: fallback, timeTBD: true };
}
