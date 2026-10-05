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
  if (now.length) {
    // Log all available voices on first load
    if (!window.__voicesLogged) {
      window.__voicesLogged = true;
      console.log('[Speech] Available voices:');
      now.forEach((v, i) => console.log(`  ${i}: ${v.name} (${v.lang})`));
    }
    return Promise.resolve(now);
  }
  if (!voiceWait) {
    voiceWait = new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        window.speechSynthesis.removeEventListener('voiceschanged', done);
        const voices = window.speechSynthesis.getVoices();
        if (!window.__voicesLogged) {
          window.__voicesLogged = true;
          console.log('[Speech] Available voices:');
          voices.forEach((v, i) => console.log(`  ${i}: ${v.name} (${v.lang})`));
        }
        resolve(voices);
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

  let best;
  if (normalizedCode === 'en') {
    // Priority order: best natural-sounding voices first
    best = matching.find(voice => /samantha|daniel|moira|flo|rishi|sandy/i.test(voice.name))
      // Fallback: Google, Azure, Polly, Neural
      || matching.find(voice => /google|azure|polly|neural|enhanced/i.test(voice.name))
      // Avoid novelty/robotic voices but keep other quality ones
      || matching.find(voice => !voice.name.match(/bad news|bahh|bells|boing|bubbles|cellos|jester|junior|organ|superstar|trinoids|whisper|wobble|zarvox|default|system|no-audio/i))
      || matching[0]
      || voices.find(voice => voice.lang && voice.lang.toLowerCase().startsWith('en'))
      || voices[0]
      || null;
    console.log('[Speech] Selected English voice:', best?.name || 'none');
  } else {
    best = matching.find(voice => /google|neural|natural|enhanced|premium/i.test(voice.name))
      || matching[0]
      || voices.find(voice => voice.lang && voice.lang.toLowerCase().startsWith('en'))
      || voices[0]
      || null;
  }
  // Only remember a real pick; with no voices yet, look again next time
  if (voices.length) cachedVoicesByLang.set(languageCode, best);
  return best;
}

// Earphones: a phone sends a page's sound to Bluetooth or wired earphones only while that page is
// playing audio, and Bluetooth earphones fall asleep between sounds — so short readings came out
// nowhere (or were cut off) when earphones were connected before reading started. While reading,
// an inaudible tone keeps the audio route awake and on whatever output is connected.
// Must start from a click/tap (browsers only allow audio to start from one).
const KEEP_ALIVE_WARMUP_MS = 400;
let keepAlive = null;

export function startAudioKeepAlive() {
  if (keepAlive) return;
  // iOS: play like a media app (follows the connected output, ignores the silent switch)
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* not supported */ }
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  try {
    const ctx = new AudioCtx();
    const tone = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.0001; // far below hearing, but a real signal the phone keeps routed
    tone.connect(gain);
    gain.connect(ctx.destination);
    tone.start();
    if (ctx.state === 'suspended') ctx.resume();
    keepAlive = { ctx, tone, startedAt: Date.now() };
  } catch (e) {
    console.warn('[Speech] Could not start the audio keep-alive', e);
  }
}

export function stopAudioKeepAlive() {
  if (!keepAlive) return;
  try {
    keepAlive.tone.stop();
    keepAlive.ctx.close();
  } catch (e) { /* already closed */ }
  keepAlive = null;
}

// Chrome can garbage-collect an utterance mid-speech (and then never fires
// onend), so keep each one referenced until it finishes.
const activeUtterances = new Set();

export async function speak(text, languageCode = 'en-US', rate = 0.95, pitch = 1) {
  if (!text || !('speechSynthesis' in window)) return;
  const voice = await getBestVoice(languageCode);
  // Give earphones a moment to wake after the keep-alive starts, so the first word isn't lost
  const warmup = keepAlive ? KEEP_ALIVE_WARMUP_MS - (Date.now() - keepAlive.startedAt) : 0;
  if (warmup > 0) await new Promise(resolve => setTimeout(resolve, warmup));
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = languageCode;
    const isEnglish = languageCode.toLowerCase().startsWith('en');
    // Fast and clear English speech
    utterance.rate = isEnglish ? 0.85 : rate;
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
