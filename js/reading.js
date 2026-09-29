// Reading mode: the modal, one shuffled spoken pass through a section's
// words (word then meaning, each in its own matching voice), and the
// indefinite section-by-section cycling for both a single section's read
// and the toolbar's all-sections read. Speech itself (voice selection,
// the actual speechSynthesis call) lives in speech.js; this file is the
// playback loop built on top of it.

import { state } from './state.js';
import { readingModal, readingWord, readingPronunciation, readingMeaning } from './dom.js';
import { shuffle } from './utils.js';
import { speak, normalizeSpeechText, toSpokenText } from './speech.js';
import { getSectionDisplayLabel, getSectionSpokenLabel, expandWithSubsections, getTopLevelSectionNames, ensureSectionLoaded } from './sections.js';

export function renderReadingCard(entry) {
  readingWord.textContent = entry.word || '—';
  if (entry.pronunciation) {
    readingPronunciation.textContent = entry.pronunciation;
    readingPronunciation.classList.remove('hidden');
  } else {
    readingPronunciation.textContent = '';
    readingPronunciation.classList.add('hidden');
  }
  readingMeaning.textContent = entry.englishMeaning || 'No meaning available';
}

// Announces a new section as reading moves into it — shown on screen and,
// since reading is a spoken-first interface, also spoken aloud in English
// (section names are always plain English/Latin text, regardless of which
// language's words are inside). A subsection is spoken by its own name
// alone — repeating the full "PARENT → CHILD" path aloud every time reads
// awkwardly once you're already mid-pass through that parent.
export async function announceReadingSection(section) {
  readingWord.textContent = getSectionDisplayLabel(section);
  readingPronunciation.classList.add('hidden');
  readingMeaning.textContent = 'Section';
  await speak(getSectionSpokenLabel(section), 'en-US', 0.95, 1);
}

// Reusable core: one shuffled pass through a single section's words, each
// spoken in full (word, then meanings). Resolves once every word in the
// pass has been read, or immediately if reading is stopped mid-pass.
export async function runSectionReadingPass(entries) {
  const queue = shuffle(entries);
  for (const entry of queue) {
    if (!state.readingActive) return;
    renderReadingCard(entry);

    // Each piece is spoken with the voice that actually matches its language —
    // reading the English meaning in a Japanese voice mispronounces it.
    const spokenWord = entry.pronunciation
      ? normalizeSpeechText(entry.pronunciation, 'ja')
      : await toSpokenText(entry.word, 'ja');

    await speak(spokenWord, 'ja-JP', 0.9, 1);
    if (!state.readingActive) return;

    if (entry.englishMeaning) {
      await speak(entry.englishMeaning, 'en-US', 0.95, 1);
      if (!state.readingActive) return;
    }

    await new Promise(resolve => {
      state.readingTimeoutId = setTimeout(resolve, 2000);
    });
  }
}

export function openReadingModal() {
  readingModal.classList.add('open');
  readingWord.textContent = 'Read';
  readingPronunciation.classList.add('hidden');
  readingMeaning.textContent = 'Reading mode starting…';
  state.readingActive = true;
}

export function closeReadingModal() {
  readingModal.classList.remove('open');
  state.readingActive = false;
  if (state.readingTimeoutId) {
    clearTimeout(state.readingTimeoutId);
    state.readingTimeoutId = null;
  }
  window.speechSynthesis.cancel();
  state.readingSectionQueue = [];
  state.readingSectionIndex = -1;
}

// Cycles indefinitely through a queue of sections (looping back to the
// start), announcing each one by name only when it actually changes from
// the last one read — so a single-section queue announces once and just
// keeps repeating, while a multi-section queue (e.g. a parent followed by
// its subsections) announces every time it moves to a different one. If a
// full lap turns up no words anywhere, it stops instead of spinning
// silently forever.
export async function runReadingSectionQueue(queue) {
  if (!queue.length) {
    readingMeaning.textContent = 'No sections to read yet.';
    return;
  }
  state.readingSectionQueue = queue;
  state.readingSectionIndex = 0;
  let lastAnnounced = null;
  let consecutiveEmpty = 0;

  while (state.readingActive) {
    const section = state.readingSectionQueue[state.readingSectionIndex];
    readingMeaning.textContent = `Loading ${getSectionDisplayLabel(section)}…`;
    const entries = await ensureSectionLoaded(section);
    if (!state.readingActive) break;

    if (entries.length) {
      consecutiveEmpty = 0;
      if (section !== lastAnnounced) {
        await announceReadingSection(section);
        lastAnnounced = section;
        if (!state.readingActive) break;
      }
      await runSectionReadingPass(entries);
    } else {
      consecutiveEmpty++;
      if (consecutiveEmpty >= state.readingSectionQueue.length) {
        readingMeaning.textContent = `${getSectionDisplayLabel(queue[0])} has no words yet.`;
        return;
      }
    }

    if (!state.readingActive) break;
    state.readingSectionIndex = (state.readingSectionIndex + 1) % state.readingSectionQueue.length;
  }
}

// Section-level Read button — also covers this section's subsections
// (announced/tracked as their own queue entries) — a subsection read
// directly just expands to itself, since it has none of its own.
export async function startSectionReading(section) {
  openReadingModal();
  await runReadingSectionQueue(expandWithSubsections([section]));
}

// Toolbar Read button: cycles through every section (and its subsections)
// in turn, indefinitely — the next one's words are only fetched once the
// current one's pass is fully done.
export async function startAppLevelReading() {
  openReadingModal();
  await runReadingSectionQueue(expandWithSubsections(getTopLevelSectionNames()));
}
