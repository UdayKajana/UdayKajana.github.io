// Reading mode: a full-screen player that reads a section's words aloud (word, then meaning, each
// in its own matching voice), with automatic or manual traversal. It keeps going with the screen
// off and shows its controls on the lock screen: an inaudible looping track (speech.js) makes the
// page a playing media app, and the Media Session API supplies the controls and current word.
// Reading a top-level section also covers its subsections, and the toolbar's "read everything"
// covers every section, looping round when it reaches the end.
// Speech itself (voices, the speechSynthesis call) lives in speech.js.

import { state } from './state.js';
import { readingModal, readingWord, readingPronunciation, readingMeaning } from './dom.js';
import { shuffle } from './utils.js';
import { speak, normalizeSpeechText, toSpokenText, cleanSpeechText, startAudioKeepAlive, pauseAudioKeepAlive, stopAudioKeepAlive, keepAliveAudio } from './speech.js';
import { getSectionDisplayLabel, getSectionSpokenLabel, expandWithSubsections, getTopLevelSectionNames, ensureSectionLoaded } from './sections.js';

const GAP_MS = 2000; // Pause after each word's meaning
const readingSection = document.getElementById('reading-section');
const readingPosition = document.getElementById('reading-position');
const readingPrev = document.getElementById('reading-prev');
const readingNext = document.getElementById('reading-next');
const readingControl = document.getElementById('reading-control');
const readingManualMode = document.getElementById('reading-manual-mode');
const readingControlIcons = {
  play: readingControl.querySelector('.icon-play'),
  pause: readingControl.querySelector('.icon-pause'),
  speaker: readingControl.querySelector('.icon-speaker'),
};

// The play list grows a section at a time (a section's words are only fetched when reading gets
// there): items = [{ section, entry, number, total }], index = the word on screen.
const player = { queue: [], nextSection: 0, items: [], index: 0, playing: false, manualMode: false, run: 0, announced: null, gapTimer: null };

async function loadNextSection() {
  for (let tries = 0; tries < player.queue.length; tries++) {
    const section = player.queue[player.nextSection % player.queue.length];
    player.nextSection++;
    const entries = await ensureSectionLoaded(section);
    if (entries.length) {
      shuffle(entries).forEach((entry, i, all) => player.items.push({ section, entry, number: i + 1, total: all.length }));
      return true;
    }
  }
  return false; // A full round of sections without a single word
}

async function itemAt(index) {
  while (index >= player.items.length) {
    if (!(await loadNextSection())) return null;
  }
  return player.items[index] || null;
}

function render(item) {
  readingSection.textContent = getSectionDisplayLabel(item.section);
  readingWord.textContent = item.entry.word || '—';
  readingPronunciation.textContent = item.entry.pronunciation && item.entry.pronunciation !== item.entry.word ? item.entry.pronunciation : '';
  readingMeaning.textContent = player.manualMode ? '' : (item.entry.englishMeaning || '');
  readingPosition.textContent = `${item.number} / ${item.total}`;
  readingPrev.disabled = player.index === 0;
  updateMediaSession(item);
}

function renderPlayState() {
  const mode = player.manualMode ? 'speaker' : (player.playing ? 'pause' : 'play');
  Object.entries(readingControlIcons).forEach(([name, icon]) => {
    icon.classList.toggle('hidden', name !== mode);
  });
  const label = mode === 'speaker'
    ? 'Speak pronunciation and meaning'
    : mode === 'pause' ? 'Pause reading' : 'Resume reading';
  readingControl.setAttribute('aria-label', label);
  readingControl.title = `${label} (Space)`;
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = player.playing ? 'playing' : 'paused';
}

// The current word, then onward, until manual mode, movement or close starts a new run.
async function playFromCurrent() {
  const run = ++player.run;
  const live = () => run === player.run && player.playing && state.readingActive;
  while (live()) {
    const index = player.index;
    const item = await itemAt(index);
    if (!live()) {
      if (item && state.readingActive && player.manualMode && player.index === index) render(item);
      return;
    }
    if (!item) {
      readingWord.textContent = 'No words yet';
      readingMeaning.textContent = '';
      setPlaying(false);
      return;
    }
    render(item);
    if (item.section !== player.announced) {      // Say a section's name as reading enters it
      player.announced = item.section;
      await speak(getSectionSpokenLabel(item.section), 'en-US', 0.95, 1);
      if (!live()) return;
    }
    await speakPronunciation(item);
    if (!live()) return;
    const meaning = player.manualMode ? '' : cleanSpeechText(item.entry.englishMeaning, 'en');
    if (meaning) {
      await speak(meaning, 'en-US', 0.95, 1);
      if (!live()) return;
    }
    await new Promise(resolve => { player.gapTimer = setTimeout(resolve, GAP_MS); });
    if (!live()) return;
    player.index++;
  }
}

async function speakPronunciation(item) {
  const pronunciation = item.entry.pronunciation
    ? normalizeSpeechText(item.entry.pronunciation, 'ja')
    : await toSpokenText(item.entry.word, 'ja');
  await speak(cleanSpeechText(pronunciation, 'ja'), 'ja-JP', 0.9, 1);
}

// Stops whatever is being said or waited on (the running loop then notices and ends)
function interrupt() {
  player.run++;
  clearTimeout(player.gapTimer);
  window.speechSynthesis.cancel();
}

function setPlaying(playing) {
  player.playing = playing;
  if (playing) {
    const audio = startAudioKeepAlive();
    // If the system pauses it (earphones unplugged, a call), pause reading too
    if (audio && !audio.watchedByReading) {
      audio.watchedByReading = true;
      audio.addEventListener('pause', () => { if (player.playing && audio === keepAliveAudio()) pauseReading(); });
    }
  } else {
    pauseAudioKeepAlive();
  }
  renderPlayState();
}

export function playReading() {
  if (!state.readingActive || player.playing || player.manualMode) return;
  setPlaying(true);
  playFromCurrent();
}

export function pauseReading() {
  if (!player.playing) return;
  interrupt();
  setPlaying(false);
}

function activateReadingControl() {
  if (player.manualMode) {
    speakCurrentWord();
  } else if (player.playing) {
    pauseReading();
  } else {
    playReading();
  }
}

async function speakCurrentWord() {
  if (!state.readingActive) return;
  interrupt();
  const run = player.run;
  const isCurrentRun = () => run === player.run && state.readingActive;
  const item = await itemAt(player.index);
  if (!item || !isCurrentRun()) return;
  render(item);
  await speakPronunciation(item);
  if (!isCurrentRun()) return;
  const meaning = cleanSpeechText(item.entry.englishMeaning, 'en');
  if (meaning) await speak(meaning, 'en-US', 0.95, 1);
}

function setManualMode(manualMode) {
  player.manualMode = manualMode;
  interrupt();
  if (manualMode) {
    setPlaying(false);
    const item = player.items[player.index];
    if (item) render(item);
  } else if (state.readingActive) {
    playReading();
  }
  renderPlayState();
}

async function moveTo(index) {
  if (!state.readingActive || index < 0) return;
  interrupt();
  const item = await itemAt(index);
  if (!item) return;
  player.index = index;
  render(item);
  if (player.playing) playFromCurrent();
}

export function nextWord() { moveTo(player.index + 1); }
export function previousWord() { moveTo(player.index - 1); }

// Lock screen / notification / headphone buttons
function updateMediaSession(item) {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  const reading = item.entry.pronunciation && item.entry.pronunciation !== item.entry.word ? ` (${item.entry.pronunciation})` : '';
  navigator.mediaSession.metadata = new MediaMetadata({
    title: `${item.entry.word || ''}${reading}`,
    artist: player.manualMode ? '' : (item.entry.englishMeaning || ''),
    album: getSectionDisplayLabel(item.section),
  });
}

function setMediaHandlers(on) {
  if (!('mediaSession' in navigator)) return;
  const handlers = { play: playReading, pause: pauseReading, nexttrack: nextWord, previoustrack: previousWord, stop: closeReadingModal };
  Object.entries(handlers).forEach(([action, handler]) => {
    try { navigator.mediaSession.setActionHandler(action, on ? handler : null); } catch (e) { /* action not supported */ }
  });
  if (!on) navigator.mediaSession.metadata = null;
}

// The page sits inside the Notes page: it takes the whole screen there while reading
function setFullScreen(on) {
  try {
    if (window.parent !== window) window.parent.document.documentElement.classList.toggle('reading-fullscreen', on);
  } catch (e) { /* not same-origin */ }
}

async function openPlayer(sections) {
  if (state.readingActive) closeReadingModal();
  readingManualMode.checked = false;
  Object.assign(player, { queue: sections, nextSection: 0, items: [], index: 0, playing: false, manualMode: false, announced: null });
  state.readingActive = true;
  readingModal.classList.add('open');
  setFullScreen(true);
  readingSection.textContent = '';
  readingWord.textContent = 'Read';
  readingPronunciation.textContent = '';
  readingMeaning.textContent = sections.length ? 'Starting…' : 'No sections to read yet.';
  readingPosition.textContent = '';
  setMediaHandlers(true);
  if (!sections.length) return renderPlayState();
  setPlaying(true); // Opened by a click/tap, so sound may start now
  playFromCurrent();
}

export function closeReadingModal() {
  interrupt();
  player.playing = false;
  state.readingActive = false;
  readingModal.classList.remove('open');
  setFullScreen(false);
  setMediaHandlers(false);
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
  stopAudioKeepAlive();
}

// Section Read button — also covers this section's subsections
export function startSectionReading(section) {
  return openPlayer(expandWithSubsections([section]));
}

// Toolbar Read button: every section (and its subsections) in turn, looping
export function startAppLevelReading() {
  return openPlayer(expandWithSubsections(getTopLevelSectionNames()));
}

readingControl.addEventListener('click', activateReadingControl);
readingNext.addEventListener('click', nextWord);
readingPrev.addEventListener('click', previousWord);
readingManualMode.addEventListener('change', () => setManualMode(readingManualMode.checked));

// Laptop keys while the player is open: Space speaks the current word, ←/→ previous/next, Esc close.
// Caught before the page's own shortcuts (Space would otherwise open quick-add).
window.addEventListener('keydown', (event) => {
  if (!state.readingActive) return;
  const key = event.key;
  if (key === ' ' || key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (key === ' ') activateReadingControl();
    else if (key === 'ArrowLeft') previousWord();
    else if (key === 'ArrowRight') nextWord();
    else closeReadingModal();
  } else if (key === 'Shift') {
    event.stopImmediatePropagation(); // No Double Shift "new section" behind the player
  }
}, true);
