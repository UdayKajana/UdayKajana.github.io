// Reading mode: a full-screen player that reads a section's words aloud (word, then meaning, each
// in its own matching voice), with play/pause and previous/next word. It keeps going with the
// screen off and shows its controls on the lock screen: an inaudible looping track (speech.js)
// makes the page a playing media app, and the Media Session API supplies the controls and the
// current word. Reading a top-level section also covers its subsections, and the toolbar's
// "read everything" covers every section, looping round when it reaches the end.
// Speech itself (voices, the speechSynthesis call) lives in speech.js.

import { state } from './state.js';
import { readingModal, readingWord, readingPronunciation, readingMeaning } from './dom.js';
import { shuffle } from './utils.js';
import { speak, normalizeSpeechText, toSpokenText, cleanSpeechText, startAudioKeepAlive, pauseAudioKeepAlive, stopAudioKeepAlive, keepAliveAudio } from './speech.js';
import { getSectionDisplayLabel, getSectionSpokenLabel, expandWithSubsections, getTopLevelSectionNames, ensureSectionLoaded } from './sections.js';

const GAP_MS = 2000; // Pause after each word's meaning
const readingSection = document.getElementById('reading-section');
const readingPosition = document.getElementById('reading-position');
const readingPlay = document.getElementById('reading-play');
const readingPrev = document.getElementById('reading-prev');
const readingNext = document.getElementById('reading-next');

// The play list grows a section at a time (a section's words are only fetched when reading gets
// there): items = [{ section, entry, number, total }], index = the word on screen.
const player = { queue: [], nextSection: 0, items: [], index: 0, playing: false, run: 0, announced: null, gapTimer: null };

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
  readingMeaning.textContent = item.entry.englishMeaning || '';
  readingPosition.textContent = `${item.number} / ${item.total}`;
  readingPrev.disabled = player.index === 0;
  updateMediaSession(item);
}

function renderPlayState() {
  readingPlay.dataset.state = player.playing ? 'playing' : 'paused';
  readingPlay.setAttribute('aria-label', player.playing ? 'Pause' : 'Play');
  readingPlay.title = player.playing ? 'Pause (Space)' : 'Play (Space)';
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = player.playing ? 'playing' : 'paused';
}

// The current word, then onward, until paused, moved or closed (each of which starts a new run)
async function playFromCurrent() {
  const run = ++player.run;
  const live = () => run === player.run && player.playing && state.readingActive;
  while (live()) {
    const item = await itemAt(player.index);
    if (!live()) return;
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
    const word = item.entry.pronunciation
      ? normalizeSpeechText(item.entry.pronunciation, 'ja')
      : await toSpokenText(item.entry.word, 'ja');
    await speak(cleanSpeechText(word, 'ja'), 'ja-JP', 0.9, 1);
    if (!live()) return;
    const meaning = cleanSpeechText(item.entry.englishMeaning, 'en');
    if (meaning) {
      await speak(meaning, 'en-US', 0.95, 1);
      if (!live()) return;
    }
    await new Promise(resolve => { player.gapTimer = setTimeout(resolve, GAP_MS); });
    if (!live()) return;
    player.index++;
  }
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
  if (!state.readingActive || player.playing) return;
  setPlaying(true);
  playFromCurrent();
}

export function pauseReading() {
  if (!player.playing) return;
  interrupt();
  setPlaying(false);
}

export function toggleReading() {
  if (player.playing) pauseReading();
  else playReading();
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
    artist: item.entry.englishMeaning || '',
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
  Object.assign(player, { queue: sections, nextSection: 0, items: [], index: 0, playing: false, announced: null });
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

readingPlay.addEventListener('click', toggleReading);
readingNext.addEventListener('click', nextWord);
readingPrev.addEventListener('click', previousWord);

// Laptop keys while the player is open: Space play/pause, ←/→ previous/next, Esc close.
// Caught before the page's own shortcuts (Space would otherwise open quick-add).
window.addEventListener('keydown', (event) => {
  if (!state.readingActive) return;
  const key = event.key;
  if (key === ' ' || key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (key === ' ') toggleReading();
    else if (key === 'ArrowLeft') previousWord();
    else if (key === 'ArrowRight') nextWord();
    else closeReadingModal();
  } else if (key === 'Shift') {
    event.stopImmediatePropagation(); // No Double Shift "new section" behind the player
  }
}, true);

