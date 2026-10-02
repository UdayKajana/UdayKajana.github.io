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

// Voices often load asynchronously, and some browsers (many laptops' Chrome/Edge
// without a matching voice pack, Firefox without speech-dispatcher) never fire
// voiceschanged at all — so wait for them, but only briefly, and never forever.
const VOICE_WAIT_MS = 1500;
let voiceWait = null;

function waitForVoices() {
  const now = window.speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  if (!voiceWait) {
    voiceWait = new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        window.speechSynthesis.removeEventListener('voiceschanged', done);
        resolve(window.speechSynthesis.getVoices());
      };
      const timer = setTimeout(done, VOICE_WAIT_MS);
      window.speechSynthesis.addEventListener('voiceschanged', done);
    });
  }
  return voiceWait;
}

export async function getBestVoice(languageCode) {
  if (cachedVoicesByLang.has(languageCode)) return cachedVoicesByLang.get(languageCode);
  const voices = await waitForVoices();
  const normalizedCode = languageCode.toLowerCase();
  const matching = voices.filter(voice => voice.lang && voice.lang.toLowerCase().startsWith(normalizedCode));
  const best = matching.find(voice => /google|natural|enhanced|premium|neural|wave/i.test(voice.name))
    || matching[0]
    || voices.find(voice => voice.lang && voice.lang.toLowerCase().startsWith('en'))
    || voices[0]
    || null;
  // Only remember a real pick; with no voices yet, look again next time
  if (voices.length) cachedVoicesByLang.set(languageCode, best);
  return best;
}

// Chrome can garbage-collect an utterance mid-speech (and then never fires
// onend), so keep each one referenced until it finishes.
const activeUtterances = new Set();

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

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(watchdog);
      activeUtterances.delete(utterance);
      resolve();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    // If the browser never reports the end (dropped utterance, no usable voice),
    // carry on anyway so reading never freezes on one line
    // (generous: real speech runs well under 180ms per character)
    const watchdog = setTimeout(finish, 2000 + (String(text).length * 180) / rate);
    activeUtterances.add(utterance);

    // Cancelling right before speaking makes Chrome drop the new utterance, so
    // only cancel when something is actually still queued or speaking
    const synth = window.speechSynthesis;
    if (synth.speaking || synth.pending) synth.cancel();
    if (synth.paused) synth.resume();
    synth.speak(utterance);
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
