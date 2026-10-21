const formatPart = (date, options) => new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  ...options,
}).format(new Date(date));

export const formatAvailability = (availability) => {
  if (!availability?.startAt) return availability?.phrase || '';
  const start = availability.startAt;
  const end = availability.endAt || start;
  const day = { day: 'numeric', month: 'short' };
  const clock = { hour: 'numeric', minute: '2-digit' };
  if (availability.precision === 'date_only') return formatPart(start, day);
  if (availability.precision === 'exact' || availability.precision === 'time_only') {
    return `${formatPart(start, day)}, ${formatPart(start, clock)}`;
  }
  const sameDay = formatPart(start, { year: 'numeric', month: '2-digit', day: '2-digit' })
    === formatPart(end, { year: 'numeric', month: '2-digit', day: '2-digit' });
  if (sameDay) return `${formatPart(start, day)}, ${formatPart(start, clock)} – ${formatPart(end, clock)}`;
  return `${formatPart(start, day)} – ${formatPart(end, day)}`;
};

const startOfIstDay = (date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(date));
  return new Date(`${parts}T00:00:00+05:30`);
};

export const availabilityCloseness = (availability) => {
  if (!availability?.startAt) return '';
  const start = startOfIstDay(availability.startAt);
  const end = new Date(availability.endAt || availability.startAt);
  const today = startOfIstDay(new Date());
  if (end < new Date()) return 'Past';
  const days = Math.round((start.getTime() - today.getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return `In ${days} days`;
  return '';
};
