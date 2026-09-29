// The hiragana/katakana practice modal — just an iframe loader for
// hiragana-karuta.html, parameterized by which script is being practiced.

import { scriptPracticeTitle, scriptPracticeFrame, scriptPracticeModal } from './dom.js';

export function openScriptPracticeModal(scriptKey, label) {
  scriptPracticeTitle.textContent = `${label} Practice`;
  scriptPracticeFrame.src = `hiragana-karuta.html?script=${encodeURIComponent(scriptKey)}`;
  scriptPracticeModal.classList.add('open');
}

export function closeScriptPracticeModal() {
  scriptPracticeModal.classList.remove('open');
  scriptPracticeFrame.src = 'about:blank';
}
