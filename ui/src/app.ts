import { AddFigureResult, Category, Figure, Story, StoryLength, StorySummary } from './types';

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
  generatedWrap: byId<HTMLElement>('generated-story-wrap'),
  generatedStoryPage: byId<HTMLElement>('generated-story-page'),
  deckSection: byId<HTMLElement>('deck-section'),
  deck: byId<HTMLElement>('deck'),
  generateBar: byId<HTMLElement>('generate-bar'),
  btnGenerate: byId<HTMLButtonElement>('btn-generate'),
  btnNewStory: byId<HTMLButtonElement>('btn-new-story'),
  btnAbandon: byId<HTMLButtonElement>('btn-abandon'),
  btnRestartAfter: byId<HTMLButtonElement>('btn-restart-after'),
  btnGenerateLabel: byId<HTMLElement>('btn-generate-label'),
  tabHistory: byId<HTMLElement>('tab-history'),
  historyList: byId<HTMLElement>('history-list'),
  historyDetail: byId<HTMLElement>('history-detail'),
  historyStory: byId<HTMLElement>('history-story'),
  btnHistoryBack: byId<HTMLButtonElement>('btn-history-back'),
  toast: byId<HTMLElement>('toast'),
  manageList: byId<HTMLElement>('manage-list'),
  newFigureModal: byId<HTMLElement>('new-figure-modal'),
  newFigureModalDialog: byId<HTMLElement>('new-figure-modal').querySelector('.modal') as HTMLElement,
  newFigureForm: byId<HTMLFormElement>('new-figure-form'),
  btnAddFigure: byId<HTMLButtonElement>('btn-add-figure'),
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

type StoryPageContent = Pick<Story, 'title' | 'storyText' | 'images' | 'imagesPending' | 'figures'>;

// the illustrated story page plus its cast - shared by the create tab's freshly generated story
// and a story opened from history
function renderStoryPage(target: HTMLElement, story: StoryPageContent): void {
  target.innerHTML = '';
  const page = document.createElement('div');
  page.className = 'story-page';
  const titleEl = document.createElement('h2');
  titleEl.className = 'story-title';
  titleEl.textContent = story.title || '';
  const storyEl = document.createElement('div');
  storyEl.className = 'story-text';
  const ornament = (position: 'top' | 'bottom') => {
    const div = document.createElement('div');
    div.className = `story-ornament story-ornament-${position}`;
    div.setAttribute('aria-hidden', 'true');
    div.textContent = '❧';
    return div;
  };
  page.append(titleEl, ornament('top'), storyEl, ornament('bottom'));
  target.appendChild(page);

  const tags = document.createElement('ul');
  tags.className = 'figure-list readonly';
  story.figures.forEach((f) => {
    const li = document.createElement('li');
    li.dataset.cat = f.category;
    const nameSpan = document.createElement('span');
    nameSpan.textContent = f.name;
    li.appendChild(nameSpan);
    tags.appendChild(li);
  });
  target.appendChild(tags);

  const storyText = story.storyText || '';
  const images = story.images;
  const pending = story.imagesPending;

  // paragraphs are separated by blank lines, but a paragraph can hold single line breaks of its
  // own - gpt-4.1 puts each line of dialogue on its own line, and .story-text renders those with
  // white-space: pre-wrap. Each line is trimmed because it also arrives with trailing spaces,
  // which pre-wrap would otherwise keep and hang off the edge of the line.
  const paragraphs = storyText
    .split(/\n{2,}/)
    .map((p) =>
      p
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n')
    )
    .filter(Boolean);
  // a slot stays empty when that one illustration failed - the other scenes still get theirs.
  // while `pending` it is a picture still rendering, and gets a placeholder instead.
  const imageAt = (i: number) => (images && images.length >= 3 ? images[i] : null);
  const showsSlot = (i: number) => Boolean(imageAt(i)) || Boolean(pending);
  const middleIndex = Math.floor((paragraphs.length - 1) / 2);

  if (showsSlot(0)) storyEl.appendChild(illustrationElement(0, imageAt(0)));

  paragraphs.forEach((text, i) => {
    const p = document.createElement('p');
    p.textContent = text;
    storyEl.appendChild(p);
    if (i === middleIndex && showsSlot(1)) {
      storyEl.appendChild(illustrationElement(1, imageAt(1)));
    }
  });

  if (showsSlot(2)) storyEl.appendChild(illustrationElement(2, imageAt(2)));
}

// Swaps in the pictures that have arrived without rebuilding the story around them, so the text
// the reader is looking at doesn't jump. Once done, any placeholder still empty is a scene that
// couldn't be drawn, and is dropped.
function applyIllustrations(target: HTMLElement, images: (string | null)[], done: boolean): void {
  target
    .querySelectorAll<HTMLElement>('.story-illustration-pending')
    .forEach((slot) => {
      const index = Number(slot.dataset.slot);
      const src = images[index];
      if (src) slot.replaceWith(illustrationElement(index, src));
      else if (done) slot.remove();
    });
}

function renderStory(): void {
  if (!currentStory) {
    el.noStory.classList.remove('hidden');
    el.activeStory.classList.add('hidden');
    el.generateBar.classList.add('hidden');
    return;
  }

  el.noStory.classList.add('hidden');
  el.activeStory.classList.remove('hidden');

  const isGenerated = currentStory.status === 'generated';

  if (isGenerated && currentStory.storyText) {
    renderStoryPage(el.generatedStoryPage, currentStory);
    el.generatedWrap.classList.remove('hidden');
    el.deckSection.classList.add('hidden');
    el.generateBar.classList.add('hidden');
  } else {
    el.generatedWrap.classList.add('hidden');
    el.deckSection.classList.remove('hidden');
    el.generateBar.classList.remove('hidden');
    el.btnGenerate.disabled = missingCategories(currentStory.figures).length > 0;
    syncDeckSelection();
  }
}

// the deck's DOM is built once per loadDeck() and only its selection state is synced
// afterwards, so picking a figure never rebuilds (or re-scrolls) the controls
function buildDeck(): void {
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
    if (!REQUIRED_CATEGORIES.includes(cat)) {
      const optional = document.createElement('span');
      optional.className = 'deck-group-optional';
      optional.textContent = '(לא חובה)';
      label.appendChild(optional);
    }
    group.appendChild(label);

    const controls = document.createElement('div');
    controls.className = 'deck-group-controls';
    group.appendChild(controls);

    if (PICKER_CATEGORIES.includes(cat)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'token-btn picker-trigger';
      btn.innerHTML = `<span>${CATEGORY_EMOJI[cat]} בחרו ${CATEGORY_LABELS[cat]}</span>`;
      const countSpan = document.createElement('span');
      countSpan.className = 'picker-trigger-count';
      btn.appendChild(countSpan);
      btn.addEventListener('click', () => openFigurePickerModal(cat));
      controls.appendChild(btn);
      const chips = document.createElement('ul');
      chips.className = 'figure-list category-chips';
      controls.appendChild(chips);
    } else {
      // all options visible as toggle chips - the chip itself shows whether it's picked
      const row = document.createElement('div');
      row.className = 'toggle-chips';
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', CATEGORY_LABELS[cat]);
      groups[cat]!.forEach((figure) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toggle-chip';
        btn.dataset.uid = figure.uid;
        btn.dataset.name = figure.name;
        btn.addEventListener('click', () => toggleMood(figure.uid));
        row.appendChild(btn);
      });
      controls.appendChild(row);
    }

    el.deck.appendChild(group);
  });
  syncDeckSelection();
}

function syncDeckSelection(): void {
  const figures = currentStory?.figures || [];
  el.deck.querySelectorAll<HTMLElement>('.deck-group').forEach((group) => {
    const picked = figures.filter((f) => f.category === group.dataset.cat);

    const count = group.querySelector<HTMLElement>('.picker-trigger-count');
    if (count) count.textContent = picked.length > 0 ? `${picked.length} נבחרו` : '';

    group.querySelectorAll<HTMLButtonElement>('.toggle-chip').forEach((btn) => {
      const isPicked = picked.some((f) => f.uid === btn.dataset.uid);
      btn.setAttribute('aria-pressed', String(isPicked));
      btn.textContent = btn.dataset.name!;
      if (isPicked) {
        const check = document.createElement('span');
        check.className = 'toggle-chip-check';
        check.textContent = '✓\u00a0'; // a no-break space keeps the ✓ on the name's first line
        check.setAttribute('aria-hidden', 'true');
        btn.prepend(check);
      }
    });

    const chips = group.querySelector<HTMLUListElement>('.category-chips');
    if (!chips) return;
    chips.innerHTML = '';
    picked.forEach((f) => {
      const li = document.createElement('li');
      li.dataset.cat = f.category;
      const nameSpan = document.createElement('span');
      nameSpan.textContent = f.name;
      li.appendChild(nameSpan);
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '✕';
      removeBtn.title = 'הסר';
      removeBtn.setAttribute('aria-label', `הסר את ${f.name}`);
      removeBtn.addEventListener('click', () => removeFigure(f.entryId));
      li.appendChild(removeBtn);
      chips.appendChild(li);
    });
  });
}

async function loadDeck(): Promise<void> {
  deck = await api<Figure[]>('/figures');
  buildDeck();
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

let modalReturnFocus: HTMLElement | null = null;

function openNewFigureModal(): void {
  modalReturnFocus = document.activeElement as HTMLElement;
  el.newFigureModal.classList.remove('hidden');
  el.newFigureName.focus();
  document.addEventListener('keydown', onModalKeydown);
}

function closeNewFigureModal(): void {
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
  const name = el.newFigureName.value.trim();
  const category = el.newFigureCategory.value as Category;
  const description = el.newFigureDescription.value.trim();

  if (!name) return;

  try {
    // no uid: the server generates one
    await api<Figure>('/figures', {
      method: 'POST',
      body: JSON.stringify({ name, category, description }),
    });
    closeNewFigureModal();
    await loadDeck();
    showToast(`נוסף: ${name}`);
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
      const result = await api<AddFigureResult>(`/stories/${currentStory.id}/figures`, {
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

async function addFigureToStory(uid: string): Promise<void> {
  if (!currentStory) return;
  try {
    const result = await api<AddFigureResult>(`/stories/${currentStory.id}/figures`, {
      method: 'POST',
      body: JSON.stringify({ uid }),
    });
    if (!result.recognized) {
      // the deck changed under us (e.g. deleted from another tab) - refresh it
      showToast('הדמות כבר לא קיימת');
      await loadDeck();
      return;
    }
    if (result.duplicate) {
      showToast(`${result.figure!.name} כבר נוסף`);
      return;
    }
    currentStory.figures = result.figures!;
    renderStory();
  } catch (err) {
    showToast((err as Error).message);
  }
}

// uids with an add/remove request in flight - a fast double tap must not add a mood twice
const moodRequestsInFlight = new Set<string>();

async function toggleMood(uid: string): Promise<void> {
  if (!currentStory || moodRequestsInFlight.has(uid)) return;
  const chip = el.deck.querySelector<HTMLElement>(`.toggle-chip[data-uid="${CSS.escape(uid)}"]`);
  moodRequestsInFlight.add(uid);
  chip?.setAttribute('aria-busy', 'true');
  try {
    const entry = currentStory.figures.find((f) => f.uid === uid);
    if (entry) await removeFigure(entry.entryId);
    else await addFigureToStory(uid);
  } finally {
    moodRequestsInFlight.delete(uid);
    chip?.removeAttribute('aria-busy');
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
    applyIllustrations(el.generatedStoryPage, images, true);
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
      applyIllustrations(el.generatedStoryPage, res.images, false);
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
    byId('tab-create').scrollTo({ top: 0 });
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
    const card = document.createElement('article');
    card.className = 'history-item';
    card.dataset.id = s.id;
    const date = new Date(s.createdAt).toLocaleString('he-IL');
    const statusLabel = STATUS_LABELS[s.status] || s.status;
    const heading = s.title || `${statusLabel} · ${s.figureCount} דמויות`;

    if (s.coverUrl) {
      const cover = document.createElement('img');
      cover.className = 'history-cover';
      cover.src = s.coverUrl;
      cover.alt = '';
      cover.loading = 'lazy';
      card.appendChild(cover);
    }

    const body = document.createElement('div');
    body.className = 'history-item-body';
    body.innerHTML = `
      <div class="history-item-head">
        <h3><button type="button" class="history-open"></button></h3>
        <button type="button" class="favorite-btn" aria-label="סמן כמועדף">${s.favorite ? '★' : '☆'}</button>
      </div>
      <div class="muted">${date}</div>
    `;
    // the title button is what opens the story - its ::after stretches over the whole card,
    // so the card is one big tap target while keyboard users get a real button
    body.querySelector('.history-open')!.textContent = heading;
    if (s.snippet) {
      const snippet = document.createElement('p');
      snippet.className = 'muted';
      snippet.textContent = `${s.snippet}…`;
      body.appendChild(snippet);
    }

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
      body.appendChild(tagList);
    }
    card.appendChild(body);

    const favoriteBtn = body.querySelector<HTMLButtonElement>('.favorite-btn')!;
    favoriteBtn.classList.toggle('active', s.favorite);
    favoriteBtn.addEventListener('click', () => toggleFavorite(s.id, !s.favorite));

    body.querySelector('.history-open')!.addEventListener('click', () => openHistoryStory(s.id));
    el.historyList.appendChild(card);
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

// a story opened from history is shown in place of the list, inside the History tab - it never
// touches currentStory, so a story half-built on the create tab is left exactly as it was
let openHistoryId: string | null = null;
let historyListScrollTop = 0;

async function openHistoryStory(id: string): Promise<void> {
  let story: Story;
  try {
    story = await api<Story>(`/stories/${id}`);
  } catch (err) {
    showToast((err as Error).message);
    return;
  }
  openHistoryId = id;
  historyListScrollTop = el.tabHistory.scrollTop;
  renderStoryPage(el.historyStory, story);
  el.historyList.classList.add('hidden');
  el.historyDetail.classList.remove('hidden');
  el.tabHistory.scrollTop = 0;
  el.btnHistoryBack.focus();
}

function closeHistoryStory(): void {
  el.historyDetail.classList.add('hidden');
  el.historyList.classList.remove('hidden');
  el.historyStory.innerHTML = '';
  el.tabHistory.scrollTop = historyListScrollTop;
  // looked up by id rather than kept as a node - the list may have been rebuilt meanwhile
  if (openHistoryId) {
    el.historyList
      .querySelector<HTMLElement>(`.history-item[data-id="${CSS.escape(openHistoryId)}"] .history-open`)
      ?.focus({ preventScroll: true });
  }
  openHistoryId = null;
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
    if (btn.dataset.tab === 'history') {
      if (openHistoryId) closeHistoryStory(); // the tab itself is the way back to the list
      loadHistory();
    }
  });
});

el.btnNewStory.addEventListener('click', newStory);
el.btnAbandon.addEventListener('click', abandonStory);
el.btnRestartAfter.addEventListener('click', abandonStory);
el.btnGenerate.addEventListener('click', generateStory);
el.btnAddFigure.addEventListener('click', openNewFigureModal);
el.btnHistoryBack.addEventListener('click', closeHistoryStory);
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

loadDeck();
loadVersion();
renderStory();
