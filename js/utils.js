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
