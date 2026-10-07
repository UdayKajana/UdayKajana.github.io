// Section notes: one rich-text note per section (or subsection) for longer
// details — explanations, grammar, examples — shown at the top of the section
// when it's open. Edited with Quill (the same editor the Notes pages use) in a
// modal, because the section list re-renders on every live update and would
// wipe an inline editor mid-edit. Stored at languages/japan/sectionNotes/
// {language}/{SECTION} as { html, updatedAt, updatedBy }.

import { state } from './state.js';
import { japanRef, updateJapanData } from './firebase-init.js';
import { deviceCache } from './device-cache.js';
import { escapeHtml } from './utils.js';
import { getSectionDisplayLabel, loadAndRenderSectionBody } from './sections.js';

const NOTE_DOUBLE_TAP_MS = 300;
const QUILL_TOOLBAR = [
  [{ header: [1, 2, 3, false] }],
  ['bold', 'italic', 'underline', 'strike'],
  [{ color: [] }, { background: [] }],
  [{ list: 'ordered' }, { list: 'bullet' }, { indent: '-1' }, { indent: '+1' }],
  ['blockquote', 'code-block', 'link'],
  ['clean'],
];

const noteRef = (section) => japanRef.child(`sectionNotes/${state.language}/${section}`);
const noteCacheScope = () => `language:${state.currentUser ? state.currentUser.uid : 'anonymous'}:${state.language}`;

// Quill's "empty" document — saving it means there is no note
const isEmptyNote = (html) => !html || !html.replace(/<p><br><\/p>|<br>|\s|&nbsp;/g, '');

export function loadSectionNote(section) {
  if (state.sectionNotes.has(section)) return Promise.resolve(state.sectionNotes.get(section));
  const cacheKey = `note:${section}`;
  return deviceCache.get(noteCacheScope(), cacheKey).then(cached => {
    if (cached.ok && cached.found) {
      const html = cached.value || '';
      state.sectionNotes.set(section, html);
      if (!navigator.onLine) return html;
    }
    return noteRef(section).once('value').then(async (snapshot) => {
      const value = snapshot.val();
      const html = (value && value.html) || '';
      state.sectionNotes.set(section, html);
      const stored = await deviceCache.set(noteCacheScope(), cacheKey, html);
      if (!stored.ok) console.warn('Could not cache section note locally.', stored.error);
      return html;
    });
  }).catch(async (err) => {
    console.error('Failed to load section note from Firebase', err);
    const cached = await deviceCache.get(noteCacheScope(), cacheKey);
    if (cached.ok && cached.found) {
      state.sectionNotes.set(section, cached.value || '');
      return cached.value || '';
    }
    return '';
  });
}

// Puts the section's note (if it has one) at the top of its open body. Admins add
// or edit it with the note button on the heading line (see buildSectionDetailsShell). Called from renderSectionBodyIfPresent on every render.
export function renderSectionNoteInto(body, section) {
  const holder = document.createElement('div');
  holder.className = 'section-note-holder';
  body.prepend(holder);

  const fill = (html) => {
    holder.innerHTML = '';
    if (!isEmptyNote(html)) {
      const note = document.createElement('div');
      note.className = 'section-note ql-snow';
      note.innerHTML = `<div class="ql-editor">${html}</div>`;
      if (state.isAdmin) {
        note.title = 'Double-click (double-tap) to edit the note';
        attachDoubleTap(note, () => openNoteEditor(section));
      }
      holder.appendChild(note);
    }
  };

  if (state.sectionNotes.has(section)) fill(state.sectionNotes.get(section));
  else loadSectionNote(section).then(fill);
}

// Double-click on a laptop, double-tap on a phone (same gesture as editing a word card)
function attachDoubleTap(el, onDouble) {
  let lastTap = 0;
  el.addEventListener('pointerup', (event) => {
    if (event.button > 0 || event.target.closest('a')) return; // Links inside the note stay clickable
    const isDouble = event.timeStamp - lastTap <= NOTE_DOUBLE_TAP_MS;
    lastTap = isDouble ? 0 : event.timeStamp;
    if (isDouble) {
      window.getSelection && window.getSelection().removeAllRanges();
      onDouble();
    }
  });
}

// ---- Editor modal ----
const modal = document.getElementById('section-note-modal');
const titleEl = document.getElementById('section-note-title');
const saveBtn = document.getElementById('section-note-save');
const cancelBtn = document.getElementById('section-note-cancel');
let quill = null;
let editingSection = null;
let originalHtml = '';

function ensureQuill() {
  if (!quill) {
    quill = new window.Quill('#section-note-editor', {
      theme: 'snow',
      placeholder: 'Write the details for this section…',
      modules: { toolbar: QUILL_TOOLBAR },
    });
  }
  return quill;
}

export async function openNoteEditor(section) {
  if (!state.isAdmin) return;
  if (!window.Quill) {
    window.alert('The editor is still loading. Please try again in a moment.');
    return;
  }
  const html = await loadSectionNote(section);
  editingSection = section;
  titleEl.innerHTML = `Note · <span class="font-semibold">${escapeHtml(getSectionDisplayLabel(section))}</span>`;
  const editor = ensureQuill();
  editor.setContents([]);
  if (!isEmptyNote(html)) editor.clipboard.dangerouslyPasteHTML(html);
  originalHtml = editor.root.innerHTML;
  state.noteEditorOpen = true;
  modal.classList.add('open');
  requestAnimationFrame(() => {
    editor.focus();
    editor.setSelection(editor.getLength(), 0);
  });
}

function closeNoteEditor() {
  modal.classList.remove('open');
  state.noteEditorOpen = false;
  editingSection = null;
}

async function saveNote() {
  if (!editingSection) return;
  const section = editingSection;
  const html = quill.root.innerHTML;
  const empty = isEmptyNote(html) || !quill.getText().trim();
  saveBtn.disabled = true;
  try {
    await updateJapanData({ [`sectionNotes/${state.language}/${section}`]: empty ? null : {
      html,
      updatedAt: Date.now(),
      updatedBy: (state.currentUser && state.currentUser.email) || 'unknown',
    } }, {
      [`sectionNotes/${state.language}/${section}/html`]: originalHtml || null
    });
    state.sectionNotes.set(section, empty ? '' : html);
    const cached = await deviceCache.set(noteCacheScope(), `note:${section}`, empty ? '' : html);
    if (!cached.ok) console.warn('Could not cache saved section note locally.', cached.error);
    closeNoteEditor();
    loadAndRenderSectionBody(section);
  } catch (err) {
    console.error('Failed to save section note', err);
    window.alert('Failed to save the note. See console for details.');
  } finally {
    saveBtn.disabled = false;
  }
}

function cancelNote() {
  if (quill && quill.root.innerHTML !== originalHtml && !window.confirm('Discard your changes to this note?')) return;
  closeNoteEditor();
}

if (modal) {
  saveBtn.addEventListener('click', saveNote);
  cancelBtn.addEventListener('click', cancelNote);
  modal.addEventListener('click', (event) => event.stopPropagation()); // Keep page click handlers out of it
  modal.addEventListener('keydown', (event) => {
    event.stopPropagation(); // Page shortcuts (space = quick-add) never fire while editing
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveNote();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelNote();
    }
  });
}

// Keeps cached notes in step when sections are renamed, merged or deleted
export function moveCachedNote(from, to) {
  if (state.sectionNotes.has(from)) {
    state.sectionNotes.set(to, state.sectionNotes.get(from));
    state.sectionNotes.delete(from);
  }
}
