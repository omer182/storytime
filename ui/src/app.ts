import { Category, Figure, ScanResult, Story, StorySummary } from './types';

const API = '/api';
const REQUIRED_CATEGORIES: Category[] = ['character', 'location', 'mood'];

const CATEGORY_LABELS: Record<Category, string> = {
  character: 'דמות',
  location: 'מקום',
  mood: 'מצב רוח',
  object: 'חפץ',
};

const CATEGORY_ORDER: Category[] = ['character', 'location', 'mood', 'object'];

const STATUS_LABELS: Record<string, string> = {
  collecting: 'אוסף דמויות',
  generated: 'הסיפור מוכן',
};

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
  storyStatus: byId<HTMLElement>('story-status'),
  storyId: byId<HTMLElement>('story-id'),
  gateProgress: byId<HTMLElement>('gate-progress'),
  addedFigures: byId<HTMLUListElement>('added-figures'),
  generatedWrap: byId<HTMLElement>('generated-story-wrap'),
  generatedStory: byId<HTMLElement>('generated-story'),
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

function renderGeneratedStory(storyText: string, images?: string[]): void {
  el.generatedStory.innerHTML = '';

  const addImage = (src: string, alt: string) => {
    const img = document.createElement('img');
    img.src = src;
    img.alt = alt;
    img.className = 'story-illustration';
    el.generatedStory.appendChild(img);
  };

  const paragraphs = storyText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const hasImages = !!images && images.length >= 3;
  const middleIndex = Math.floor((paragraphs.length - 1) / 2);

  if (hasImages) addImage(images![0], 'איור פתיחת הסיפור');

  paragraphs.forEach((text, i) => {
    const p = document.createElement('p');
    p.textContent = text;
    el.generatedStory.appendChild(p);
    if (hasImages && i === middleIndex) addImage(images![1], 'איור מאמצע הסיפור');
  });

  if (hasImages) addImage(images![2], 'איור סיום הסיפור');
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

  el.storyStatus.textContent = STATUS_LABELS[currentStory.status] || currentStory.status;
  el.storyStatus.className = 'badge' + (isGenerated ? ' generated' : '');
  el.storyId.textContent = currentStory.id.slice(0, 8);

  const present = new Set(currentStory.figures.map((f) => f.category));
  el.gateProgress.querySelectorAll<HTMLElement>('.gate-pill').forEach((pill) => {
    pill.classList.toggle('done', present.has(pill.dataset.cat as Category));
  });
  el.gateProgress.classList.toggle('hidden', isGenerated);

  el.addedFigures.innerHTML = '';
  currentStory.figures.forEach((f) => {
    const li = document.createElement('li');
    li.dataset.cat = f.category;
    const nameSpan = document.createElement('span');
    nameSpan.textContent = f.name;
    li.appendChild(nameSpan);
    if (!isGenerated) {
      const removeBtn = document.createElement('button');
      removeBtn.textContent = '✕';
      removeBtn.title = 'הסר';
      removeBtn.setAttribute('aria-label', `הסר את ${f.name}`);
      removeBtn.addEventListener('click', () => removeFigure(f.entryId));
      li.appendChild(removeBtn);
    }
    el.addedFigures.appendChild(li);
  });

  if (isGenerated && currentStory.storyText) {
    renderGeneratedStory(currentStory.storyText, currentStory.images);
    el.generatedWrap.classList.remove('hidden');
    el.deckSection.classList.add('hidden');
    el.generateBar.classList.add('hidden');
  } else {
    el.generatedWrap.classList.add('hidden');
    el.deckSection.classList.remove('hidden');
    el.generateBar.classList.remove('hidden');
    el.btnGenerate.disabled = missingCategories(currentStory.figures).length > 0;
  }
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
    group.appendChild(row);

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

async function generateStory(): Promise<void> {
  if (!currentStory) return;
  el.btnGenerate.disabled = true;
  el.btnGenerate.setAttribute('aria-busy', 'true');
  el.btnGenerate.classList.add('loading');
  el.btnGenerateLabel.textContent = 'יוצר סיפור ואיורים…';
  try {
    currentStory = await api<Story>(`/stories/${currentStory.id}/generate`, { method: 'POST' });
    renderStory();
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
    renderStory();
  }
}

function abandonStory(): void {
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
    div.innerHTML = `
      <h3>${statusLabel} · ${s.figureCount} דמויות</h3>
      <div class="muted">${date}</div>
      ${s.snippet ? `<p class="muted">${s.snippet}…</p>` : ''}
    `;
    if (s.status === 'generated') {
      div.addEventListener('click', () => toggleHistoryStory(div, s.id));
    }
    el.historyList.appendChild(div);
  });
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

loadDeck();
renderStory();
