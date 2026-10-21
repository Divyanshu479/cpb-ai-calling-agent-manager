import { useEffect, useRef, useState } from 'react';

const selectedValues = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
};

const MultiSelect = ({ label, options, value, onChange, placeholder = 'All' }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = selectedValues(value);

  useEffect(() => {
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const toggle = (optionValue) => {
    const next = selected.includes(optionValue)
      ? selected.filter((item) => item !== optionValue)
      : [...selected, optionValue];
    onChange(next.join(','));
  };

  const summary = (() => {
    if (selected.length === 0) return placeholder;
    if (selected.length === 1) {
      return options.find((option) => option.value === selected[0])?.label || selected[0];
    }
    return `${selected.length} selected`;
  })();

  return (
    <div className="relative" ref={rootRef}>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="w-full h-[42px] px-3 border border-gray-300 rounded-md bg-white text-left text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 flex items-center justify-between gap-2"
      >
        <span className={`truncate ${selected.length === 0 ? 'text-gray-500' : 'text-gray-900'}`}>{summary}</span>
        <svg className="h-4 w-4 text-gray-400 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[220px] max-h-64 overflow-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg">
          {options.map((option) => {
            const checked = selected.includes(option.value);
            return (
              <label key={option.value} className="flex items-center gap-2 px-3 py-2 text-sm text-gray-800 hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(option.value)}
                  className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-primary-500"
                />
                <span className="truncate">{option.label}</span>
              </label>
            );
          })}
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange('')}
              className="w-full text-left px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 border-t border-gray-100"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default MultiSelect;
