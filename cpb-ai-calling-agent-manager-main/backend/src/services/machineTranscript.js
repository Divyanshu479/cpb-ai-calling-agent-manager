const MACHINE_LINE = /record your name|see if this person|this person is available|if this person is available|stay on the line|person is not available|this person is not available|leave an additional message|leave a message|record your message|after the tone|after the beep|forwarded to voicemail|mailbox is full|screening this call|call assistant|live voicemail|google is screening|press\s+[0-9]\b/i;

// A row is an answering machine only when the caller never gets past the
// recorded greeting or the Apple/Google screener. A real person who talks
// after that stays in the sheet.
export const detectAutomatedParty = ({ transcriptText = '', callOutcome = '', toolEndReason = '' } = {}) => {
  const tool = String(toolEndReason || '').toLowerCase();
  const outcome = String(callOutcome || '').toLowerCase().replace(/\s+/g, '_');
  if (tool.includes('call_screening') || outcome === 'call_screening' || outcome === 'call_screened') return 'call_screening';
  if (tool.includes('ivr_detected') || outcome === 'ivr') return 'ivr';
  if (tool.includes('voicemail') || tool.includes('automated_system') || outcome === 'voicemail') return 'voicemail';

  const transcript = String(transcriptText || '');
  const userLines = transcript
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^user:/i.test(line));
  const lines = userLines.length > 0 ? userLines : transcript.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const machineLines = lines.filter((line) => MACHINE_LINE.test(line));
  if (machineLines.length === 0) return null;

  if (userLines.length > 0) {
    const humanLines = userLines.filter((line) => {
      if (MACHINE_LINE.test(line)) return false;
      const spoken = line.replace(/^user:\s*/i, '').trim();
      return spoken.length > 18;
    });
    if (humanLines.length > 0) return null;
  }

  const blob = machineLines.join('\n');
  if (/voicemail|leave a message|leave an additional message|record your message|after the tone|after the beep|mailbox/i.test(blob)) {
    return 'voicemail';
  }
  if (/press\s+[0-9]\b/i.test(blob)) return 'ivr';
  return 'call_screening';
};
