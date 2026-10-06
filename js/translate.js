import { containsKanji } from './utils.js';

// Text transformation: machine translation, romaji<->kana conversion, and
// kana->romaji transliteration. Nothing here touches the DOM or Firebase —
// pure text in, text out (aside from the network calls to Google's
// translate endpoint). If you're fixing a wrong translation, romanization,
// or romaji/kana conversion, it's in this file.

// Google's free client-side translation endpoint — real machine
// translation (no API key), unlike MyMemory's crowd-sourced lookup
// which returns bad matches for short/casual words like "Hi".
export async function translateText(text, sourceLang, targetLang) {
  if (!text || sourceLang === targetLang) return '';
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetch(url);
    const data = await response.json();
    const segments = data && data[0];
    if (!Array.isArray(segments)) return '';
    return segments.map(segment => segment[0] || '').join('').trim();
  } catch (err) {
    console.error('Auto-translation failed', err);
    return '';
  }
}

export function transliterateJapaneseToRomaji(text) {
  if (!text) return '';

  const singleKanaMap = {
    'あ': 'a', 'い': 'i', 'う': 'u', 'え': 'e', 'お': 'o',
    'か': 'ka', 'き': 'ki', 'く': 'ku', 'け': 'ke', 'こ': 'ko',
    'さ': 'sa', 'し': 'shi', 'す': 'su', 'せ': 'se', 'そ': 'so',
    'た': 'ta', 'ち': 'chi', 'つ': 'tsu', 'て': 'te', 'と': 'to',
    'な': 'na', 'に': 'ni', 'ぬ': 'nu', 'ね': 'ne', 'の': 'no',
    'は': 'ha', 'ひ': 'hi', 'ふ': 'fu', 'へ': 'he', 'ほ': 'ho',
    'ま': 'ma', 'み': 'mi', 'む': 'mu', 'め': 'me', 'も': 'mo',
    'や': 'ya', 'ゆ': 'yu', 'よ': 'yo',
    'ら': 'ra', 'り': 'ri', 'る': 'ru', 'れ': 're', 'ろ': 'ro',
    'わ': 'wa', 'を': 'wo', 'ん': 'n',
    'が': 'ga', 'ぎ': 'gi', 'ぐ': 'gu', 'げ': 'ge', 'ご': 'go',
    'ざ': 'za', 'じ': 'ji', 'ず': 'zu', 'ぜ': 'ze', 'ぞ': 'zo',
    'だ': 'da', 'ぢ': 'ji', 'づ': 'zu', 'で': 'de', 'ど': 'do',
    'ば': 'ba', 'び': 'bi', 'ぶ': 'bu', 'べ': 'be', 'ぼ': 'bo',
    'ぱ': 'pa', 'ぴ': 'pi', 'ぷ': 'pu', 'ぺ': 'pe', 'ぽ': 'po',
    'ゃ': 'ya', 'ゅ': 'yu', 'ょ': 'yo', 'っ': 'tsu'
  };

  const comboKanaMap = {
    'きゃ': 'kya', 'きゅ': 'kyu', 'きょ': 'kyo',
    'しゃ': 'sha', 'しゅ': 'shu', 'しょ': 'sho',
    'ちゃ': 'cha', 'ちゅ': 'chu', 'ちょ': 'cho',
    'にゃ': 'nya', 'にゅ': 'nyu', 'にょ': 'nyo',
    'ひゃ': 'hya', 'ひゅ': 'hyu', 'ひょ': 'hyo',
    'みゃ': 'mya', 'みゅ': 'myu', 'みょ': 'myo',
    'りゃ': 'rya', 'りゅ': 'ryu', 'りょ': 'ryo',
    'ぎゃ': 'gya', 'ぎゅ': 'gyu', 'ぎょ': 'gyo',
    'じゃ': 'ja', 'じゅ': 'ju', 'じょ': 'jo',
    'びゃ': 'bya', 'びゅ': 'byu', 'びょ': 'byo',
    'ぴゃ': 'pya', 'ぴゅ': 'pyu', 'ぴょ': 'pyo',
    'だ': 'da'
  };

  // A plain vowel kana right after a syllable ending in the same vowel (or う
  // after an お-ending syllable) lengthens it — write that as a macron rather
  // than doubling the letter, e.g. どう -> "dō" not "dou".
  const plainVowelMap = {
    'あ': 'a', 'い': 'i', 'う': 'u', 'え': 'e', 'お': 'o',
    'ア': 'a', 'イ': 'i', 'ウ': 'u', 'エ': 'e', 'オ': 'o'
  };
  const macronMap = { a: 'ā', i: 'ī', u: 'ū', e: 'ē', o: 'ō' };

  const normalized = String(text)
    .replace(/\s+/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')');

  const syllables = [];
  let index = 0;

  while (index < normalized.length) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (!char) break;
    if (char === 'ー') {
      const previous = syllables[syllables.length - 1];
      const lastVowel = previous ? previous.slice(-1) : '';
      if (previous && macronMap[lastVowel]) {
        syllables[syllables.length - 1] = previous.slice(0, -1) + macronMap[lastVowel];
      }
      index += 1;
      continue;
    }

    if (char === 'っ') {
      const nextKana = next && (comboKanaMap[next] || singleKanaMap[next] || next);
      if (nextKana) {
        // Push just the doubling consonant — the next character's own syllable
        // (processed on the following loop iteration) supplies the second copy.
        syllables.push(nextKana[0]);
      }
      index += 1;
      continue;
    }

    if (plainVowelMap[char]) {
      const vowel = plainVowelMap[char];
      const previous = syllables[syllables.length - 1];
      const lastVowel = previous ? previous.slice(-1) : '';
      const isLongVowel = previous && (lastVowel === vowel || (vowel === 'u' && lastVowel === 'o'));
      if (isLongVowel) {
        syllables[syllables.length - 1] = previous.slice(0, -1) + macronMap[lastVowel];
        index += 1;
        continue;
      }
    }

    const katakana = char && char.charCodeAt(0) >= 0x30A0 && char.charCodeAt(0) <= 0x30FF;
    const hiragana = char && char.charCodeAt(0) >= 0x3040 && char.charCodeAt(0) <= 0x309F;

    if (katakana) {
      const hiraganaChar = String.fromCharCode(char.charCodeAt(0) - 0x60);
      const combo = comboKanaMap[hiraganaChar + (next || '')] || comboKanaMap[hiraganaChar];
      if (combo) {
        syllables.push(combo);
        index += 2;
        continue;
      }
      const single = singleKanaMap[hiraganaChar];
      if (single) {
        syllables.push(single);
        index += 1;
        continue;
      }
    }

    if (hiragana) {
      const combo = comboKanaMap[char + (next || '')] || comboKanaMap[char];
      if (combo) {
        syllables.push(combo);
        index += 2;
        continue;
      }
      const single = singleKanaMap[char];
      if (single) {
        syllables.push(single);
        index += 1;
        continue;
      }
    }

    if (/[a-zA-Z]/.test(char)) {
      syllables.push(char.toLowerCase());
    }
    index += 1;
  }

  return syllables.join('');
}

export async function getRomanization(text, sourceLang, targetLang) {
  if (!text || sourceLang === 'en') return '';
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&dt=rm&q=${encodeURIComponent(text)}`;
    const response = await fetch(url);
    const data = await response.json();
    const segments = data && data[0];
    if (!Array.isArray(segments)) return '';
    // Romanization is appended as an extra segment shaped like [null, null, ...romanizedText].
    const romanEntry = segments.find(segment => segment[0] === null && segment[1] === null);
    if (!romanEntry) return '';
    const romanized = romanEntry.slice(2).find(value => typeof value === 'string' && value.trim());
    return romanized || '';
  } catch (err) {
    console.error('Romanization failed', err);
    return '';
  }
}

// Romanizes a native word for languages other than Japanese (which has its
// own internal transliterator, tried first, for speed and to avoid a round
// trip when there's no kanji involved).
export async function romanizeNativeWord(text, nativeLang) {
  if (nativeLang === 'en' || !text) return '';
  if (nativeLang === 'ja') {
    if (!containsKanji(text)) {
      const internal = transliterateJapaneseToRomaji(text);
      if (internal) return internal;
    }
  }
  return getRomanization(text, nativeLang, 'en');
}

// Converts romaji text to hiragana via wanakana (the same battle-tested
// library the app already loads) — deterministic, no network round-trip,
// and correctly handles sokuon (small tsu / doubled consonants: "gakkou"
// -> "がっこう"), long vowels ("koukou" -> "こうこう"), combo kana
// ("kya"/"sho"/etc.), and both "n"-before-a-vowel conventions ("kin'en"
// and "kinen" alike). It can only ever produce hiragana/katakana, never
// kanji — kanji selection isn't derivable from sound alone, it requires
// an actual dictionary/translation (see resolveQuickAddFields in quick-add.js).
//
// Confirmed against real output (not just documentation) before shipping:
// wanakana leaves traditional-Hepburn "m" (used before b/p/m instead of
// "n" — "tempura", "sempai", "shimbun", "gambaru") completely unconverted
// as a literal ASCII "m", which silently corrupts very common words.
// That's unlike, say, "konnichiwa" -> こんにちわ (not こんにちは) — a
// real but inherent ambiguity of phonetic conversion, since the topic
// marker は is pronounced "wa" but there's no way to tell "you meant the
// grammatical particle" from sound alone. The "m"-before-labial case has
// no such ambiguity (it always means ん), so it's corrected here rather
// than left as a rough edge — every other combination wanakana already
// gets right on its own.
export function convertRomajiToHiragana(text) {
  const raw = (text || '').trim();
  if (!raw) return '';
  if (typeof wanakana === 'undefined') {
    console.error('wanakana failed to load — using the raw romaji text as-is');
    return raw;
  }
  const normalized = raw.replace(/m(?=[bpm])/gi, 'n');
  return wanakana.toHiragana(normalized, { IMEMode: false });
}

// The reverse direction — used to derive a canonical romaji pronunciation
// from the (already-converted) word, since the quick-add word stage's input
// is live-bound to wanakana (see updateQuickAddImeBinding in quick-add.js):
// by the time Enter is pressed there, the box already shows kana, not the
// original romaji keystrokes, so there's nothing left to "preserve as
// typed" there anymore — this instead gives back a clean,
// consistently-spelled romaji reading no matter how it was originally
// typed (e.g. "kekkonn" or "kekkon" both land on the same けっこん ->
// "kekkon").
export function convertKanaToRomaji(text) {
  const raw = (text || '').trim();
  if (!raw) return '';
  if (typeof wanakana === 'undefined') return raw;
  return wanakana.toRomaji(raw);
}
