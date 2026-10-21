import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { detectAutomatedParty } from '../src/services/machineTranscript.js';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/removeAmdFromCsv.js <calls.csv> [cleaned.csv]');
  process.exit(1);
}

const resolvedInput = path.resolve(inputPath);
const parsed = path.parse(resolvedInput);
const cleanedPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(parsed.dir, `${parsed.name}.cleaned${parsed.ext || '.csv'}`);
const removedPath = path.join(parsed.dir, `${parsed.name}.removed${parsed.ext || '.csv'}`);

const column = (row, names) => {
  const keys = Object.keys(row);
  for (const name of names) {
    const match = keys.find((key) => key.trim().toLowerCase() === name);
    if (match) return row[match] || '';
  }
  return '';
};

const escapeCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
};

const writeCsv = (filePath, header, rows) => {
  const lines = [header.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(header.map((key) => escapeCell(row[key])).join(','));
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
};

const rows = [];
await new Promise((resolve, reject) => {
  fs.createReadStream(resolvedInput)
    .pipe(csv())
    .on('data', (row) => rows.push(row))
    .on('end', resolve)
    .on('error', reject);
});

if (rows.length === 0) {
  console.error(`No rows found in ${resolvedInput}`);
  process.exit(1);
}

const header = Object.keys(rows[0]);
const kept = [];
const removed = [];
const reasons = { voicemail: 0, call_screening: 0, ivr: 0 };

for (const row of rows) {
  const kind = detectAutomatedParty({
    transcriptText: column(row, ['transcript', 'transcript text']),
    callOutcome: column(row, ['call outcome', 'outcome']),
    toolEndReason: column(row, ['tool end reason', 'end reason']),
  });
  if (!kind) {
    kept.push(row);
    continue;
  }
  reasons[kind] += 1;
  removed.push({ ...row, 'Removed reason': kind });
}

const removedHeader = header.includes('Removed reason') ? header : [...header, 'Removed reason'];
writeCsv(cleanedPath, header, kept);
writeCsv(removedPath, removedHeader, removed);

console.log(`Read ${rows.length} rows from ${resolvedInput}`);
console.log(`Kept ${kept.length} rows in ${cleanedPath}`);
console.log(`Removed ${removed.length} answering-machine rows in ${removedPath}`);
console.log(`  voicemail: ${reasons.voicemail}`);
console.log(`  call screening: ${reasons.call_screening}`);
console.log(`  ivr: ${reasons.ivr}`);
