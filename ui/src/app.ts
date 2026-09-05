import { Category, Figure, ScanResult, Story, StoryLength, StorySummary } from './types';

const API = '/api';
const REQUIRED_CATEGORIES: Category[] = ['character', 'location', 'mood'];

const CATEGORY_LABELS: Record<Category, string> = {
  character: 'דמות',
  location: 'מקום',
  mood: 'מצב רוח',
  object: 'חפץ',
};

const CATEGORY_ORDER: Category[] = ['character', 'location', 'mood', 'object'];

// categories shown as an image-grid picker modal, rather than an inline row of text tokens.
// only one location is allowed per story; character/object allow multiple.
const PICKER_CATEGORIES: Category[] = ['character', 'location', 'object'];
const SINGLE_SELECT_CATEGORIES: Category[] = ['location'];

const CATEGORY_EMOJI: Record<Category, string> = {
  character: '🧑',
  location: '📍',
  mood: '💭',
  object: '🎒',
};

// .jpg first - the generated catalog art is stored as compressed jpg, so the common case
// costs no wasted 404. .png stays as a fallback for hand-dropped files.
function figureImageCandidates(uid: string): string[] {
  return [`figure-images/${uid}.jpg`, `figure-images/${uid}.png`];
}

const STATUS_LABELS: Record<string, string> = {
  collecting: 'אוסף דמויות',
  generated: 'הסיפור מוכן',
};

let selectedLength: StoryLength = 'medium';

class ApiError extends Error {
  status: number;
  body: { error?: string; missing?: Category[] };

  constructor(message: string, status: number, body: { error?: string; missing?: Category[] }) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

let currentStory: Story | null = null;
let deck: Figure[] = [];

function byId<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id} in the page`);
  return found as T;
}

const el = {
  noStory: byId<HTMLElement>('no-story'),
  activeStory: byId<HTMLElement>('active-story'),
  statusRow: byId<HTMLElement>('status-row'),
  storyStatus: byId<HTMLElement>('story-status'),
  gateProgress: byId<HTMLElement>('gate-progress'),
  addedFigures: byId<HTMLUListElement>('added-figures'),
  generatedWrap: byId<HTMLElement>('generated-story-wrap'),
  generatedStoryTitle: byId<HTMLElement>('generated-story-title'),
  generatedStory: byId<HTMLElement>('generated-story'),
  storyFigureTags: byId<HTMLUListElement>('story-figure-tags'),
  deckSection: byId<HTMLElement>('deck-section'),
  deck: byId<HTMLElement>('deck'),
  generateBar: byId<HTMLElement>('generate-bar'),
  btnGenerate: byId<HTMLButtonElement>('btn-generate'),
  btnNewStory: byId<HTMLButtonElement>('btn-new-story'),
  btnAbandon: byId<HTMLButtonElement>('btn-abandon'),
  btnRestartAfter: byId<HTMLButtonElement>('btn-restart-after'),
  btnGenerateLabel: byId<HTMLElement>('btn-generate-label'),
  historyList: byId<HTMLElement>('history-list'),
  toast: byId<HTMLElement>('toast'),
  manageList: byId<HTMLElement>('manage-list'),
  newFigureModal: byId<HTMLElement>('new-figure-modal'),
  newFigureModalDialog: byId<HTMLElement>('new-figure-modal').querySelector('.modal') as HTMLElement,
  newFigureForm: byId<HTMLFormElement>('new-figure-form'),
  newFigureUid: byId<HTMLElement>('new-figure-uid'),
  newFigureCategory: byId<HTMLSelectElement>('new-figure-category'),
  newFigureName: byId<HTMLInputElement>('new-figure-name'),
  newFigureDescription: byId<HTMLTextAreaElement>('new-figure-description'),
  btnCancelNewFigure: byId<HTMLButtonElement>('btn-cancel-new-figure'),
  figurePickerModal: byId<HTMLElement>('figure-picker-modal'),
  figurePickerModalDialog: byId<HTMLElement>('figure-picker-modal').querySelector('.modal') as HTMLElement,
  figurePickerTitle: byId<HTMLElement>('figure-picker-title'),
  figurePickerHint: byId<HTMLElement>('figure-picker-hint'),
  figurePickerGrid: byId<HTMLElement>('figure-picker-grid'),
  btnConfirmFigurePicker: byId<HTMLButtonElement>('btn-confirm-figure-picker'),
  lengthSegmented: byId<HTMLElement>('length-segmented'),
  includeImages: byId<HTMLInputElement>('include-images'),
  appShell: document.querySelector('.app-shell') as HTMLElement,
  loadingOverlay: byId<HTMLElement>('loading-overlay'),
  loadingMessage: byId<HTMLElement>('loading-message'),
  appVersion: byId<HTMLElement>('app-version'),
};

let toastTimer: ReturnType<typeof setTimeout> | undefined;

function showToast(message: string): void {
  el.toast.textContent = message;
  el.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 2200);
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(body.error || `request failed (${res.status})`, res.status, body);
  }
  return body as T;
}

function missingCategories(figures: { category: Category }[]): Category[] {
  const present = new Set(figures.map((f) => f.category));
  return REQUIRED_CATEGORIES.filter((cat) => !present.has(cat));
}

const ILLUSTRATION_ALTS = ['איור פתיחת הסיפור', 'איור מאמצע הסיפור', 'איור סיום הסיפור'];

function illustrationElement(index: number, src: string | null): HTMLElement {
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = ILLUSTRATION_ALTS[index];
    img.className = 'story-illustration';
    img.dataset.slot = String(index);
    return img;
  }
  // the story text arrives before its pictures, so each scene holds its place with a shimmering
  // frame that is swapped for the illustration when it lands
  const slot = document.createElement('div');
  slot.className = 'story-illustration story-illustration-pending';
  slot.dataset.slot = String(index);
  slot.setAttribute('role', 'img');
  slot.setAttribute('aria-label', `${ILLUSTRATION_ALTS[index]} - עוד רגע…`);
  return slot;
}

function renderGeneratedStory(
  storyText: string,
  title: string | null,
  images?: (string | null)[],
  pending?: boolean
): void {
  el.generatedStoryTitle.textContent = title || '';
  el.generatedStory.innerHTML = '';

  const paragraphs = storyText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  // a slot stays empty when that one illustration failed - the other scenes still get theirs.
  // while `pending` it is a picture still rendering, and gets a placeholder instead.
  const imageAt = (i: number) => (images && images.length >= 3 ? images[i] : null);
  const showsSlot = (i: number) => Boolean(imageAt(i)) || Boolean(pending);
  const middleIndex = Math.floor((paragraphs.length - 1) / 2);

  if (showsSlot(0)) el.generatedStory.appendChild(illustrationElement(0, imageAt(0)));

  paragraphs.forEach((text, i) => {
    const p = document.createElement('p');
    p.textContent = text;
    el.generatedStory.appendChild(p);
    if (i === middleIndex && showsSlot(1)) {
      el.generatedStory.appendChild(illustrationElement(1, imageAt(1)));
    }
  });

  if (showsSlot(2)) el.generatedStory.appendChild(illustrationElement(2, imageAt(2)));
}

// Swaps in the pictures that have arrived without rebuilding the story around them, so the text
// the reader is looking at doesn't jump. Once done, any placeholder still empty is a scene that
// couldn't be drawn, and is dropped.
function applyIllustrations(images: (string | null)[], done: boolean): void {
  el.generatedStory
    .querySelectorAll<HTMLElement>('.story-illustration-pending')
    .forEach((slot) => {
      const index = Number(slot.dataset.slot);
      const src = images[index];
      if (src) slot.replaceWith(illustrationElement(index, src));
      else if (done) slot.remove();
    });
}

function renderStory(): void {
  document.querySelector('main')?.classList.toggle('no-scroll', !currentStory);

  if (!currentStory) {
    el.noStory.classList.remove('hidden');
    el.activeStory.classList.add('hidden');
    el.generateBar.classList.add('hidden');
    return;
  }

  el.noStory.classList.add('hidden');
  el.activeStory.classList.remove('hidden');

  const isGenerated = currentStory.status === 'generated';

  el.statusRow.classList.toggle('hidden', isGenerated);
  el.storyStatus.textContent = STATUS_LABELS[currentStory.status] || currentStory.status;
  el.storyStatus.className = 'badge';

  const present = new Set(currentStory.figures.map((f) => f.category));
  el.gateProgress.querySelectorAll<HTMLElement>('.gate-pill').forEach((pill) => {
    pill.classList.toggle('done', present.has(pill.dataset.cat as Category));
  });
  el.gateProgress.classList.toggle('hidden', isGenerated);

  el.addedFigures.classList.toggle('hidden', isGenerated);
  el.addedFigures.innerHTML = '';
  currentStory.figures.forEach((f) => {
    const li = document.createElement('li');
    li.dataset.cat = f.category;
    const nameSpan = document.createElement('span');
    nameSpan.textContent = f.name;
    li.appendChild(nameSpan);
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.title = 'הסר';
    removeBtn.setAttribute('aria-label', `הסר את ${f.name}`);
    removeBtn.addEventListener('click', () => removeFigure(f.entryId));
    li.appendChild(removeBtn);
    el.addedFigures.appendChild(li);
  });

  if (isGenerated && currentStory.storyText) {
    renderGeneratedStory(
      currentStory.storyText,
      currentStory.title,
      currentStory.images,
      currentStory.imagesPending
    );
    el.generatedWrap.classList.remove('hidden');
    el.deckSection.classList.add('hidden');
    el.generateBar.classList.add('hidden');

    el.storyFigureTags.innerHTML = '';
    currentStory.figures.forEach((f) => {
      const li = document.createElement('li');
      li.dataset.cat = f.category;
      const nameSpan = document.createElement('span');
      nameSpan.textContent = f.name;
      li.appendChild(nameSpan);
      el.storyFigureTags.appendChild(li);
    });
  } else {
    el.generatedWrap.classList.add('hidden');
    el.deckSection.classList.remove('hidden');
    el.generateBar.classList.remove('hidden');
    el.btnGenerate.disabled = missingCategories(currentStory.figures).length > 0;
    renderDeck();
  }
}

const DRAG_THRESHOLD = 5; // px of pointer movement before a mouse drag counts as scrolling, not a click

function enableDragScroll(row: HTMLElement): void {
  let startX = 0;
  let startScrollLeft = 0;
  let dragging = false;

  // move/up listen on window (not the row, and no setPointerCapture) so the drag keeps
  // tracking even if the cursor leaves the row - setPointerCapture on a scrollable element
  // combined with programmatic scrollLeft writes causes some browsers to snap the scroll
  // position back to where it started once the pointer is released
  function onMove(event: PointerEvent): void {
    const dx = event.clientX - startX;
    if (!dragging && Math.abs(dx) > DRAG_THRESHOLD) {
      dragging = true;
      row.classList.add('dragging');
    }
    // content should follow the cursor (grab-and-drag), so scrollLeft moves opposite dx
    if (dragging) row.scrollLeft = startScrollLeft - dx;
  }

  function onUp(): void {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    row.classList.remove('dragging');
    dragging = false;
  }

  row.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse') return; // touch/pen already scroll natively
    startX = event.clientX;
    startScrollLeft = row.scrollLeft;
    dragging = false;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

function renderDeck(): void {
  el.deck.innerHTML = '';
  const groups: Partial<Record<Category, Figure[]>> = {};
  deck.forEach((f) => {
    if (!groups[f.category]) groups[f.category] = [];
    groups[f.category]!.push(f);
  });

  CATEGORY_ORDER.filter((cat) => groups[cat]).forEach((cat) => {
    const group = document.createElement('div');
    group.className = 'deck-group';
    group.dataset.cat = cat;

    const label = document.createElement('div');
    label.className = 'deck-group-label';
    label.textContent = CATEGORY_LABELS[cat] || cat;
    group.appendChild(label);

    if (PICKER_CATEGORIES.includes(cat)) {
      const selectedCount = (currentStory?.figures || []).filter((f) => f.category === cat).length;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'token-btn picker-trigger';
      btn.innerHTML = `<span>${CATEGORY_EMOJI[cat]} בחרו ${CATEGORY_LABELS[cat]}</span>`;
      if (selectedCount > 0) {
        const countSpan = document.createElement('span');
        countSpan.className = 'picker-trigger-count';
        countSpan.textContent = `${selectedCount} נבחרו`;
        btn.appendChild(countSpan);
      }
      btn.addEventListener('click', () => openFigurePickerModal(cat));
      group.appendChild(btn);
    } else {
      const row = document.createElement('div');
      row.className = 'deck-row';
      groups[cat]!.forEach((figure) => {
        const btn = document.createElement('button');
        btn.className = 'token-btn';
        btn.textContent = figure.name;
        btn.setAttribute('aria-label', `סרוק את ${figure.name} (${CATEGORY_LABELS[cat]})`);
        btn.addEventListener('click', () => scanFigure(figure.uid));
        row.appendChild(btn);
      });
      enableDragScroll(row);
      group.appendChild(row);
    }

    el.deck.appendChild(group);
  });
}

async function loadDeck(): Promise<void> {
  deck = await api<Figure[]>('/figures');
  renderDeck();
  renderManageList();
}

function renderManageList(): void {
  el.manageList.innerHTML = '';
  if (deck.length === 0) {
    el.manageList.innerHTML = '<p class="empty-hint">אין עדיין דמויות</p>';
    return;
  }
  deck.forEach((figure) => {
    const item = document.createElement('div');
    item.className = 'manage-item';

    const info = document.createElement('div');
    info.className = 'manage-item-info';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = `${figure.name} (${CATEGORY_LABELS[figure.category]})`;
    const uid = document.createElement('span');
    uid.className = 'uid';
    uid.textContent = figure.uid;
    info.appendChild(name);
    info.appendChild(uid);

    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.title = 'הסר';
    removeBtn.setAttribute('aria-label', `הסר את ${figure.name}`);
    removeBtn.addEventListener('click', () => deleteFigureFromDeck(figure.uid));

    item.appendChild(info);
    item.appendChild(removeBtn);
    el.manageList.appendChild(item);
  });
}

let pendingUnknownUid: string | null = null;
let modalReturnFocus: HTMLElement | null = null;

function openNewFigureModal(uid: string): void {
  pendingUnknownUid = uid;
  modalReturnFocus = document.activeElement as HTMLElement;
  el.newFigureUid.textContent = uid;
  el.newFigureModal.classList.remove('hidden');
  el.newFigureName.focus();
  document.addEventListener('keydown', onModalKeydown);
}

function closeNewFigureModal(): void {
  pendingUnknownUid = null;
  el.newFigureForm.reset();
  el.newFigureModal.classList.add('hidden');
  document.removeEventListener('keydown', onModalKeydown);
  modalReturnFocus?.focus();
  modalReturnFocus = null;
}

function onModalKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeNewFigureModal();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = el.newFigureModalDialog.querySelectorAll<HTMLElement>(
    'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

async function submitNewFigure(event: Event): Promise<void> {
  event.preventDefault();
  if (!pendingUnknownUid) return;
  const uid = pendingUnknownUid;
  const name = el.newFigureName.value.trim();
  const category = el.newFigureCategory.value as Category;
  const description = el.newFigureDescription.value.trim();

  if (!name) return;

  try {
    await api('/figures', {
      method: 'POST',
      body: JSON.stringify({ uid, name, category, description }),
    });
    closeNewFigureModal();
    await loadDeck();
    await scanFigure(uid); // now resolves - adds it straight into the current story
  } catch (err) {
    showToast((err as Error).message);
  }
}

async function deleteFigureFromDeck(uid: string): Promise<void> {
  try {
    await api(`/figures/${encodeURIComponent(uid)}`, { method: 'DELETE' });
    await loadDeck();
  } catch (err) {
    showToast((err as Error).message);
  }
}

let pickerCategory: Category | null = null;
let pickerSelectedUids = new Set<string>();
let pickerReturnFocus: HTMLElement | null = null;

function openFigurePickerModal(category: Category): void {
  if (!currentStory) return;
  pickerCategory = category;
  pickerSelectedUids = new Set(
    currentStory.figures.filter((f) => f.category === category).map((f) => f.uid)
  );
  pickerReturnFocus = document.activeElement as HTMLElement;
  el.figurePickerTitle.textContent = `בחרו ${CATEGORY_LABELS[category]}`;
  el.figurePickerHint.textContent = SINGLE_SELECT_CATEGORIES.includes(category)
    ? 'ניתן לבחור מקום אחד'
    : 'ניתן לבחור כמה שרוצים';
  renderFigurePickerGrid();
  el.figurePickerModal.classList.remove('hidden');
  document.addEventListener('keydown', onFigurePickerKeydown);
}

function closeFigurePickerModal(): void {
  pickerCategory = null;
  el.figurePickerModal.classList.add('hidden');
  document.removeEventListener('keydown', onFigurePickerKeydown);
  pickerReturnFocus?.focus();
  pickerReturnFocus = null;
}

function onFigurePickerKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeFigurePickerModal();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = el.figurePickerModalDialog.querySelectorAll<HTMLElement>(
    'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function renderFigurePickerGrid(): void {
  if (!pickerCategory) return;
  const category = pickerCategory;
  el.figurePickerGrid.innerHTML = '';
  deck
    .filter((f) => f.category === category)
    .forEach((figure) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'figure-card';
      card.classList.toggle('selected', pickerSelectedUids.has(figure.uid));

      const thumb = document.createElement('div');
      thumb.className = 'figure-card-thumb';
      const img = document.createElement('img');
      const candidates = figureImageCandidates(figure.uid);
      let candidateIndex = 0;
      img.alt = figure.name;
      img.src = candidates[0];
      img.addEventListener('error', () => {
        candidateIndex += 1;
        if (candidateIndex < candidates.length) {
          img.src = candidates[candidateIndex];
        } else {
          thumb.innerHTML = '';
          thumb.textContent = CATEGORY_EMOJI[category];
        }
      });
      thumb.appendChild(img);
      card.appendChild(thumb);

      const check = document.createElement('span');
      check.className = 'figure-card-check';
      check.textContent = '✓';
      check.setAttribute('aria-hidden', 'true');
      card.appendChild(check);

      const name = document.createElement('span');
      name.className = 'figure-card-name';
      name.textContent = figure.name;
      card.appendChild(name);

      card.addEventListener('click', () => {
        if (SINGLE_SELECT_CATEGORIES.includes(category)) {
          pickerSelectedUids.clear();
          pickerSelectedUids.add(figure.uid);
        } else if (pickerSelectedUids.has(figure.uid)) {
          pickerSelectedUids.delete(figure.uid);
        } else {
          pickerSelectedUids.add(figure.uid);
        }
        renderFigurePickerGrid();
      });

      el.figurePickerGrid.appendChild(card);
    });
}

async function confirmFigurePicker(): Promise<void> {
  if (!pickerCategory || !currentStory) {
    closeFigurePickerModal();
    return;
  }
  const category = pickerCategory;
  const before = new Set(
    currentStory.figures.filter((f) => f.category === category).map((f) => f.uid)
  );
  const toAdd = [...pickerSelectedUids].filter((uid) => !before.has(uid));
  const toRemove = currentStory.figures.filter((f) => f.category === category && !pickerSelectedUids.has(f.uid));

  closeFigurePickerModal();
  if (!currentStory) return;

  try {
    for (const entry of toRemove) {
      await api(`/stories/${currentStory.id}/figures/${entry.entryId}`, { method: 'DELETE' });
      currentStory.figures = currentStory.figures.filter((f) => f.entryId !== entry.entryId);
    }
    for (const uid of toAdd) {
      const result = await api<ScanResult>(`/stories/${currentStory.id}/figures`, {
        method: 'POST',
        body: JSON.stringify({ uid }),
      });
      if (result.figures) currentStory.figures = result.figures;
    }
  } catch (err) {
    showToast((err as Error).message);
  } finally {
    renderStory();
  }
}

async function newStory(): Promise<void> {
  currentStory = await api<Story>('/stories', { method: 'POST' });
  renderStory();
}

async function scanFigure(uid: string): Promise<void> {
  if (!currentStory) return;
  try {
    const result = await api<ScanResult>(`/stories/${currentStory.id}/figures`, {
      method: 'POST',
      body: JSON.stringify({ uid }),
    });
    if (!result.recognized) {
      openNewFigureModal(uid);
      return;
    }
    if (result.duplicate) {
      showToast(`${result.figure!.name} כבר נוסף`);
      return;
    }
    currentStory.figures = result.figures!;
    showToast(`נוסף: ${result.figure!.name}`);
    renderStory();
  } catch (err) {
    showToast((err as Error).message);
  }
}

async function removeFigure(entryId: number): Promise<void> {
  if (!currentStory) return;
  try {
    await api(`/stories/${currentStory.id}/figures/${entryId}`, { method: 'DELETE' });
    currentStory.figures = currentStory.figures.filter((f) => f.entryId !== entryId);
    renderStory();
  } catch (err) {
    showToast((err as Error).message);
  }
}

function showLoadingOverlay(message: string): void {
  el.loadingMessage.textContent = message;
  el.loadingOverlay.classList.remove('hidden');
  el.appShell.classList.add('blurred');
}

function hideLoadingOverlay(): void {
  el.loadingOverlay.classList.add('hidden');
  el.appShell.classList.remove('blurred');
}

function selectLength(button: HTMLButtonElement): void {
  el.lengthSegmented.querySelectorAll<HTMLButtonElement>('.segmented-btn').forEach((btn) => {
    btn.classList.remove('active');
  });
  button.classList.add('active');
  selectedLength = button.dataset.length as StoryLength;
}

interface IllustrationsResponse {
  status: 'pending' | 'done' | 'none';
  images: (string | null)[];
}

const ILLUSTRATION_POLL_MS = 2000;
// generous: three scenes, and one that keeps getting refused walks a retry ladder before it gives
// up. Past this the placeholders come down and the story simply stays text-only.
const ILLUSTRATION_POLL_TIMEOUT_MS = 4 * 60 * 1000;

let illustrationPollTimer: number | null = null;

function stopIllustrationPolling(): void {
  if (illustrationPollTimer !== null) {
    clearTimeout(illustrationPollTimer);
    illustrationPollTimer = null;
  }
}

// The generate call now returns as soon as the story text is ready, so the pictures are collected
// here and dropped into their placeholders as they arrive.
function pollIllustrations(storyId: string): void {
  stopIllustrationPolling();
  const deadline = Date.now() + ILLUSTRATION_POLL_TIMEOUT_MS;

  const finish = (images: (string | null)[]) => {
    if (currentStory && currentStory.id === storyId) {
      currentStory.images = images;
      currentStory.imagesPending = false;
    }
    applyIllustrations(images, true);
  };

  const tick = async (): Promise<void> => {
    // the reader moved on to another story - their pictures aren't wanted any more
    if (!currentStory || currentStory.id !== storyId) return stopIllustrationPolling();

    try {
      const res = await api<IllustrationsResponse>(`/stories/${storyId}/images`);
      if (!currentStory || currentStory.id !== storyId) return stopIllustrationPolling();

      // 'none' means the server has no job for this story (illustrations off, or restarted)
      if (res.status === 'none') return finish([]);
      if (res.status === 'done') return finish(res.images);

      if (currentStory) currentStory.images = res.images;
      applyIllustrations(res.images, false);
    } catch {
      // a failed poll is not fatal - the next tick tries again
    }

    if (Date.now() >= deadline) return finish(currentStory?.images || []);
    illustrationPollTimer = window.setTimeout(tick, ILLUSTRATION_POLL_MS);
  };

  void tick();
}

async function generateStory(): Promise<void> {
  if (!currentStory) return;
  const length = selectedLength;
  const generateImages = el.includeImages.checked;

  el.btnGenerate.disabled = true;
  el.btnGenerate.setAttribute('aria-busy', 'true');
  el.btnGenerate.classList.add('loading');
  el.btnGenerateLabel.textContent = 'יוצר סיפור…';
  showLoadingOverlay('יוצרים סיפור קסום…');
  try {
    currentStory = await api<Story>(`/stories/${currentStory.id}/generate`, {
      method: 'POST',
      body: JSON.stringify({ length, generateImages }),
    });
    renderStory();
    document.querySelector('main')?.scrollTo({ top: 0 });
    if (currentStory.imagesPending) pollIllustrations(currentStory.id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 422) {
      showToast('חסרות דמויות: ' + (err.body.missing || []).map((c) => CATEGORY_LABELS[c]).join(', '));
    } else {
      showToast((err as Error).message);
    }
  } finally {
    el.btnGenerate.removeAttribute('aria-busy');
    el.btnGenerate.classList.remove('loading');
    el.btnGenerateLabel.textContent = 'צור סיפור';
    hideLoadingOverlay();
    renderStory();
  }
}

function abandonStory(): void {
  stopIllustrationPolling();
  currentStory = null;
  renderStory();
}

async function loadHistory(): Promise<void> {
  const stories = await api<StorySummary[]>('/stories');
  el.historyList.innerHTML = '';
  if (stories.length === 0) {
    el.historyList.innerHTML = '<p class="empty-hint">אין עדיין סיפורים</p>';
    return;
  }
  stories.forEach((s) => {
    const div = document.createElement('div');
    div.className = 'history-item';
    const date = new Date(s.createdAt).toLocaleString('he-IL');
    const statusLabel = STATUS_LABELS[s.status] || s.status;
    const heading = s.title || `${statusLabel} · ${s.figureCount} דמויות`;
    div.innerHTML = `
      <div class="history-item-head">
        <h3>${heading}</h3>
        <button type="button" class="favorite-btn" aria-label="סמן כמועדף">${s.favorite ? '★' : '☆'}</button>
      </div>
      <div class="muted">${date}</div>
      ${s.snippet ? `<p class="muted">${s.snippet}…</p>` : ''}
    `;

    if (s.figures.length > 0) {
      const tagList = document.createElement('ul');
      tagList.className = 'figure-list readonly history-tags';
      s.figures.forEach((f) => {
        const li = document.createElement('li');
        li.dataset.cat = f.category;
        const nameSpan = document.createElement('span');
        nameSpan.textContent = f.name;
        li.appendChild(nameSpan);
        tagList.appendChild(li);
      });
      div.appendChild(tagList);
    }

    const favoriteBtn = div.querySelector<HTMLButtonElement>('.favorite-btn')!;
    favoriteBtn.classList.toggle('active', s.favorite);
    favoriteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleFavorite(s.id, !s.favorite);
    });

    if (s.status === 'generated') {
      div.addEventListener('click', () => toggleHistoryStory(div, s.id));
    }
    el.historyList.appendChild(div);
  });
}

async function toggleFavorite(storyId: string, favorite: boolean): Promise<void> {
  try {
    await api<Story>(`/stories/${storyId}/favorite`, {
      method: 'PATCH',
      body: JSON.stringify({ favorite }),
    });
    loadHistory();
  } catch (err) {
    showToast((err as Error).message);
  }
}

async function toggleHistoryStory(container: HTMLElement, storyId: string): Promise<void> {
  const existing = container.querySelector('.story-text');
  if (existing) {
    existing.remove();
    return;
  }
  try {
    const story = await api<Story>(`/stories/${storyId}`);
    const textDiv = document.createElement('div');
    textDiv.className = 'story-text';
    textDiv.textContent = story.storyText || '';
    container.appendChild(textDiv);
  } catch (err) {
    showToast((err as Error).message);
  }
}

document.querySelectorAll<HTMLButtonElement>('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach((b) => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    byId(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'history') loadHistory();
  });
});

el.btnNewStory.addEventListener('click', newStory);
el.btnAbandon.addEventListener('click', abandonStory);
el.btnRestartAfter.addEventListener('click', abandonStory);
el.btnGenerate.addEventListener('click', generateStory);
el.newFigureForm.addEventListener('submit', submitNewFigure);
el.btnCancelNewFigure.addEventListener('click', closeNewFigureModal);
el.newFigureModal.addEventListener('click', (event) => {
  if (event.target === el.newFigureModal) closeNewFigureModal();
});
el.btnConfirmFigurePicker.addEventListener('click', confirmFigurePicker);
el.figurePickerModal.addEventListener('click', (event) => {
  if (event.target === el.figurePickerModal) closeFigurePickerModal();
});
el.lengthSegmented.querySelectorAll<HTMLButtonElement>('.segmented-btn').forEach((btn) => {
  btn.addEventListener('click', () => selectLength(btn));
});

async function loadVersion(): Promise<void> {
  try {
    const health = await api<{ status: string; version?: string }>('/health');
    if (health.version) el.appVersion.textContent = `v${health.version}`;
  } catch {
    // purely cosmetic - fine to leave blank if this fails
  }
}

// percentage/inset height on #no-story doesn't reliably resolve against main's
// flex-computed height in every browser (main has overflow-y:auto + a flex-derived
// height, not an explicit one) - an explicit pixel height always works, so set it directly.
// A ResizeObserver (not just a window resize listener) catches every reason main's box can
// change size - mobile address-bar collapse/expand, orientation change, font load reflow -
// so #no-story never drifts out of sync and never leaves main scrollable.
const mainEl = document.querySelector('main') as HTMLElement;
const emptyStateResizeObserver = new ResizeObserver(() => {
  el.noStory.style.height = `${mainEl.clientHeight}px`;
});
emptyStateResizeObserver.observe(mainEl);

loadDeck();
loadVersion();
renderStory();
