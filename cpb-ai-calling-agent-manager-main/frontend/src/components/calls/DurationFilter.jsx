import { useEffect, useState } from 'react';

const SINGLE_PRESETS = [
  { label: '30 sec', seconds: 30 },
  { label: '1 min', seconds: 60 },
  { label: '2 min', seconds: 120 },
  { label: '5 min', seconds: 300 },
];

const RANGE_PRESETS = [
  { label: '30s – 1 min', from: 30, to: 60 },
  { label: '1 – 2 min', from: 60, to: 120 },
  { label: '2 – 5 min', from: 120, to: 300 },
];

const OPS = [
  { id: 'above', label: 'Above' },
  { id: 'below', label: 'Below' },
  { id: 'between', label: 'Between' },
];

const splitSeconds = (totalSeconds) => {
  if (totalSeconds === '' || totalSeconds === undefined || totalSeconds === null) {
    return { minutes: '', seconds: '' };
  }
  const total = Number.parseInt(String(totalSeconds), 10);
  if (!Number.isFinite(total) || total < 0) return { minutes: '', seconds: '' };
  return {
    minutes: String(Math.floor(total / 60)),
    seconds: String(total % 60),
  };
};

const toTotal = (minutes, seconds) => {
  if (minutes === '' && seconds === '') return '';
  const minuteValue = minutes === '' ? 0 : Math.max(0, Number.parseInt(minutes, 10) || 0);
  const secondValue = seconds === '' ? 0 : Math.max(0, Number.parseInt(seconds, 10) || 0);
  const carriedMinutes = Math.floor(secondValue / 60);
  return String((minuteValue + carriedMinutes) * 60 + (secondValue % 60));
};

const formatLength = (totalSeconds) => {
  const total = Number.parseInt(String(totalSeconds), 10);
  if (!Number.isFinite(total) || total < 0) return '';
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const parts = [];
  if (minutes) parts.push(`${minutes} min${minutes === 1 ? '' : 's'}`);
  if (seconds || !minutes) parts.push(`${seconds} sec`);
  return parts.join(' ');
};

const describeDuration = (op, fromSeconds, toSeconds) => {
  if (op === 'between') {
    if (fromSeconds === '' || toSeconds === '') return 'Set a start and an end';
    const start = Math.min(Number(fromSeconds), Number(toSeconds));
    const end = Math.max(Number(fromSeconds), Number(toSeconds));
    return `${formatLength(start)} to ${formatLength(end)}`;
  }
  if (fromSeconds === '' || fromSeconds === undefined || fromSeconds === null) return 'Any length';
  const label = formatLength(fromSeconds);
  if (!label) return 'Any length';
  return op === 'below' ? `Up to ${label}` : `At least ${label}`;
};

const fieldClass = 'w-12 h-9 px-2 text-sm text-center border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

const TimeFields = ({ minutes, seconds, onMinutes, onSeconds, minuteLabel, secondLabel }) => (
  <div className="flex items-center gap-1.5">
    <input
      type="text"
      inputMode="numeric"
      value={minutes}
      onChange={(e) => onMinutes(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
      placeholder="0"
      aria-label={minuteLabel}
      className={fieldClass}
    />
    <span className="text-xs text-gray-500 w-6">min</span>
    <input
      type="text"
      inputMode="numeric"
      value={seconds}
      onChange={(e) => onSeconds(e.target.value.replace(/[^\d]/g, '').slice(0, 2))}
      placeholder="0"
      aria-label={secondLabel}
      className={fieldClass}
    />
    <span className="text-xs text-gray-500 w-6">sec</span>
  </div>
);

const DurationFilter = ({ op = 'above', totalSeconds = '', totalSecondsTo = '', onChange }) => {
  const initialFrom = splitSeconds(totalSeconds);
  const initialTo = splitSeconds(totalSecondsTo);
  const [fromMinutes, setFromMinutes] = useState(initialFrom.minutes);
  const [fromSeconds, setFromSeconds] = useState(initialFrom.seconds);
  const [toMinutes, setToMinutes] = useState(initialTo.minutes);
  const [toSeconds, setToSeconds] = useState(initialTo.seconds);

  useEffect(() => {
    const next = splitSeconds(totalSeconds);
    setFromMinutes(next.minutes);
    setFromSeconds(next.seconds);
  }, [totalSeconds]);

  useEffect(() => {
    const next = splitSeconds(totalSecondsTo);
    setToMinutes(next.minutes);
    setToSeconds(next.seconds);
  }, [totalSecondsTo]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      const nextFrom = toTotal(fromMinutes, fromSeconds);
      const nextTo = toTotal(toMinutes, toSeconds);
      if (op === 'between') {
        if (nextFrom === String(totalSeconds ?? '') && nextTo === String(totalSecondsTo ?? '')) return;
        onChange({ durationOp: 'between', durationSeconds: nextFrom, durationSecondsTo: nextTo });
        return;
      }
      if (nextFrom === String(totalSeconds ?? '')) return;
      onChange({ durationOp: op, durationSeconds: nextFrom, durationSecondsTo: '' });
    }, 350);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromMinutes, fromSeconds, toMinutes, toSeconds, op]);

  const hasValue = op === 'between'
    ? totalSeconds !== '' || totalSecondsTo !== ''
    : totalSeconds !== '' && totalSeconds !== undefined;

  const clear = () => {
    setFromMinutes('');
    setFromSeconds('');
    setToMinutes('');
    setToSeconds('');
    onChange({ durationOp: op, durationSeconds: '', durationSecondsTo: '' });
  };

  const presets = op === 'between' ? RANGE_PRESETS : SINGLE_PRESETS;

  return (
    <div className="col-span-full border-t border-gray-100 pt-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-700">Duration</span>
          <div className="inline-flex rounded-lg bg-gray-100 p-0.5">
            {OPS.map((choice) => (
              <button
                key={choice.id}
                type="button"
                onClick={() => onChange({
                  durationOp: choice.id,
                  durationSeconds: totalSeconds,
                  durationSecondsTo: choice.id === 'between' ? totalSecondsTo : '',
                })}
                className={`px-3 h-8 text-sm rounded-md ${
                  op === choice.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {op === 'between' && <span className="text-xs text-gray-400">From</span>}
          <TimeFields
            minutes={fromMinutes}
            seconds={fromSeconds}
            onMinutes={setFromMinutes}
            onSeconds={setFromSeconds}
            minuteLabel={op === 'between' ? 'From minutes' : 'Minutes'}
            secondLabel={op === 'between' ? 'From seconds' : 'Seconds'}
          />
          {op === 'between' && (
            <>
              <span className="text-xs text-gray-400 px-1">to</span>
              <TimeFields
                minutes={toMinutes}
                seconds={toSeconds}
                onMinutes={setToMinutes}
                onSeconds={setToSeconds}
                minuteLabel="To minutes"
                secondLabel="To seconds"
              />
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {presets.map((preset) => {
            const selected = op === 'between'
              ? Number(totalSeconds) === preset.from && Number(totalSecondsTo) === preset.to
              : totalSeconds !== '' && Number(totalSeconds) === preset.seconds;
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => onChange(op === 'between'
                  ? { durationOp: 'between', durationSeconds: String(preset.from), durationSecondsTo: String(preset.to) }
                  : { durationOp: op, durationSeconds: String(preset.seconds), durationSecondsTo: '' })}
                className={`h-8 px-2.5 text-xs rounded-full border ${
                  selected
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3 sm:ml-auto">
          <span className="text-xs text-gray-500">{describeDuration(op, totalSeconds, totalSecondsTo)}</span>
          {hasValue && (
            <button type="button" onClick={clear} className="text-xs text-gray-500 hover:text-gray-900">
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default DurationFilter;
