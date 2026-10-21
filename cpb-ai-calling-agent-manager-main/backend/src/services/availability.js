const TIMEZONE = 'Asia/Kolkata';
const PRECISIONS = new Set(['exact', 'date_only', 'window', 'time_only', 'unparsed']);

const parseIso = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const emptyAvailability = (phrase = '') => ({
  phrase: phrase || '',
  precision: phrase ? 'unparsed' : '',
  startAt: null,
  endAt: null,
  timezone: TIMEZONE,
});

// Turns the model's slot into datetimes. Relative words stay in `phrase`.
// A window stays a range. A day with no hour is that whole day, not an invented clock time.
export const normalizeAvailability = (payload, phrase) => {
  const spoken = String(phrase || '').trim().slice(0, 200);
  const precisionRaw = String(payload?.availability_precision || '').trim().toLowerCase();
  const precision = PRECISIONS.has(precisionRaw) ? precisionRaw : 'unparsed';
  if (!spoken || precision === 'unparsed') return emptyAvailability(spoken);

  const startAt = parseIso(payload?.availability_start);
  const parsedEnd = parseIso(payload?.availability_end);
  if (!startAt) return emptyAvailability(spoken);

  let endAt = parsedEnd && parsedEnd >= startAt ? parsedEnd : startAt;
  if (precision === 'exact' || precision === 'time_only') {
    endAt = startAt;
  }
  return {
    phrase: spoken,
    precision,
    startAt,
    endAt,
    timezone: TIMEZONE,
  };
};

const parts = (date, options) => new Intl.DateTimeFormat('en-IN', { timeZone: TIMEZONE, ...options }).format(date);

export const formatAvailabilityLabel = (availability) => {
  if (!availability?.startAt) return availability?.phrase || '';
  const start = new Date(availability.startAt);
  const end = availability.endAt ? new Date(availability.endAt) : start;
  const day = { day: 'numeric', month: 'short' };
  const clock = { hour: 'numeric', minute: '2-digit' };
  if (availability.precision === 'date_only') return parts(start, day);
  if (availability.precision === 'exact' || availability.precision === 'time_only') {
    return `${parts(start, day)}, ${parts(start, clock)}`;
  }
  const sameDay = parts(start, { year: 'numeric', month: '2-digit', day: '2-digit' })
    === parts(end, { year: 'numeric', month: '2-digit', day: '2-digit' });
  if (sameDay) return `${parts(start, day)}, ${parts(start, clock)} – ${parts(end, clock)}`;
  return `${parts(start, day)} – ${parts(end, day)}`;
};
