// Small, pure, dependency-free helpers used across multiple modules. If a
// function here ever needs `state` or the DOM, it belongs in a different
// file — this one stays trivially testable and safe to import from anywhere.

export function normalize(text) {
  return (text || '').trim().toLowerCase();
}

// The English meaning is always stored init-capped ("good morning" ->
// "Good Morning") — every word's first letter capitalized, the rest
// lowercased, regardless of however it was typed.
export function toInitCap(text) {
  return (text || '').trim().replace(/\S+/g, word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

export function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function shuffle(array) {
  const copy = array.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Some stored words are "mojibake": Japanese/Telugu UTF-8 bytes that were once
// read as Windows-1252 and saved that way (e.g. さようなら stored as "ã•ã‚ˆãªã‚‰").
// This reverses it — each character back to its original byte, then the bytes
// decoded as UTF-8. Text that isn't mojibake (plain ASCII, real Japanese, or
// anything that doesn't decode to valid UTF-8) comes back unchanged.
const CP1252_BYTES = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86],
  [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95],
  [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

export function repairMojibake(text) {
  if (typeof text !== 'string' || !/[\u0080-￿]/.test(text)) return text;
  const bytes = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code < 0x100) bytes.push(code);
    else if (CP1252_BYTES.has(code)) bytes.push(CP1252_BYTES.get(code));
    else return text; // A character Windows-1252 can't produce: not mojibake
  }
  // A non-breaking space byte (0xA0) inside a character sometimes got saved as a
  // plain space; a space can never sit where a continuation byte belongs.
  for (let i = 0, expect = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (expect > 0) {
      if (b === 0x20) bytes[i] = 0xa0;
      expect--;
    } else if (b >= 0xf0) expect = 3;
    else if (b >= 0xe0) expect = 2;
    else if (b >= 0xc0) expect = 1;
  }
  try {
    return strictUtf8.decode(new Uint8Array(bytes));
  } catch (e) {
    return text;
  }
}
