// Text-to-speech for reading mode (see reading.js, its only consumer):
// picking a voice, normalizing text so it reads naturally, and the actual
// speechSynthesis call. If reading mode mispronounces something or picks a
// bad voice, it's in this file.

import { getRomanization } from './translate.js';

let cachedVoicesByLang = new Map();

export function normalizeSpeechText(text, language) {
  if (!text) return '';
  const normalized = String(text).trim().replace(/\s+/g, ' ');
  if (language === 'ja') {
    return normalized.replace(/[。！？]/g, '.').replace(/-/g, ' ').replace(/_/g, ' ');
  }
  if (language === 'te') {
    return normalized.replace(/-/g, ' ').replace(/_/g, ' ');
  }
  return normalized;
}

export function getBestVoice(languageCode) {
  if (cachedVoicesByLang.has(languageCode)) {
    return Promise.resolve(cachedVoicesByLang.get(languageCode));
  }

  return new Promise((resolve) => {
    const pick = (voices) => {
      const normalizedCode = languageCode.toLowerCase();
      const matching = voices.filter(voice => voice.lang && voice.lang.toLowerCase().startsWith(normalizedCode));
      const best = matching.find(voice => /google|natural|enhanced|premium|neural|wave/i.test(voice.name))
        || matching[0]
        || voices.find(voice => voice.lang && voice.lang.toLowerCase().startsWith('en'))
        || voices[0]
        || null;
      cachedVoicesByLang.set(languageCode, best);
      resolve(best);
    };

    const voices = window.speechSynthesis.getVoices();
    if (voices.length) {
      pick(voices);
      return;
    }

    window.speechSynthesis.onvoiceschanged = () => pick(window.speechSynthesis.getVoices());
  });
}

export async function speak(text, languageCode = 'en-US', rate = 0.95, pitch = 1) {
  if (!text || !('speechSynthesis' in window)) return;
  const voice = await getBestVoice(languageCode);
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = languageCode;
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.volume = 1;
    if (voice) utterance.voice = voice;
    utterance.onend = resolve;
    utterance.onerror = resolve;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}

export async function toSpokenText(text, sourceLang) {
  if (!text) return '';
  if (sourceLang === 'en') return text;

  const normalized = String(text).trim();
  if (sourceLang === 'ja') {
    return normalizeSpeechText(normalized, 'ja');
  }
  if (sourceLang === 'te') {
    return normalizeSpeechText(normalized, 'te');
  }

  const romanized = await getRomanization(text, sourceLang, 'en');
  return romanized || normalized;
}
