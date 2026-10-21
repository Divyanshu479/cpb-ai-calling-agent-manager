export const mergeTranscriptTurnsBySpeaker = (turns = []) => {
  if (!Array.isArray(turns)) return [];

  const normalized = turns
    .map((turn) => {
      const speakerRaw = String(turn?.speaker || '').trim().toLowerCase();
      const text = String(turn?.text || turn?.message || '').trim();
      if (!speakerRaw || !text) return null;

      const speaker = ['ai', 'user', 'system', 'tool'].includes(speakerRaw)
        ? speakerRaw
        : 'system';

      return {
        ...turn,
        speaker,
        text,
      };
    })
    .filter(Boolean);

  const merged = [];
  for (const turn of normalized) {
    const previous = merged[merged.length - 1];
    if (previous && previous.speaker === turn.speaker) {
      previous.text = `${previous.text} ${turn.text}`.replace(/\s+/g, ' ').trim();
      continue;
    }
    merged.push({ ...turn });
  }

  return merged;
};

export const transcriptTextToTurns = (transcriptText = '') => {
  const text = String(transcriptText || '').trim();
  if (!text) return [];

  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const turns = lines.map((line) => {
    const match = line.match(/^([a-zA-Z_]+)\s*:\s*(.*)$/);
    if (!match) {
      return { speaker: 'system', text: line };
    }

    const rawSpeaker = String(match[1] || '').toLowerCase();
    const speaker = ['ai', 'user', 'system', 'tool'].includes(rawSpeaker)
      ? rawSpeaker
      : 'system';
    return { speaker, text: String(match[2] || '').trim() };
  });

  return mergeTranscriptTurnsBySpeaker(turns);
};
