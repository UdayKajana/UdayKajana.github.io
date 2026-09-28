// Quiz mode: the modal, the correct/wrong round loop, WarOnWrong retries
// (missed words repeat until a clean pass), and the section-by-section
// sequencing for both a single section's quiz and the toolbar's
// all-sections quiz. If you're changing quiz behavior, it's in this file.

import { state } from './state.js';
import {
  quizModal, quizStatus, quizWord, quizPronunciation, quizMeaning,
  quizStart, quizActions, quizTogglePronunciation, quizToggleMeaning
} from './dom.js';
import { getSectionDisplayLabel, expandWithSubsections, getTopLevelSectionNames, ensureSectionLoaded } from './sections.js';

export function openQuizModal() {
  quizModal.classList.add('open');
  quizStatus.textContent = 'Quiz paused';
  quizWord.textContent = 'Ready?';
  quizPronunciation.textContent = '';
  quizPronunciation.classList.add('hidden');
  quizMeaning.textContent = 'Click start to begin.';
  state.quizQueue = [];
  state.quizMissed = [];
  state.quizCurrent = null;
  state.quizTotal = 0;
  state.quizMode = 'idle';
  state.warOnWrongSet = null;
  quizStart.textContent = 'Start quiz';
  quizStart.disabled = false;
  quizActions.classList.remove('flex');
  quizActions.classList.add('hidden');
}

export function closeQuizModal() {
  quizModal.classList.remove('open');
  // Let any sequencer awaiting the current round unwind cleanly instead of
  // hanging forever on a promise nobody will ever resolve.
  const resolve = state.quizRoundResolve;
  state.quizRoundResolve = null;
  state.quizSectionQueue = [];
  state.quizSectionIndex = -1;
  state.quizCurrentSection = null;
  if (resolve) resolve();
}

export function renderQuizCard() {
  const entry = state.quizCurrent;
  quizWord.textContent = entry ? (entry.word || '—') : '—';

  if (entry && quizTogglePronunciation.checked && entry.pronunciation) {
    quizPronunciation.textContent = entry.pronunciation;
    quizPronunciation.classList.remove('hidden');
  } else {
    quizPronunciation.textContent = '';
    quizPronunciation.classList.add('hidden');
  }

  if (entry && quizToggleMeaning.checked) {
    quizMeaning.textContent = entry.englishMeaning || 'No meaning available';
  } else {
    quizMeaning.textContent = '';
  }
}

export function beginRound(queue) {
  state.quizQueue = queue;
  state.quizMissed = [];
  state.quizTotal = queue.length;
  quizStart.textContent = 'Running...';
  quizStart.disabled = true;
  quizActions.classList.remove('hidden');
  quizActions.classList.add('flex');
  showNextQuizWord();
}

export function showNextQuizWord() {
  const section = getSectionDisplayLabel(state.quizCurrentSection || 'UNCATEGORIZED');
  if (!state.quizQueue.length) {
    endRound();
    return;
  }
  state.quizCurrent = state.quizQueue.shift();
  renderQuizCard();
  quizStatus.textContent = `${section} — Question ${state.quizTotal - state.quizQueue.length}/${state.quizTotal}`;
}

export function advanceQuiz() {
  state.quizCurrent = null;
  showNextQuizWord();
}

export function handleCorrect() {
  if (!state.quizCurrent) return;
  advanceQuiz();
}

export function handleWrong() {
  if (!state.quizCurrent) return;
  state.quizMissed.push(state.quizCurrent);
  advanceQuiz();
}

export function endRound() {
  quizActions.classList.remove('flex');
  quizActions.classList.add('hidden');
  quizPronunciation.classList.add('hidden');
  const section = getSectionDisplayLabel(state.quizCurrentSection || 'UNCATEGORIZED');

  if (!state.quizMissed.length) {
    quizStatus.textContent = state.quizMode === 'warOnWrong'
      ? `${section} — WarOnWrong cleared!`
      : `${section} — Quiz complete! No missed words.`;
    quizWord.textContent = 'Done!';
    quizMeaning.textContent = '';
    quizStart.textContent = 'Restart';
    quizStart.disabled = false;
    state.quizMode = 'idle';
    state.warOnWrongSet = null;

    // Resolve this section's round — this is what lets the app-level
    // sequencer move on to the next section only once this one is clear.
    const resolve = state.quizRoundResolve;
    state.quizRoundResolve = null;
    if (resolve) resolve();
    return;
  }

  if (state.quizMode === 'normal') {
    state.warOnWrongSet = state.quizMissed.slice();
    state.quizMode = 'warOnWrong';
  }

  // Do-or-die: every WarOnWrong attempt restarts from the same missed set
  // captured when we first entered it — a single miss resets the whole pass.
  const retryQueue = state.warOnWrongSet.map(entry => ({ ...entry }));
  quizStatus.textContent = `${section} — WarOnWrong: ${retryQueue.length} word(s) — get them all right to finish`;
  beginRound(retryQueue);
}

// Reusable core: quizzes a single section (with WarOnWrong retries) to
// completion. Used both by the section-level Quiz button and as one step
// of the app-level sequential quiz below.
export function runSectionQuiz(section, entries) {
  return new Promise((resolve) => {
    state.quizCurrentSection = section;
    state.quizRoundResolve = resolve;
    state.quizMode = 'normal';
    state.warOnWrongSet = null;
    beginRound(entries.map(entry => ({ ...entry })));
  });
}

// Quizzing a section also covers its subsections (announced/tracked as
// their own queue entries) — a subsection quizzed directly just expands
// to itself, since it has none of its own.
export async function startSectionQuiz(section) {
  openQuizModal();
  state.quizSectionQueue = expandWithSubsections([section]);
  state.quizSectionIndex = 0;
  await runQuizSectionQueue();
}

export async function startAppLevelQuiz() {
  openQuizModal();
  const sections = getTopLevelSectionNames();
  if (!sections.length) {
    quizStatus.textContent = 'No sections to quiz yet.';
    return;
  }
  state.quizSectionQueue = expandWithSubsections(sections);
  state.quizSectionIndex = 0;
  await runQuizSectionQueue();
}

// Sequences through state.quizSectionQueue one section at a time — the next
// section is only fetched once the current one's round is fully cleared.
export async function runQuizSectionQueue() {
  for (; state.quizSectionIndex < state.quizSectionQueue.length; state.quizSectionIndex++) {
    if (!quizModal.classList.contains('open')) return;
    const section = state.quizSectionQueue[state.quizSectionIndex];
    quizStatus.textContent = `Loading ${getSectionDisplayLabel(section)}…`;
    const entries = await ensureSectionLoaded(section);
    if (!quizModal.classList.contains('open')) return;
    if (!entries.length) continue; // nothing to quiz in this section, skip it
    await runSectionQuiz(section, entries);
    if (!quizModal.classList.contains('open')) return;
  }
  quizStatus.textContent = 'All sections complete!';
  quizWord.textContent = 'Done!';
  quizMeaning.textContent = '';
  quizStart.textContent = 'Restart';
  quizStart.disabled = false;
}

// The quiz-modal "Start quiz"/"Restart" button re-runs whichever section
// queue is currently loaded (a single section, or the full app-level list),
// starting again from the top.
export function restartQuizSequence() {
  if (!state.quizSectionQueue.length) return;
  state.quizSectionIndex = 0;
  runQuizSectionQueue();
}
