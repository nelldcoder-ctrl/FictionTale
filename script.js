const STORAGE_PREFIX = 'FictionTales.';
const LEGACY_STORAGE_PREFIX = 'fable.';

const PROJECTS_STORAGE_KEY = 'FictionTales.projects.v1';
const ACTIVE_PROJECT_STORAGE_KEY = 'FictionTales.active-project.v1';
const PROJECT_COVER_STORAGE_KEY = 'FictionTales.project-cover.v1';
const PROJECT_DATA_STORAGE_KEYS = new Set([
  'FictionTales.characters.v1',
  'FictionTales.draft.v1',
  'FictionTales.stories.v1',
  'FictionTales.story-drafts.v1',
  'FictionTales.book-series.v1',
  'FictionTales.dialogue-drafts.v1',
  'FictionTales.recently-deleted.v1',
  'FictionTales.writing-goals.v1',
  'FictionTales.story-versions.v1',
  'FictionTales.character-versions.v1',
  'FictionTales.places.v1',
  'FictionTales.place-draft.v1',
  'FictionTales.world-entries.v1',
  'FictionTales.planning.v1',
  'FictionTales.lore.v1',
  PROJECT_COVER_STORAGE_KEY,
]);
const projectStorage = window.FictionTaleStorage;
const readUnscopedStorage = projectStorage.read.bind(projectStorage);
const writeUnscopedStorage = projectStorage.write.bind(projectStorage);
const removeUnscopedStorage = projectStorage.remove.bind(projectStorage);
let projects = [];
let activeProjectId = '';
let projectInitializationError = '';
let projectTouchTimer = 0;
let projectNavigationPending = false;
let pendingProjectDeleteId = '';
let pendingProjectDeleteFocus = null;

function shouldReduceMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    || document.documentElement.classList.contains('accessibility-reduced-motion');
}

function getMotionScrollBehavior() {
  return shouldReduceMotion() ? 'auto' : 'smooth';
}

function getMotionDelay(milliseconds) {
  return shouldReduceMotion() ? 0 : milliseconds;
}

function projectStorageKey(projectId, key) {
  const canonicalKey = key.startsWith(LEGACY_STORAGE_PREFIX)
    ? `${STORAGE_PREFIX}${key.slice(LEGACY_STORAGE_PREFIX.length)}`
    : key;
  if (!projectId || !PROJECT_DATA_STORAGE_KEYS.has(canonicalKey)) return key;
  return `FictionTales.projects.${projectId}.${canonicalKey.slice(STORAGE_PREFIX.length)}`;
}

function normalizeProjects(value) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  return value.slice(0, 500).flatMap((record) => {
    if (!record || typeof record !== 'object') return [];
    const id = typeof record.id === 'string' && /^[\w-]{1,100}$/.test(record.id) ? record.id : '';
    const name = typeof record.name === 'string' ? record.name.trim().slice(0, 80) : '';
    if (!id || !name || ids.has(id)) return [];
    ids.add(id);
    return [{
      id,
      name,
      description: typeof record.description === 'string' ? record.description.trim().slice(0, 300) : '',
      genre: typeof record.genre === 'string' ? record.genre.trim().slice(0, 60) : '',
      tags: [...new Set((Array.isArray(record.tags) ? record.tags : [])
        .filter((tag) => typeof tag === 'string')
        .map((tag) => tag.trim().slice(0, 24))
        .filter(Boolean))].slice(0, 12),
      createdAt: typeof record.createdAt === 'string' ? record.createdAt.slice(0, 40) : '',
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt.slice(0, 40) : '',
      lastOpenedAt: typeof record.lastOpenedAt === 'string' ? record.lastOpenedAt.slice(0, 40) : '',
      archivedAt: typeof record.archivedAt === 'string' ? record.archivedAt.slice(0, 40) : '',
    }];
  });
}

function hasUnscopedProjectData() {
  return [...PROJECT_DATA_STORAGE_KEYS].some((key) => readUnscopedStorage(key, undefined) !== undefined
    || readUnscopedStorage(`${LEGACY_STORAGE_PREFIX}${key.slice(STORAGE_PREFIX.length)}`, undefined) !== undefined);
}

function initializeProjectStorage() {
  let savedProjects = normalizeProjects(readUnscopedStorage(PROJECTS_STORAGE_KEY, []));
  let savedActiveProjectId = readUnscopedStorage(ACTIVE_PROJECT_STORAGE_KEY, '');
  if (!savedProjects.length && hasUnscopedProjectData()) {
    const now = new Date().toISOString();
    const firstProject = {
      id: 'my-first-project',
      name: 'My First Project',
      description: 'Your existing Fiction Tale work, brought together.',
      tags: [],
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      archivedAt: '',
    };
    for (const key of PROJECT_DATA_STORAGE_KEYS) {
      const value = readUnscopedStorage(key, undefined)
        ?? readUnscopedStorage(`${LEGACY_STORAGE_PREFIX}${key.slice(STORAGE_PREFIX.length)}`, undefined);
      if (value !== undefined && !writeUnscopedStorage(projectStorageKey(firstProject.id, key), value)) {
        throw new Error(`Could not move existing data for "${key}" into the first project.`);
      }
    }
    if (!writeUnscopedStorage(PROJECTS_STORAGE_KEY, [firstProject])
      || !writeUnscopedStorage(ACTIVE_PROJECT_STORAGE_KEY, firstProject.id)) {
      throw new Error('Could not save your project library. Your existing writing data was left in place.');
    }
    savedProjects = [firstProject];
    savedActiveProjectId = firstProject.id;
  }
  if (!savedProjects.some((project) => project.id === savedActiveProjectId)) savedActiveProjectId = '';
  return { savedProjects, savedActiveProjectId };
}

function scheduleProjectTouch() {
  if (!activeProjectId) return;
  window.clearTimeout(projectTouchTimer);
  projectTouchTimer = window.setTimeout(() => {
    const now = new Date().toISOString();
    const nextProjects = projects.map((project) => project.id === activeProjectId
      ? { ...project, updatedAt: now }
      : project);
    if (writeUnscopedStorage(PROJECTS_STORAGE_KEY, nextProjects)) {
      projects = nextProjects;
      renderProjectOverview();
    }
    else showToast('Your project changes were saved, but its last-updated date could not be refreshed.');
  }, 900);
}

try {
  const initializedProjects = initializeProjectStorage();
  projects = initializedProjects.savedProjects;
  activeProjectId = initializedProjects.savedActiveProjectId;
} catch (error) {
  projectInitializationError = error instanceof Error ? error.message : String(error);
  console.error('Fiction Tale could not initialize the project library.', error);
}

projectStorage.read = (key, fallback) => readUnscopedStorage(projectStorageKey(activeProjectId, key), fallback);
projectStorage.write = (key, value) => {
  const scopedKey = projectStorageKey(activeProjectId, key);
  const saved = writeUnscopedStorage(scopedKey, value);
  if (saved && scopedKey !== key) scheduleProjectTouch();
  return saved;
};
projectStorage.remove = (key) => {
  const scopedKey = projectStorageKey(activeProjectId, key);
  const removed = removeUnscopedStorage(scopedKey);
  if (removed && scopedKey !== key) scheduleProjectTouch();
  return removed;
};

if (location.hash.slice(1) === 'studio'
  && (!activeProjectId || !projects.some((project) => project.id === activeProjectId && !project.archivedAt))) {
  document.body.classList.remove('workspace-active');
  document.body.classList.add('project-library-active');
  window.history.replaceState(null, '', '#projects');
}

const STORAGE_KEY = 'FictionTales.characters.v1';
const DRAFT_KEY = 'FictionTales.draft.v1';
const STORIES_STORAGE_KEY = 'FictionTales.stories.v1';
const STORY_DRAFTS_KEY = 'FictionTales.story-drafts.v1';
const SERIES_STORAGE_KEY = 'FictionTales.book-series.v1';
const DIALOGUE_DRAFTS_KEY = 'FictionTales.dialogue-drafts.v1';
const RECENTLY_DELETED_KEY = 'FictionTales.recently-deleted.v1';
const WRITING_GOALS_KEY = 'FictionTales.writing-goals.v1';
const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_DATA_URL_LENGTH = Math.ceil(MAX_IMAGE_UPLOAD_BYTES * 4 / 3) + 1000;
const MAX_GALLERY_VALUE_LENGTH = 20_000_000;
const FOLDER_DB_NAME = 'fable.character-data';
const FOLDER_STORE = 'settings';
const FOLDER_HANDLE_KEY = 'directory-handle';
const DEFAULT_STORY_BACKGROUND = '#fbfdff';
const WRITING_PREFERENCES_DEFAULTS = {
  defaultKind: 'story',
  chapterFormat: 'markdown-h2',
  wordCount: 'words-characters',
  readingAppearance: DEFAULT_STORY_BACKGROUND,
};
let writingPreferences = { ...WRITING_PREFERENCES_DEFAULTS };
const form = document.querySelector('#character-form');
const characterGrid = document.querySelector('#character-grid');
const emptyState = document.querySelector('#empty-state');
const toast = document.querySelector('#toast');
const characterDialog = document.querySelector('#character-dialog');
const compareDialog = document.querySelector('#compare-dialog');
const aboutDialog = document.querySelector('#about-dialog');
const changelogDialog = document.querySelector('#changelog-dialog');
const deleteDialog = document.querySelector('#delete-dialog');
const projectDeleteDialog = document.querySelector('#project-delete-dialog');
const imageCropDialog = document.querySelector('#image-crop-dialog');
let printSectionState = null;
const storedCharacters = readStorage(STORAGE_KEY, []);
let characters = Array.isArray(storedCharacters)
  ? storedCharacters.filter((character) => character && typeof character === 'object' && typeof character.name === 'string')
  : [];
let activeId = '';
let toastTimer;
let profileReturnFocus = null;
let profileCloseTimer = null;
let profileAfterClose = null;
let aboutCloseTimer = null;
let aboutReturnFocus = null;
let changelogCloseTimer = null;
let changelogReturnFocus = null;

// Add new releases at the top, using the same fields: version, date, notes.
const CHANGELOG = [
  {
    version: '1.3.1',
    date: '2026/11/11',
    notes: [
      'Fixed restoring deleted shared characters and places so their links to book series are preserved, even if the series is edited while an item is deleted.',
    ],
  },
  {
    version: '1.3',
    date: '2026/11/11',
    notes: [
      'Added Book Series. Group stories into a series, choose each book’s number, link shared characters and places, and keep a timeline of events across books. Series are included in full backups.',
    ],
  },
  {
    version: '1.2',
    date: '2026/11/11',
    notes: [
      'Added Project Dashboard to show each story’s word count, number of chapters, linked characters, when it was last edited, writing progress, and unfinished tasks. Set a separate word goal for each story or draft.',
      'Added Recently Deleted, where you can restore or permanently delete characters, stories, places, and world entries. Settings now include editor, writing, and accessibility preferences.',
    ],
  },
  {
    version: '1.1',
    date: '2026/11/11',
    notes: [
      'Added Dialogue Workshop, where you can draft conversations separately, choose the characters involved, and add emotional context. Add a conversation to a saved story or draft when it is ready. Conversation drafts are included in backups.',
    ],
  },
  {
    version: '1.0',
    date: '2026/11/10',
    notes: [
      'Initial release of Fiction Tale, with a refreshed design and layouts for desktop, tablet, and mobile.',
      'Create detailed character profiles with backgrounds, personality prompts, relationships, timelines, images, and version history. Search, sort, compare, and organize characters with tags and groups.',
      'Write stories, scenes, and world notes. Use templates, organize chapters, link characters and places, track daily writing goals, and export stories in several formats. Drafts save automatically on this device.',
      'Add places and world entries to build your setting, then plan stories with outlines, timelines, relationship maps, mood boards, and writing prompts.',
      'Back up and restore your work from Settings. Full backups include your library and planning data. You can also print profiles and stories or save a character sheet as an image.',
      'Choose a light or dark theme, adjust accessibility settings, and install Fiction Tale from a supported website to use it offline.',
    ],
  },
];
let pendingDeleteId = '';
let pendingDeleteKind = '';
let activeProfile = null;
let profileGalleryRendered = false;
let profileDraftPreview = false;
let draftSaveWarningShown = false;
let characterFormHasChanges = false;
let imageCropState = {
  avatar: { zoom: 1, x: 0, y: 0 },
  cover: { zoom: 1, x: 0, y: 0 },
};
let pendingImageCrop = null;
let imageCropRequestId = 0;
const imageCandidateDirtyBefore = { avatar: null, cover: null };
let dataDirectory = null;
let folderWritePending = Promise.resolve();
let folderBackupTimer = 0;
const STORY_FONTS = {
  playfair: "'Playfair Display', Georgia, serif",
  'dm-sans': "'DM Sans', sans-serif",
  'roboto-slab': "'Roboto Slab', Georgia, serif",
  lora: "'Lora', Georgia, serif",
  merriweather: "'Merriweather', Georgia, serif",
  cormorant: "'Cormorant Garamond', Georgia, serif",
  'libre-baskerville': "'Libre Baskerville', Georgia, serif",
  lato: "'Lato', sans-serif",
  'nunito-sans': "'Nunito Sans', sans-serif",
  caveat: "'Caveat', cursive",
  'roboto-mono': "'Roboto Mono', monospace",
  georgia: 'Georgia, serif',
  courier: "'Courier New', monospace",
};
const STORY_FONT_GOOGLE_FAMILIES = {
  'roboto-slab': 'Roboto+Slab:wght@400;500;600;700',
  lora: 'Lora:wght@400;500;600;700',
  merriweather: 'Merriweather:wght@400;700',
  cormorant: 'Cormorant+Garamond:wght@400;500;600;700',
  'libre-baskerville': 'Libre+Baskerville:wght@400;700',
  lato: 'Lato:wght@400;700',
  'nunito-sans': 'Nunito+Sans:wght@400;600;700',
  caveat: 'Caveat:wght@400;500;600;700',
  'roboto-mono': 'Roboto+Mono:wght@400;500;700',
};
const loadedStoryFonts = new Set();
let editorPreferences = {
  defaultFont: 'dm-sans',
  fontSize: '19',
  lineSpacing: '1.75',
  editorWidth: '100%',
};

function loadStoryFont(fontKey) {
  const family = STORY_FONT_GOOGLE_FAMILIES[fontKey];
  if (!family || loadedStoryFonts.has(fontKey)) return;
  loadedStoryFonts.add(fontKey);
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
  stylesheet.addEventListener('error', () => {
    loadedStoryFonts.delete(fontKey);
    console.warn(`Could not load the optional ${fontKey} story font; using its system fallback.`);
  }, { once: true });
  document.head.append(stylesheet);
}
const STORY_KINDS = { story: 'Story', scene: 'Scene', world: 'World note', lore: 'Lore entry' };
const STORY_PROGRESS = { idea: 'Idea', drafting: 'Drafting', finished: 'Finished' };
const STORY_STARTERS = {
  scene: 'Where are we?\n\nWho is here, and what do they want right now?\n\nWhat goes wrong, or changes?\n\n',
  world: 'What is this place, power, or custom called?\n\nWhat makes it different from the ordinary world?\n\nWho benefits from it, and who pays for it?\n\nHow does it show up in everyday life?\n\n',
  outline: 'Opening — how does the story begin?\n\nThe spark — what disturbs the status quo?\n\nRising trouble — what gets harder?\n\nTurning point — what changes everything?\n\nAftermath — how do things end up?\n\n',
};
const STORY_TEMPLATES = {
  fantasy: {
    description: 'Build a magical world around a choice, a cost, and a quest that changes its hero.',
    characters: ['Hero: What do they want, and what are they afraid to lose?', 'Ally: What can they offer that the hero cannot?', 'Rival or antagonist: What do they believe is worth the cost?', 'Mentor or guide: Which rule of the world do they know?'],
    structure: ['Introduce the hero, the world, and the first sign of change.', 'Send the hero into the wider world; test their allies and the rules of magic.', 'Make the hero face the cost of their choices and decide what to protect.'],
    chapters: ['The ordinary world', 'A strange sign', 'The call to act', 'Crossing the threshold', 'An unlikely ally', 'Trials and revelations', 'The cost of power', 'The final choice', 'A changed world'],
  },
  mystery: {
    description: 'Plant a compelling question, fair clues, and believable suspects before the truth comes to light.',
    characters: ['Investigator: Why can’t they let this case go?', 'Victim or missing person: What important truth did they leave behind?', 'Suspects: What does each one want to hide?', 'Witness or ally: What do they know, and what might they misunderstand?'],
    structure: ['Present the crime or puzzle and establish the stakes.', 'Follow evidence, test alibis, and let each discovery change the theory.', 'Reveal how the clues fit together and show the consequences of the truth.'],
    chapters: ['The impossible question', 'The scene and its clues', 'First accounts', 'A suspect emerges', 'The misleading trail', 'A detail out of place', 'The case turns', 'The truth revealed', 'After the answer'],
  },
  adventure: {
    description: 'Set a clear destination, then make every obstacle demand a new skill or a difficult decision.',
    characters: ['Protagonist: What makes them the right person—and the wrong person—for this journey?', 'Companion: What do they need from the journey?', 'Guide or rival: How do their goals complicate the route?', 'Opponent: What stands between the group and their destination?'],
    structure: ['Set the goal, the ticking clock, and the reason to leave.', 'Escalate the journey with obstacles, discoveries, and shifting loyalties.', 'Reach the destination and resolve what the journey has changed.'],
    chapters: ['The goal is named', 'A narrow escape', 'The road ahead', 'An unexpected companion', 'The route is lost', 'A costly discovery', 'The last obstacle', 'The destination', 'The journey’s price'],
  },
  romance: {
    description: 'Bring two people together through attraction, vulnerability, and the choices that make trust possible.',
    characters: ['Lead one: What do they want, and what makes closeness difficult?', 'Lead two: What do they need that differs from what they expect?', 'Friend or confidant: What honest advice will be hard to hear?', 'Source of pressure: What keeps the leads from choosing freely?'],
    structure: ['Bring the leads together and establish the spark and the obstacle.', 'Build trust through shared moments; let a fear or misunderstanding test it.', 'Make the leads choose what they are willing to risk for a future together.'],
    chapters: ['The first impression', 'A reason to meet again', 'An unexpected connection', 'A moment of honesty', 'The obstacle grows', 'A step closer', 'The rupture', 'A choice made freely', 'A hopeful beginning'],
  },
  'science-fiction': {
    description: 'Explore how a scientific or technological change reshapes ordinary lives and forces a hard choice.',
    characters: ['Protagonist: What do they stand to gain or lose from the new technology?', 'Collaborator: What do they understand that the protagonist does not?', 'Authority or opponent: What future are they trying to secure?', 'Affected person: Who bears the cost of the new world?'],
    structure: ['Show the speculative idea through a human-scale problem.', 'Reveal its wider consequences as the protagonist investigates or acts.', 'Resolve the central dilemma and show what the new future asks of people.'],
    chapters: ['A changed ordinary day', 'The system fails', 'A hidden consequence', 'The investigation begins', 'A new rule is uncovered', 'The cost becomes personal', 'The point of no return', 'A future chosen', 'What remains'],
  },
  'general-fiction': {
    description: 'Shape a character-driven story around a desire, a pressure, and a meaningful change.',
    characters: ['Protagonist: What do they want right now?', 'Important person: What do they need from the protagonist?', 'Complication: Who or what challenges the protagonist’s assumptions?', 'Support: Who sees the protagonist clearly?'],
    structure: ['Establish the everyday life and introduce a change that cannot be ignored.', 'Put relationships and choices under pressure; let the protagonist adapt.', 'Bring the central choice to a head and show what is different afterward.'],
    chapters: ['Before things shift', 'The change arrives', 'A first response', 'A relationship tested', 'An unexpected truth', 'The difficult choice', 'A turning point', 'What is said or done', 'A new ordinary'],
  },
};

function parseStoryList(value, max, itemMax) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return [...new Set(list.map((item) => String(item).trim().slice(0, itemMax)).filter(Boolean))].slice(0, max);
}

function normalizeStoryNotes(value) {
  let list = value;
  if (typeof list === 'string') {
    try { list = JSON.parse(list || '[]'); } catch { return []; }
  }
  if (!Array.isArray(list)) return [];
  return list.slice(0, 100).filter((item) => item && typeof item === 'object')
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id.slice(0, 100) : createId(),
      text: typeof item.text === 'string' ? item.text.trim().slice(0, 300) : '',
      quote: typeof item.quote === 'string' ? item.quote.trim().slice(0, 240) : '',
      chapter: typeof item.chapter === 'string' ? item.chapter.trim().slice(0, 100) : '',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt.slice(0, 40) : '',
    })).filter((item) => item.text);
}

function normalizeStoryTodos(value) {
  let list = value;
  if (typeof list === 'string') {
    try { list = JSON.parse(list || '[]'); } catch { return []; }
  }
  if (!Array.isArray(list)) return [];
  return list.slice(0, 100).filter((item) => item && typeof item === 'object')
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id.slice(0, 100) : createId(),
      text: typeof item.text === 'string' ? item.text.trim().slice(0, 160) : '',
      done: item.done === true,
    })).filter((item) => item.text);
}

function normalizeStoryChapterMeta(value) {
  let list = value;
  if (typeof list === 'string') {
    try { list = JSON.parse(list || '[]'); } catch { return []; }
  }
  if (!Array.isArray(list)) return [];
  return list.slice(0, 200).filter((item) => item && typeof item === 'object')
    .map((item) => ({
      title: typeof item.title === 'string' ? item.title.trim().slice(0, 100) : '',
      summary: typeof item.summary === 'string' ? item.summary.trim().slice(0, 500) : '',
      status: ['draft', 'revising', 'completed'].includes(item.status) ? item.status : 'draft',
      povCharacterId: typeof item.povCharacterId === 'string' ? item.povCharacterId.slice(0, 100) : '',
      timelinePoint: typeof item.timelinePoint === 'string' ? item.timelinePoint.trim().slice(0, 60) : '',
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt.slice(0, 40) : '',
    })).filter((item) => item.title);
}

function normalizeStoryMeta(record = {}) {
  let chapterPlaceSource = record.chapterPlaces;
  if (typeof chapterPlaceSource === 'string') {
    try { chapterPlaceSource = JSON.parse(chapterPlaceSource || '[]'); } catch { chapterPlaceSource = []; }
  }
  const chapterPlaces = Array.isArray(chapterPlaceSource) ? chapterPlaceSource.slice(0, 100)
    .filter((item) => item && typeof item.chapter === 'string' && typeof item.placeId === 'string')
    .map((item) => ({ chapter: item.chapter.trim().slice(0, 100), placeId: item.placeId.trim().slice(0, 100) }))
    .filter((item) => item.chapter && item.placeId) : [];
  const wordGoal = Number(record.wordGoal);
  const seriesOrder = Number(record.seriesOrder);
  return {
    kind: STORY_KINDS[record.kind] ? record.kind : 'story',
    progress: STORY_PROGRESS[record.progress] ? record.progress : 'drafting',
    wordGoal: Number.isFinite(wordGoal) && wordGoal >= 100
      ? Math.min(1_000_000, Math.round(wordGoal / 100) * 100) : 50_000,
    seriesId: typeof record.seriesId === 'string' ? record.seriesId.slice(0, 100) : '',
    seriesOrder: Number.isFinite(seriesOrder) && seriesOrder >= 1
      ? Math.min(1000, Math.round(seriesOrder)) : 1,
    summary: typeof record.summary === 'string' ? record.summary.trim().slice(0, 240) : '',
    setting: typeof record.setting === 'string' ? record.setting.trim().slice(0, 160) : '',
    tags: parseStoryList(record.tags, 12, 24),
    characterIds: parseStoryList(record.characterIds, 40, 100),
    placeIds: parseStoryList(record.placeIds, 60, 100),
    chapterPlaces,
    chapterMeta: normalizeStoryChapterMeta(record.chapterMeta),
    notes: normalizeStoryNotes(record.notes),
    todos: normalizeStoryTodos(record.todos),
  };
}

function storyMetaEqual(a, b) {
  const sorted = (list) => JSON.stringify([...(list || [])].sort());
  return a.kind === b.kind && a.progress === b.progress && a.wordGoal === b.wordGoal
    && a.seriesId === b.seriesId && a.seriesOrder === b.seriesOrder && a.summary === b.summary
    && a.setting === b.setting && sorted(a.tags) === sorted(b.tags)
    && sorted(a.characterIds) === sorted(b.characterIds)
    && sorted(a.placeIds) === sorted(b.placeIds)
    && JSON.stringify(a.chapterPlaces) === JSON.stringify(b.chapterPlaces)
    && JSON.stringify(a.chapterMeta) === JSON.stringify(b.chapterMeta)
    && JSON.stringify(a.notes) === JSON.stringify(b.notes)
    && JSON.stringify(a.todos) === JSON.stringify(b.todos);
}

function storyCharacterNames(story) {
  return (story?.characterIds || [])
    .map((id) => characters.find((character) => character.id === id)?.name)
    .filter(Boolean);
}

function storyPlaceNames(story) {
  return (story?.placeIds || [])
    .map((id) => places.find((place) => place.id === id)?.name)
    .filter(Boolean);
}

const STORY_VERSIONS_KEY = 'FictionTales.story-versions.v1';
const MAX_STORY_VERSIONS = 10;
const CHAPTER_PATTERN = /^(?:#{1,2}[ \t]+\S.*|Chapter[ \t]+\d+\b.*)$/i;

function normalizeStoryVersions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  Object.entries(value).forEach(([id, list]) => {
    if (!id || !Array.isArray(list)) return;
    const versions = list
      .filter((item) => item && typeof item === 'object' && typeof item.text === 'string')
      .map((item) => ({
        at: typeof item.at === 'string' ? item.at : '',
        title: typeof item.title === 'string' ? item.title.slice(0, 100) : '',
        text: item.text.slice(0, 30000),
        label: typeof item.label === 'string' ? item.label.slice(0, 40) : '',
      }))
      .slice(0, MAX_STORY_VERSIONS);
    if (versions.length) result[id] = versions;
  });
  return result;
}

function countWords(text) {
  const trimmed = (text || '').trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function countStoryGoalWords(text = '') {
  return countWords(text.split('\n').filter((line) => !CHAPTER_PATTERN.test(line)).join('\n'));
}

function parseStoryChapters(text) {
  const chapters = [];
  let offset = 0;
  text.split('\n').forEach((line) => {
    if (CHAPTER_PATTERN.test(line)) {
      chapters.push({ title: line.replace(/^#{1,2}[ \t]+/, '').trim(), start: offset, headingLength: line.length });
    }
    offset += line.length + 1;
  });
  chapters.forEach((chapter, index) => {
    chapter.end = index + 1 < chapters.length ? chapters[index + 1].start : text.length;
    chapter.words = countWords(text.slice(chapter.start + chapter.headingLength, chapter.end));
  });
  return chapters;
}

function appendInlineMarkdown(parent, text) {
  const markdownPattern = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;
  const mentions = findCharacterMentions(text);
  const tokens = [];
  for (const match of text.matchAll(markdownPattern)) {
    tokens.push({ start: match.index, end: match.index + match[0].length, kind: 'markdown', text: match[0] });
  }
  mentions.forEach((mention) => tokens.push({ start: mention.start, end: mention.end, kind: 'mention', text: mention.text, character: mention.character }));
  tokens.sort((a, b) => a.start - b.start || b.end - a.end);
  let last = 0;
  for (const token of tokens) {
    if (token.start < last) continue;
    if (token.start > last) parent.append(text.slice(last, token.start));
    if (token.kind === 'mention') {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'story-character-mention';
      link.dataset.characterId = token.character.id;
      link.textContent = token.text;
      parent.append(link);
    } else {
      const element = document.createElement(token.text.startsWith('**') ? 'strong' : 'em');
      element.textContent = token.text.replace(/^\*+|\*+$/g, '');
      parent.append(element);
    }
    last = token.end;
  }
  if (last < text.length) parent.append(text.slice(last));
}

function findCharacterMentions(text) {
  const matches = [];
  const orderedCharacters = [...characters].sort((a, b) => b.name.length - a.name.length);
  orderedCharacters.forEach((character) => {
    const expression = new RegExp(`@${character.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`, 'gi');
    let match;
    while ((match = expression.exec(text))) {
      if (match.index > 0 && /[\w@]/.test(text[match.index - 1])) continue;
      if (matches.some((item) => item.start < match.index + match[0].length && match.index < item.end)) continue;
      matches.push({ start: match.index, end: match.index + match[0].length, text: match[0], character });
    }
  });
  return matches.sort((a, b) => a.start - b.start);
}

function renderStoryMarkdown(container, rawText) {
  container.replaceChildren();
  const lines = (rawText || '').replace(/\r\n/g, '\n').split('\n');
  const chapterHeadings = [];
  let paragraph = [];
  let quote = [];
  let list = null;
  const flushParagraph = () => {
    if (!paragraph.length) return;
    const element = document.createElement('p');
    paragraph.forEach((line, index) => {
      if (index) element.append(document.createElement('br'));
      appendInlineMarkdown(element, line);
    });
    container.append(element);
    paragraph = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    const element = document.createElement('blockquote');
    quote.forEach((line, index) => {
      if (index) element.append(document.createElement('br'));
      appendInlineMarkdown(element, line);
    });
    container.append(element);
    quote = [];
  };
  const flushList = () => { list = null; };
  const flushAll = () => { flushParagraph(); flushQuote(); flushList(); };
  lines.forEach((line) => {
    const markdownHeading = line.match(/^(#{1,3})[ \t]+(\S.*)$/);
    const plainChapterHeading = line.match(/^(Chapter[ \t]+\d+\b.*)$/i);
    const heading = markdownHeading || (plainChapterHeading
      ? [plainChapterHeading[0], '##', plainChapterHeading[1]]
      : null);
    if (!line.trim()) { flushAll(); return; }
    if (heading) {
      flushAll();
      const level = heading[1].length;
      const element = document.createElement(level === 3 ? 'h3' : 'h2');
      appendInlineMarkdown(element, heading[2].trim());
      container.append(element);
      if (level < 3) chapterHeadings.push({ title: heading[2].trim(), element });
      return;
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      flushAll();
      const rule = document.createElement('hr');
      rule.className = 'story-scene-break';
      container.append(rule);
      return;
    }
    const quoted = line.match(/^>[ \t]?(.*)$/);
    if (quoted) { flushParagraph(); flushList(); quote.push(quoted[1]); return; }
    const bullet = line.match(/^[-*][ \t]+(\S.*)$/);
    if (bullet) {
      flushParagraph(); flushQuote();
      if (!list) { list = document.createElement('ul'); container.append(list); }
      const item = document.createElement('li');
      appendInlineMarkdown(item, bullet[1]);
      list.append(item);
      return;
    }
    flushQuote(); flushList();
    paragraph.push(line);
  });
  flushAll();
  if (chapterHeadings.length >= 2) {
    const nav = document.createElement('nav');
    nav.className = 'story-toc';
    nav.setAttribute('aria-label', 'Chapters');
    const heading = document.createElement('p');
    heading.className = 'story-toc-title';
    heading.textContent = 'Chapters';
    const ol = document.createElement('ol');
    chapterHeadings.forEach(({ title, element }) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = title;
      button.addEventListener('click', () => {
        element.scrollIntoView({ behavior: getMotionScrollBehavior(), block: 'start' });
      });
      li.append(button);
      ol.append(li);
    });
    nav.append(heading, ol);
    container.prepend(nav);
  }
}

const storedStories = readStorage(STORIES_STORAGE_KEY, null);
let savedStories = normalizeStories(storedStories);
const storyDrafts = normalizeStoryDrafts(readStorage(STORY_DRAFTS_KEY, {}));
function normalizeDialogueDrafts(value) {
  const entries = Array.isArray(value) ? value.map((draft) => [draft?.id, draft])
    : value && typeof value === 'object' ? Object.entries(value) : [];
  return Object.fromEntries(entries.flatMap(([key, draft]) => {
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return [];
    const id = typeof draft.id === 'string' && draft.id.trim() ? draft.id.trim().slice(0, 100)
      : typeof key === 'string' && key ? key.slice(0, 100) : createId();
    return [[id, {
      id,
      title: String(draft.title || '').slice(0, 100),
      participantIds: [...new Set((Array.isArray(draft.participantIds) ? draft.participantIds : [])
        .filter((participantId) => typeof participantId === 'string' && participantId)
        .map((participantId) => participantId.slice(0, 100)))].slice(0, 30),
      context: String(draft.context || '').slice(0, 700),
      text: String(draft.text || '').slice(0, 15000),
      storyId: typeof draft.storyId === 'string' ? draft.storyId.slice(0, 100) : '',
      updatedAt: typeof draft.updatedAt === 'string' ? draft.updatedAt.slice(0, 40) : '',
    }]];
  }));
}
const dialogueDrafts = normalizeDialogueDrafts(readStorage(DIALOGUE_DRAFTS_KEY, {}));
const storyVersions = normalizeStoryVersions(readStorage(STORY_VERSIONS_KEY, {}));
const writingGoals = normalizeWritingGoals(readStorage(WRITING_GOALS_KEY, {}));
let lastStoryWordCount = 0;

const CHARACTER_VERSIONS_KEY = 'FictionTales.character-versions.v1';
const CHARACTER_SNAPSHOT_FIELDS = [
  'name', 'role', 'pronouns', 'age', 'species', 'description', 'traits', 'story', 'relations', 'links',
  'worlds', 'stats', 'groups', 'goal', 'fear', 'secret', 'flaw', 'voice', 'voiceSamples', 'appearance',
  'questionnaire', 'bonds', 'timeline', 'arcStart', 'arcTurningPoint', 'arcEnd', 'snapshots', 'customSections',
];
const CHARACTER_QUESTIONNAIRE = [
  'What do you want people to notice about you?',
  'What do you hope they never notice?',
  'What do you want most right now?',
  'What would you refuse to do, even for what you want?',
  'What do you envy in other people?',
  'What small thing reliably makes your day better?',
  'What kind of person do you trust quickly?',
  'What kind of person do you distrust on sight?',
  'When did you last change your mind about something important?',
  'What do you do when you are frightened?',
  'What do you do when you are angry?',
  'What do you do when you are embarrassed?',
  'What is something you are proud of but rarely mention?',
  'What do you misunderstand about yourself?',
  'What do you misunderstand about someone you love?',
  'What would make you leave home and not look back?',
  'What promise would be hardest for you to keep?',
  'What is your most unreasonable opinion?',
  'What do you sound like when you are trying to impress someone?',
  'What truth would change your life if you finally accepted it?',
];
const CHARACTER_PROMPTS = {
  goal: ['What does {name} want more than anything, and what would they give up to get it?', 'What is {name} working toward that nobody else knows about?', 'If {name} could change one thing about their life tomorrow, what would it be?'],
  fear: ['What is {name} most afraid of, and when did that fear begin?', 'What situation makes {name} go quiet or run?', 'What would {name} never admit scares them?'],
  secret: ['What is {name} hiding, and who would be hurt if it came out?', 'What did {name} do once that they have never told anyone?', 'Who does {name} pretend not to know?'],
  flaw: ['What habit keeps getting {name} into trouble?', 'Where does {name}’s greatest strength turn into a weakness?', 'What does {name} refuse to learn, no matter how many times life teaches it?'],
  story: ['Describe the moment that made {name} who they are today.', 'Where did {name} grow up, and what did they leave behind?', 'Who raised {name}, and what did that person get wrong?'],
  voice: ['What is something {name} says all the time, without noticing?', 'How does {name} sound when they are lying?', 'What would {name} say to a stranger in the first ten seconds?'],
  appearance: ['What is the first thing people notice about {name}, and what do they miss?', 'What does {name} always wear or carry, and why?', 'What scar, mark, or habit hints at {name}’s past?'],
  description: ['How would {name}’s best friend describe them in one sentence?', 'What impression does {name} give on first meeting, and how is it wrong?'],
};

function parseCharacterQuestionnaire(value) {
  let entries = value;
  if (typeof entries === 'string') {
    try {
      entries = JSON.parse(entries || '[]');
    } catch {
      return [];
    }
  }
  if (!Array.isArray(entries)) return [];
  const seen = new Set();
  return entries.filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      question: String(entry.question || '').trim().slice(0, 180),
      answer: String(entry.answer || '').trim().slice(0, 600),
    }))
    .filter((entry) => {
      if (!entry.question || !entry.answer || seen.has(entry.question)) return false;
      seen.add(entry.question);
      return true;
    }).slice(0, CHARACTER_QUESTIONNAIRE.length);
}

function serializeCharacterQuestionnaire(value) {
  const entries = parseCharacterQuestionnaire(value);
  return entries.length ? JSON.stringify(entries) : '';
}

function renderCharacterQuestionnaireEditor() {
  const entries = parseCharacterQuestionnaire(document.querySelector('#questionnaire').value);
  const questionSelect = document.querySelector('#questionnaire-question');
  const answered = new Set(entries.map((entry) => entry.question));
  questionSelect.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = answered.size === CHARACTER_QUESTIONNAIRE.length ? 'All 20 questions answered' : 'Choose a question…';
  questionSelect.append(placeholder);
  CHARACTER_QUESTIONNAIRE.filter((question) => !answered.has(question)).forEach((question) => {
    const option = document.createElement('option');
    option.value = question;
    option.textContent = question;
    questionSelect.append(option);
  });
  questionSelect.disabled = answered.size >= CHARACTER_QUESTIONNAIRE.length;
  document.querySelector('#questionnaire-count').textContent = entries.length ? `${entries.length} answered` : 'None answered';
  const list = document.querySelector('#questionnaire-list');
  list.replaceChildren();
  entries.forEach((entry, index) => {
    const row = document.createElement('li');
    const content = document.createElement('div');
    const question = document.createElement('strong');
    question.textContent = entry.question;
    const answer = document.createElement('p');
    answer.textContent = entry.answer;
    content.append(question, answer);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'button button-quiet';
    remove.setAttribute('aria-label', `Remove answer ${index + 1}`);
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      entries.splice(index, 1);
      document.querySelector('#questionnaire').value = serializeCharacterQuestionnaire(entries);
      renderCharacterQuestionnaireEditor();
      characterFormHasChanges = true;
      updatePreview();
      saveDraft();
    });
    row.append(content, remove);
    list.append(row);
  });
}

function addCharacterQuestionnaireAnswer() {
  const question = document.querySelector('#questionnaire-question').value;
  const answerField = document.querySelector('#questionnaire-answer');
  const answer = answerField.value.trim();
  if (!question) {
    showToast('Choose a question first.');
    document.querySelector('#questionnaire-question').focus();
    return;
  }
  if (!answer) {
    showToast('Add an answer before keeping it.');
    answerField.focus();
    return;
  }
  const entries = parseCharacterQuestionnaire(document.querySelector('#questionnaire').value);
  if (entries.length >= CHARACTER_QUESTIONNAIRE.length) {
    showToast('The questionnaire has 20 prompts.');
    return;
  }
  entries.push({ question, answer });
  document.querySelector('#questionnaire').value = serializeCharacterQuestionnaire(entries);
  answerField.value = '';
  renderCharacterQuestionnaireEditor();
  characterFormHasChanges = true;
  updatePreview();
  saveDraft();
}

function normalizeCharacterVersions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  Object.entries(value).forEach(([id, list]) => {
    if (!id || !Array.isArray(list)) return;
    const versions = list.filter((item) => item && typeof item === 'object' && item.data && typeof item.data === 'object')
      .map((item) => {
        const data = {};
        CHARACTER_SNAPSHOT_FIELDS.forEach((key) => {
          const raw = item.data[key];
          data[key] = Array.isArray(raw)
            ? raw.map((entry) => String(entry).slice(0, 60)).slice(0, 30)
            : String(raw ?? '').slice(0, key === 'bonds' ? 500000 : key === 'snapshots' ? 50000 : 30000);
        });
        return {
          at: typeof item.at === 'string' ? item.at : '',
          label: typeof item.label === 'string' ? item.label.slice(0, 40) : '',
          data,
        };
      }).slice(0, 10);
    if (versions.length) result[id] = versions;
  });
  return result;
}

const characterVersions = normalizeCharacterVersions(readStorage(CHARACTER_VERSIONS_KEY, {}));

const PLACES_STORAGE_KEY = 'FictionTales.places.v1';
const PLACE_DRAFT_KEY = 'FictionTales.place-draft.v1';
const WORLD_ENTRIES_STORAGE_KEY = 'FictionTales.world-entries.v1';
const WORLD_ENTRY_CATEGORIES = {
  faction: 'Faction or organization',
  artifact: 'Item or artifact',
  system: 'Magic or technology system',
  species: 'Species',
  language: 'Language',
  religion: 'Religion or belief system',
  glossary: 'Glossary term',
  other: 'Other',
};
const PLACE_KINDS = {
  region: 'Region or realm', city: 'City or town', building: 'Building',
  landmark: 'Landmark', wild: 'Wilderness', other: 'Other',
};
const CUSTOM_SUGGESTIONS = ['Weapons', 'Home town', 'Hobbies', 'Favorites', 'Quotes', 'Theme song'];

function normalizePlace(record) {
  if (!record || typeof record !== 'object') return null;
  const text = (value, limit) => (typeof value === 'string' ? value.trim().slice(0, limit) : '');
  const name = text(record.name, 80);
  if (!name) return null;
  const image = text(record.image, MAX_IMAGE_DATA_URL_LENGTH);
  return {
    id: text(record.id, 100) || createId(),
    name,
    kind: PLACE_KINDS[record.kind] ? record.kind : 'other',
    partOf: text(record.partOf, 80),
    summary: text(record.summary, 240),
    description: text(record.description, 8000),
    lore: text(record.lore, 30000),
    atmosphere: text(record.atmosphere, 400),
    notes: text(record.notes, 4000),
    tags: parseStoryList(record.tags, 12, 24),
    characterIds: parseStoryList(record.characterIds, 60, 100),
    image: image.length <= MAX_IMAGE_DATA_URL_LENGTH && validImageSource(image) ? image : '',
    updatedAt: text(record.updatedAt, 40),
  };
}

const places = (Array.isArray(readStorage(PLACES_STORAGE_KEY, [])) ? readStorage(PLACES_STORAGE_KEY, []) : [])
  .map(normalizePlace).filter(Boolean);
function normalizeBookSeries(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).filter((series) => series && typeof series === 'object')
    .map((series) => {
      const name = typeof series.name === 'string' ? series.name.trim().slice(0, 100) : '';
      if (!name) return null;
      const events = Array.isArray(series.events) ? series.events.slice(0, 500)
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          id: typeof item.id === 'string' && item.id ? item.id.slice(0, 100) : createId(),
          title: typeof item.title === 'string' ? item.title.trim().slice(0, 120) : '',
          bookId: typeof item.bookId === 'string' ? item.bookId.slice(0, 100) : '',
          chapter: typeof item.chapter === 'string' ? item.chapter.trim().slice(0, 100) : '',
          description: typeof item.description === 'string' ? item.description.trim().slice(0, 500) : '',
        })).filter((item) => item.title) : [];
      return {
        id: typeof series.id === 'string' && series.id ? series.id.slice(0, 100) : createId(),
        name,
        summary: typeof series.summary === 'string' ? series.summary.trim().slice(0, 500) : '',
        characterIds: parseStoryList(series.characterIds, 100, 100),
        placeIds: parseStoryList(series.placeIds, 100, 100),
        events,
        updatedAt: typeof series.updatedAt === 'string' ? series.updatedAt.slice(0, 40) : '',
      };
    }).filter(Boolean);
}
let bookSeries = normalizeBookSeries(readStorage(SERIES_STORAGE_KEY, []));
function normalizeWorldEntry(record) {
  if (!record || typeof record !== 'object') return null;
  const text = (value, limit) => (typeof value === 'string' ? value.trim().slice(0, limit) : '');
  const name = text(record.name, 100);
  if (!name) return null;
  return {
    id: text(record.id, 100) || createId(),
    name,
    category: WORLD_ENTRY_CATEGORIES[record.category] ? record.category : 'other',
    summary: text(record.summary, 240),
    description: text(record.description, 8000),
    details: text(record.details, 12000),
    tags: parseStoryList(record.tags, 12, 24),
    updatedAt: text(record.updatedAt, 40),
  };
}
const worldEntries = (Array.isArray(readStorage(WORLD_ENTRIES_STORAGE_KEY, [])) ? readStorage(WORLD_ENTRIES_STORAGE_KEY, []) : [])
  .map(normalizeWorldEntry).filter(Boolean);
const RECENTLY_DELETED_KINDS = new Set(['character', 'story', 'place', 'world-entry']);
function normalizeRecentlyDeleted(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 1000).filter((entry) => entry && typeof entry === 'object'
    && RECENTLY_DELETED_KINDS.has(entry.kind) && entry.record && typeof entry.record === 'object')
    .map((entry) => {
      const record = entry.kind === 'character' ? normalizeCharacter(entry.record)
        : entry.kind === 'story' ? normalizeImportedStory(entry.record, entry.record.isDraft === true)
          : entry.kind === 'place' ? normalizePlace(entry.record)
            : normalizeWorldEntry(entry.record);
      if (!record) return null;
      return {
        id: typeof entry.id === 'string' && entry.id ? entry.id.slice(0, 100) : createId(),
        kind: entry.kind,
        deletedAt: typeof entry.deletedAt === 'string' ? entry.deletedAt.slice(0, 40) : '',
        record,
        related: entry.related && typeof entry.related === 'object' && !Array.isArray(entry.related) ? entry.related : {},
      };
    }).filter(Boolean);
}
let recentlyDeleted = normalizeRecentlyDeleted(readStorage(RECENTLY_DELETED_KEY, []));
window.FictionTalesData = {
  get characters() { return characters; },
  get savedStories() { return savedStories; },
  get allStories() { return [...savedStories, ...Object.values(storyDrafts).filter((draft) => !savedStories.some((story) => story.id === draft.id))]; },
  get places() { return places; },
  get bookSeries() { return bookSeries; },
  get worldEntries() { return worldEntries; },
  get recentlyDeleted() { return recentlyDeleted; },
  parseBonds,
  parseCharacterSnapshots,
  recordCharacterRelationshipEvent,
  parseTimeline,
  writeStorage,
  showToast,
  scheduleFolderBackup,
};
const storedPlaceDrafts = readStorage(PLACE_DRAFT_KEY, {});
const placeDrafts = {};
const storedPlaceDraftRecords = Array.isArray(storedPlaceDrafts) ? storedPlaceDrafts
  : storedPlaceDrafts && typeof storedPlaceDrafts === 'object' && typeof storedPlaceDrafts.id === 'string'
    ? [storedPlaceDrafts] : Object.values(storedPlaceDrafts || {});
storedPlaceDraftRecords.forEach((draft) => {
  if (!draft || typeof draft !== 'object') return;
  const normalized = normalizePlace({ ...draft, name: draft.name || 'Untitled place' });
  if (normalized) placeDrafts[normalized.id] = { ...normalized, name: typeof draft.name === 'string' ? draft.name : '' };
});
let activePlaceId = '';
let placeHasChanges = false;
let placeDraftTimer = 0;
let placeDraftPending = false;
let placeReturnFocus = null;
let placeCloseTimer = null;
let activeWorldEntryId = '';
let worldEntryReturnFocus = null;
let activeStoryId = '';
let storyToResumeAfterCharacterCreate = '';
let activeStoryChapterIndex = -1;
let editingSeriesEvents = [];
let storyReturnFocus = null;
let previewStoryId = '';
let previewFromEditor = false;
let storyReaderFontSize = 19;
if (!Array.isArray(storedStories)) {
  const migratedStories = migrateLegacyLore(readStorage('FictionTales.lore.v1', null));
  if (migratedStories.length) {
    savedStories = migratedStories;
    writeStorage(STORIES_STORAGE_KEY, savedStories);
  }
}

const modalDialogs = [
  characterDialog,
  aboutDialog,
  changelogDialog,
  document.querySelector('#place-dialog'),
  document.querySelector('#world-entry-dialog'),
  document.querySelector('#entity-preview-dialog'),
  compareDialog,
  deleteDialog,
  projectDeleteDialog,
  imageCropDialog,
  document.querySelector('#story-dialog'),
];
let lockedScrollY = null;
let bodyScrollStyles = null;

function syncModalScrollLock() {
  const isModalOpen = modalDialogs.some((dialog) => dialog.open);
  if (isModalOpen && lockedScrollY === null) {
    lockedScrollY = window.scrollY;
    bodyScrollStyles = {
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      right: document.body.style.right,
      width: document.body.style.width,
    };
    document.body.style.position = 'fixed';
    document.body.style.top = `-${lockedScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
  }
  document.documentElement.classList.toggle('modal-open', isModalOpen);
  document.body.classList.toggle('modal-open', isModalOpen);
  syncToastLayer();
  if (!isModalOpen && lockedScrollY !== null) {
    const scrollY = lockedScrollY;
    const scrollBehavior = document.documentElement.style.scrollBehavior;
    Object.entries(bodyScrollStyles).forEach(([property, value]) => {
      document.body.style[property] = value;
    });
    lockedScrollY = null;
    bodyScrollStyles = null;
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, scrollY);
    document.documentElement.style.scrollBehavior = scrollBehavior;
  }
}

function hasWorkInProgress() {
  const characterDraft = readStorage(DRAFT_KEY, null);
  const hasCharacterDraft = characterDraft && typeof characterDraft === 'object'
    && Object.values(characterDraft).some((value) => (typeof value === 'string' && value.trim()) || (Array.isArray(value) && value.length));
  const storyDialog = document.querySelector('#story-dialog');
  const hasOpenStoryDraft = storyDialog.open && activeStoryId && storyDrafts[activeStoryId]
    && (storyDrafts[activeStoryId].title || storyDrafts[activeStoryId].text.trim() || storyDrafts[activeStoryId].image);
  return Boolean(hasCharacterDraft || characterFormHasChanges || hasOpenStoryDraft);
}

window.addEventListener('pagehide', () => {
  flushPendingDrafts();
  flushPlaceDraft();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushPendingDrafts();
    flushPlaceDraft();
  }
});

window.addEventListener('beforeunload', (event) => {
  flushPendingDrafts();
  flushPlaceDraft();
  if (projectNavigationPending) return;
  if (!hasWorkInProgress()) return;
  event.preventDefault();
  event.returnValue = 'You have work in progress. Reloading may discard your latest changes.';
});

modalDialogs.forEach((dialog) => dialog.addEventListener('close', syncModalScrollLock));

function normalizeImageCrop(value) {
  const parts = typeof value === 'string' ? value.split(',') : [];
  const zoom = typeof value === 'object' && value ? Number(value.zoom) : Number(parts[0]);
  const x = typeof value === 'object' && value ? Number(value.x) : Number(parts[1]);
  const y = typeof value === 'object' && value ? Number(value.y) : Number(parts[2]);
  const safeZoom = Number.isFinite(zoom) ? Math.min(3, Math.max(1, zoom)) : 1;
  const maxPan = (safeZoom - 1) * 50;
  return {
    zoom: safeZoom,
    x: Number.isFinite(x) ? Math.min(maxPan, Math.max(-maxPan, x)) : 0,
    y: Number.isFinite(y) ? Math.min(maxPan, Math.max(-maxPan, y)) : 0,
  };
}

function serializeImageCrop(crop) {
  return [crop.zoom, crop.x, crop.y].map((value) => Number(value.toFixed(2))).join(',');
}

function applyImageCrop(image, cropValue) {
  const crop = normalizeImageCrop(cropValue);
  image.style.setProperty('--image-zoom', crop.zoom);
  image.style.setProperty('--image-x', `${crop.x}%`);
  image.style.setProperty('--image-y', `${crop.y}%`);
}

function readStorage(key, fallback) {
  try {
    const value = window.FictionTaleStorage.read(key, undefined)
      ?? (key.startsWith(STORAGE_PREFIX)
        ? window.FictionTaleStorage.read(`${LEGACY_STORAGE_PREFIX}${key.slice(STORAGE_PREFIX.length)}`, undefined)
        : undefined);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function parseTimeline(value) {
  let source = value;
  if (typeof source === 'string') {
    try {
      const parsed = JSON.parse(source);
      if (Array.isArray(parsed)) source = parsed;
    } catch {
      // Older characters store timeline events as one "when|text" line per moment.
    }
  }
  const normalizeEvent = (event) => {
    if (typeof event === 'string') {
      const index = event.indexOf('|');
      return {
        when: (index < 0 ? '' : event.slice(0, index)).trim().slice(0, 24),
        text: (index < 0 ? event : event.slice(index + 1)).trim().slice(0, 200),
        knowledge: '',
      };
    }
    if (!event || typeof event !== 'object') return null;
    return {
      when: String(event.when ?? '').trim().slice(0, 24),
      text: String(event.text ?? '').trim().slice(0, 200),
      knowledge: String(event.knowledge ?? '').trim().slice(0, 400),
    };
  };
  const entries = Array.isArray(source) ? source : String(source || '').split(/\r?\n/);
  return entries.map(normalizeEvent).filter((event) => event?.text).slice(0, 40);
}

function serializeTimeline(list) {
  const events = list.map((event) => ({
    when: String(event.when || '').replace(/[\r\n|]+/g, ' ').trim().slice(0, 24),
    text: String(event.text || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200),
    knowledge: String(event.knowledge || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 400),
  })).filter((event) => event.text).slice(0, 40);
  return events.length ? JSON.stringify(events) : '';
}

function parseCharacterSnapshots(value) {
  let list = value;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list || '[]');
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list.slice(0, 40).filter((snapshot) => snapshot && typeof snapshot === 'object').map((snapshot) => ({
    when: String(snapshot.when ?? '').trim().slice(0, 60),
    appearance: String(snapshot.appearance ?? '').trim().slice(0, 300),
    knowledge: String(snapshot.knowledge ?? '').trim().slice(0, 400),
    trust: String(snapshot.trust ?? '').trim().slice(0, 300),
    location: String(snapshot.location ?? '').trim().slice(0, 120),
    age: String(snapshot.age ?? '').trim().slice(0, 24),
    availability: ['present', 'absent', 'dead'].includes(snapshot.availability) ? snapshot.availability : '',
  })).filter((snapshot) => snapshot.when || snapshot.appearance || snapshot.knowledge || snapshot.trust || snapshot.location || snapshot.age || snapshot.availability);
}

function serializeCharacterSnapshots(list) {
  const snapshots = parseCharacterSnapshots(list);
  return snapshots.length ? JSON.stringify(snapshots) : '';
}

function setCharacterSnapshots(list, focusIndex = -1) {
  document.querySelector('#snapshots').value = serializeCharacterSnapshots(list);
  characterFormHasChanges = true;
  renderCharacterSnapshotsEditor(focusIndex);
  updatePreview();
  saveDraft();
}

function renderCharacterSnapshotsEditor(focusIndex = -1) {
  const snapshots = parseCharacterSnapshots(document.querySelector('#snapshots').value);
  const list = document.querySelector('#snapshot-list');
  list.replaceChildren();
  snapshots.forEach((snapshot, index) => {
    const row = document.createElement('li');
    const summary = document.createElement('span');
    summary.textContent = [
      snapshot.when,
      snapshot.appearance && `Appearance: ${snapshot.appearance}`,
      snapshot.knowledge && `Knows: ${snapshot.knowledge}`,
      snapshot.trust && `Trusts: ${snapshot.trust}`,
      snapshot.location && `At: ${snapshot.location}`,
      snapshot.age && `Age: ${snapshot.age}`,
      snapshot.availability && `Availability: ${snapshot.availability}`,
    ].filter(Boolean).join(' · ');
    summary.title = summary.textContent;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove snapshot ${snapshot.when || index + 1}`);
    remove.addEventListener('click', () => setCharacterSnapshots(snapshots.filter((_, position) => position !== index)));
    row.append(summary, remove);
    list.append(row);
  });
  if (focusIndex >= 0) document.querySelector('#snapshot-when').focus();
}

function setTimeline(list) {
  document.querySelector('#timeline').value = serializeTimeline(list);
  characterFormHasChanges = true;
  renderTimelineEditor();
  updatePreview();
  saveDraft();
}

function renderTimelineEditor() {
  const events = parseTimeline(document.querySelector('#timeline').value);
  const list = document.querySelector('#timeline-list');
  list.replaceChildren();
  events.forEach((event, index) => {
    const row = document.createElement('li');
    const when = document.createElement('strong');
    when.textContent = event.when || '—';
    const text = document.createElement('span');
    text.textContent = event.text;
    text.title = event.text;
    const knowledge = document.createElement('span');
    knowledge.className = 'timeline-event-knowledge';
    if (event.knowledge) knowledge.textContent = `Knows: ${event.knowledge}`;
    const makeButton = (label, aria, handler, disabled = false) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.disabled = disabled;
      button.setAttribute('aria-label', aria);
      button.addEventListener('click', handler);
      return button;
    };
    const move = (direction) => {
      const next = [...events];
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      setTimeline(next);
    };
    row.append(
      when, text,
      ...(event.knowledge ? [knowledge] : []),
      makeButton('↑', `Move “${event.text}” earlier`, () => move(-1), index === 0),
      makeButton('↓', `Move “${event.text}” later`, () => move(1), index === events.length - 1),
      makeButton('×', `Remove “${event.text}”`, () => setTimeline(events.filter((_, position) => position !== index))),
    );
    list.append(row);
  });
}

function addTimelineEvent() {
  const whenInput = document.querySelector('#timeline-when');
  const textInput = document.querySelector('#timeline-text');
  const knowledgeInput = document.querySelector('#timeline-knowledge');
  if (!textInput.value.trim()) {
    showToast('Describe what happened first.');
    textInput.focus();
    return;
  }
  const events = parseTimeline(document.querySelector('#timeline').value);
  if (events.length >= 40) {
    showToast('A timeline can hold up to 40 moments.');
    return;
  }
  events.push({ when: whenInput.value.trim(), text: textInput.value.trim(), knowledge: knowledgeInput.value.trim() });
  whenInput.value = '';
  textInput.value = '';
  knowledgeInput.value = '';
  setTimeline(events);
  whenInput.focus();
}

function renderProfileTimeline(profile) {
  const list = document.querySelector('#profile-timeline');
  list.replaceChildren();
  const events = parseTimeline(profile.timeline);
  if (!events.length) {
    setProfileSectionVisible(list, false);
    return;
  }
  setProfileSectionVisible(list, true);
  events.forEach((event) => {
    const item = document.createElement('li');
    const when = document.createElement('span');
    when.className = 'profile-timeline-when';
    when.textContent = event.when || '·';
    const text = document.createElement('p');
    text.textContent = event.text;
    item.append(when, text);
    if (event.knowledge) {
      const knowledge = document.createElement('p');
      knowledge.className = 'profile-timeline-knowledge';
      knowledge.textContent = `Knows: ${event.knowledge}`;
      item.append(knowledge);
    }
    list.append(item);
  });
}

function renderProfileArc(profile) {
  const container = document.querySelector('#profile-arc');
  container.replaceChildren();
  const list = document.createElement('dl');
  list.className = 'profile-depth';
  [
    ['Starting belief', profile.arcStart],
    ['Turning point', profile.arcTurningPoint],
    ['Learned truth', profile.arcEnd],
  ].filter(([, value]) => value).forEach(([label, value]) => {
    const item = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    detail.textContent = value;
    item.append(term, detail);
    list.append(item);
  });
  if (list.childElementCount) {
    container.append(list);
  }
  setProfileSectionVisible(container, Boolean(list.childElementCount));
}

function renderProfileSnapshots(profile) {
  const list = document.querySelector('#profile-snapshots');
  list.replaceChildren();
  const snapshots = parseCharacterSnapshots(profile.snapshots);
  if (!snapshots.length) {
    setProfileSectionVisible(list, false);
    return;
  }
  setProfileSectionVisible(list, true);
  snapshots.forEach((snapshot) => {
    const item = document.createElement('li');
    const when = document.createElement('span');
    when.className = 'profile-timeline-when';
    when.textContent = snapshot.when || 'Snapshot';
    item.append(when);
    [
      ['Appearance', snapshot.appearance],
      ['Knows', snapshot.knowledge],
      ['Trusts', snapshot.trust],
      ['At', snapshot.location],
      ['Age', snapshot.age],
      ['Availability', snapshot.availability],
    ].filter(([, value]) => value).forEach(([label, value]) => {
      const detail = document.createElement('p');
      detail.textContent = `${label}: ${value}`;
      item.append(detail);
    });
    list.append(item);
  });
}

function characterSnapshot(profile) {
  const snapshot = {};
  CHARACTER_SNAPSHOT_FIELDS.forEach((key) => {
    const value = profile[key];
    snapshot[key] = Array.isArray(value) ? [...value] : (value ?? '');
  });
  return snapshot;
}

function recordCharacterVersion(profile, label = '') {
  if (!profile?.id) return;
  const snapshot = characterSnapshot(profile);
  const list = characterVersions[profile.id] || [];
  if (list[0] && JSON.stringify(list[0].data) === JSON.stringify(snapshot)) return;
  const entry = { at: profile.updatedAt || new Date().toISOString(), label, data: snapshot };
  characterVersions[profile.id] = [entry, ...list].slice(0, 10);
  if (!writeStorage(CHARACTER_VERSIONS_KEY, characterVersions)) {
    characterVersions[profile.id] = characterVersions[profile.id].slice(0, 3);
    if (!writeStorage(CHARACTER_VERSIONS_KEY, characterVersions)) {
      characterVersions[profile.id] = list;
      showToast('Saved, but version history is full. Older snapshots were kept as they were.');
    }
  }
}

function renderCharacterHistory() {
  const versions = (activeId && characterVersions[activeId]) || [];
  const list = document.querySelector('#character-history-list');
  list.replaceChildren();
  document.querySelector('#character-history-count').textContent = versions.length ? `${versions.length} saved` : 'None yet';
  versions.forEach((version, index) => {
    const row = document.createElement('li');
    const info = document.createElement('span');
    info.className = 'story-history-info';
    const when = document.createElement('strong');
    when.textContent = version.at
      ? new Date(version.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : 'Earlier version';
    const detail = document.createElement('span');
    detail.textContent = [version.data.name, version.label || (index === 0 ? 'Latest save' : '')].filter(Boolean).join(' · ');
    info.append(when, detail);
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'button button-quiet story-history-restore';
    restore.textContent = 'Restore';
    restore.addEventListener('click', () => restoreCharacterVersion(index));
    row.append(info, restore);
    list.append(row);
  });
}

function restoreCharacterVersion(index) {
  const version = ((activeId && characterVersions[activeId]) || [])[index];
  if (!version) return;
  const current = currentProfile();
  if (JSON.stringify(characterSnapshot(current)) === JSON.stringify(version.data)) {
    showToast('The form already has that version.');
    return;
  }
  recordCharacterVersion({ ...current, id: activeId }, 'Before restore');
  const fieldIds = { arcStart: 'arc-start', arcTurningPoint: 'arc-turning-point', arcEnd: 'arc-end' };
  fieldIds.voiceSamples = 'voice-samples';
  Object.entries(version.data).forEach(([key, value]) => {
    const field = document.getElementById(fieldIds[key] || key);
    if (field) field.value = Array.isArray(value) ? traitsValue(value) : value;
  });
  document.querySelector('#depth-details').open = Boolean(version.data.goal || version.data.fear || version.data.secret
    || version.data.flaw || version.data.voice || version.data.voiceSamples || version.data.appearance);
  document.querySelector('#questionnaire-details').open = parseCharacterQuestionnaire(version.data.questionnaire).length > 0;
  document.querySelector('#character-arc-details').open = Boolean(version.data.arcStart || version.data.arcTurningPoint || version.data.arcEnd
    || parseCharacterSnapshots(version.data.snapshots).length);
  characterFormHasChanges = true;
  renderTimelineEditor();
  renderCharacterSnapshotsEditor();
  renderCharacterQuestionnaireEditor();
  renderRelationEditors();
  updatePreview();
  saveDraft();
  showToast('Version restored in the form. Save to keep it. Portraits and images were not changed.');
}

let currentCharacterPrompt = null;
function nextCharacterPrompt() {
  const profile = currentProfile();
  const fields = Object.keys(CHARACTER_PROMPTS);
  const empty = fields.filter((key) => !profile[key]);
  const pool = empty.length ? empty : fields;
  const field = pool[Math.floor(Math.random() * pool.length)];
  const questions = CHARACTER_PROMPTS[field].filter((question) => question !== currentCharacterPrompt?.template);
  const template = questions[Math.floor(Math.random() * questions.length)] || CHARACTER_PROMPTS[field][0];
  currentCharacterPrompt = { field, template, text: template.replaceAll('{name}', profile.name || 'your character') };
  document.querySelector('#prompt-text').textContent = currentCharacterPrompt.text;
  document.querySelector('#prompt-card').classList.remove('hidden');
  document.querySelector('#prompt-spark').textContent = '✦ Another nudge';
}

function useCharacterPrompt() {
  if (!currentCharacterPrompt) return;
  const field = document.getElementById(currentCharacterPrompt.field);
  const section = field.closest('details');
  if (section) section.open = true;
  field.placeholder = currentCharacterPrompt.text;
  field.scrollIntoView({ behavior: getMotionScrollBehavior(), block: 'center' });
  field.focus({ preventScroll: true });
}

function parseCustomSections(value, keepEmpty = false) {
  let list;
  try { list = JSON.parse(value || '[]'); } catch { list = []; }
  if (!Array.isArray(list)) return [];
  const cleaned = list.filter((item) => item && typeof item === 'object').map((item) => ({
    title: String(item.title ?? '').slice(0, 40),
    text: String(item.text ?? '').slice(0, 2000),
  }));
  const result = keepEmpty ? cleaned : cleaned
    .map((item) => ({ title: item.title.trim(), text: item.text.trim() })).filter((item) => item.title || item.text);
  return result.slice(0, 12);
}

function serializeCustomSections(list) {
  return list.length ? JSON.stringify(list) : '';
}

function setCustomSections(list, focusIndex = -1) {
  document.querySelector('#customSections').value = serializeCustomSections(list);
  characterFormHasChanges = true;
  renderCustomEditor(focusIndex);
  updatePreview();
  saveDraft();
}

function renderCustomEditor(focusIndex = -1) {
  const hidden = document.querySelector('#customSections');
  const list = parseCustomSections(hidden.value, true);
  const box = document.querySelector('#custom-list');
  box.replaceChildren();
  document.querySelector('#custom-count').textContent = list.length
    ? `${list.length} section${list.length === 1 ? '' : 's'}` : 'None yet';
  document.querySelector('#custom-add').disabled = list.length >= 12;
  const suggestions = document.querySelector('#custom-suggestions');
  if (!suggestions.querySelector('button')) {
    CUSTOM_SUGGESTIONS.forEach((title) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.textContent = title;
      chip.addEventListener('click', () => {
        const current = parseCustomSections(hidden.value, true);
        if (current.length >= 12) { showToast('You can add up to 12 custom sections.'); return; }
        if (current.some((item) => item.title.trim().toLowerCase() === title.toLowerCase())) {
          showToast(`You already have a “${title}” section.`);
          return;
        }
        setCustomSections([...current, { title, text: '' }], current.length);
      });
      suggestions.append(chip);
    });
  }
  const readRows = () => [...box.querySelectorAll('.custom-row')].map((row) => ({
    title: row.querySelector('.custom-title').value.slice(0, 40),
    text: row.querySelector('.custom-text').value.slice(0, 2000),
  }));
  list.forEach((section, index) => {
    const row = document.createElement('div');
    row.className = 'custom-row';
    const head = document.createElement('div');
    head.className = 'custom-row-head';
    const title = document.createElement('input');
    title.className = 'custom-title';
    title.type = 'text';
    title.maxLength = 40;
    title.placeholder = 'Section title, e.g. Weapons';
    title.setAttribute('aria-label', `Title of custom section ${index + 1}`);
    title.value = section.title;
    const makeButton = (label, aria, handler, disabled = false) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.disabled = disabled;
      button.setAttribute('aria-label', aria);
      button.addEventListener('click', handler);
      return button;
    };
    const move = (direction) => {
      const next = readRows();
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      setCustomSections(next);
    };
    head.append(
      title,
      makeButton('↑', 'Move section up', () => move(-1), index === 0),
      makeButton('↓', 'Move section down', () => move(1), index === list.length - 1),
      makeButton('×', 'Remove section', () => setCustomSections(readRows().filter((_, position) => position !== index))),
    );
    const text = document.createElement('textarea');
    text.className = 'custom-text';
    text.maxLength = 2000;
    text.rows = 3;
    text.placeholder = 'Write anything you like…';
    text.setAttribute('aria-label', `Content of custom section ${index + 1}`);
    text.value = section.text;
    [title, text].forEach((field) => field.addEventListener('input', () => {
      hidden.value = serializeCustomSections(readRows());
    }));
    row.append(head, text);
    box.append(row);
  });
  if (focusIndex >= 0) box.querySelectorAll('.custom-title')[focusIndex]?.focus();
}

function addBlankCustomSection() {
  const current = parseCustomSections(document.querySelector('#customSections').value, true);
  if (current.length >= 12) { showToast('You can add up to 12 custom sections.'); return; }
  setCustomSections([...current, { title: '', text: '' }], current.length);
}

function renderProfileCustom(profile) {
  const box = document.querySelector('#profile-custom-sections');
  box.replaceChildren();
  parseCustomSections(profile.customSections).forEach((section) => {
    const details = document.createElement('details');
    details.className = 'profile-section';
    const summary = document.createElement('summary');
    summary.append(section.title || 'Untitled section');
    const icon = document.createElement('span');
    icon.className = 'profile-section-icon';
    icon.textContent = '⌄';
    summary.append(' ', icon);
    const body = document.createElement('div');
    body.className = 'profile-section-content';
    if (section.text) {
      const paragraph = document.createElement('p');
      paragraph.className = 'profile-custom-text';
      paragraph.textContent = section.text;
      body.append(paragraph);
    }
    details.append(summary, body);
    box.append(details);
  });
}

const liveSectionCache = new Map();

function liveTextBlock(text) {
  const paragraph = document.createElement('p');
  paragraph.className = 'live-text';
  paragraph.textContent = text;
  return paragraph;
}

function liveRowList(rows) {
  const list = document.createElement('ul');
  list.className = 'live-rows';
  rows.forEach(({ title, detail, href }) => {
    const item = document.createElement('li');
    let name;
    if (href) {
      name = document.createElement('a');
      name.href = href;
      name.target = '_blank';
      name.rel = 'noopener noreferrer';
    } else {
      name = document.createElement('strong');
    }
    name.textContent = title;
    item.append(name);
    if (detail) {
      const small = document.createElement('span');
      small.textContent = detail;
      item.append(small);
    }
    list.append(item);
  });
  return list;
}

function buildLiveSections(profile) {
  const sections = [];
  const add = (key, title, signature, build) => sections.push({ key, title, sig: JSON.stringify(signature), build });
  if (profile.story) add('story', 'Backstory', profile.story, () => liveTextBlock(profile.story));
  const depth = [['Goal', profile.goal], ['Fear', profile.fear], ['Secret', profile.secret], ['Flaw', profile.flaw],
    ['Voice', profile.voice], ['Appearance', profile.appearance]].filter(([, value]) => value);
  if (depth.length) {
    add('depth', 'Depth', depth, () => {
      const list = document.createElement('dl');
      list.className = 'live-dl';
      depth.forEach(([label, value]) => {
        const wrap = document.createElement('div');
        const term = document.createElement('dt');
        term.textContent = label;
        const detail = document.createElement('dd');
        detail.textContent = value;
        wrap.append(term, detail);
        list.append(wrap);
      });
      return list;
    });
  }
  const events = parseTimeline(profile.timeline);
  if (events.length) {
    add('timeline', 'Timeline', events, () => {
      const list = document.createElement('ol');
      list.className = 'profile-timeline';
      events.forEach((event) => {
        const item = document.createElement('li');
        const when = document.createElement('span');
        when.className = 'profile-timeline-when';
        when.textContent = event.when || '·';
        const text = document.createElement('p');
        text.textContent = event.text;
        item.append(when, text);
        if (event.knowledge) {
          const knowledge = document.createElement('p');
          knowledge.className = 'profile-timeline-knowledge';
          knowledge.textContent = `Knows: ${event.knowledge}`;
          item.append(knowledge);
        }
        list.append(item);
      });
      return list;
    });
  }
  const arc = [
    ['Starting belief', profile.arcStart],
    ['Turning point', profile.arcTurningPoint],
    ['Learned truth', profile.arcEnd],
  ].filter(([, value]) => value);
  if (arc.length) {
    add('character-arc', 'Character arc', arc, () => {
      const list = document.createElement('dl');
      list.className = 'live-dl';
      arc.forEach(([label, value]) => {
        const wrap = document.createElement('div');
        const term = document.createElement('dt');
        term.textContent = label;
        const detail = document.createElement('dd');
        detail.textContent = value;
        wrap.append(term, detail);
        list.append(wrap);
      });
      return list;
    });
  }
  const snapshots = parseCharacterSnapshots(profile.snapshots);
  if (snapshots.length) {
    add('character-snapshots', 'Snapshots', snapshots, () => {
      const list = document.createElement('ol');
      list.className = 'profile-timeline';
      snapshots.forEach((snapshot) => {
        const item = document.createElement('li');
        const when = document.createElement('span');
        when.className = 'profile-timeline-when';
        when.textContent = snapshot.when || 'Snapshot';
        item.append(when);
        [
          ['Appearance', snapshot.appearance],
          ['Knows', snapshot.knowledge],
          ['Trusts', snapshot.trust],
          ['Age', snapshot.age],
        ].filter(([, value]) => value).forEach(([label, value]) => {
          const detail = document.createElement('p');
          detail.textContent = `${label}: ${value}`;
          item.append(detail);
        });
        list.append(item);
      });
      return list;
    });
  }
  const connections = characterBonds(profile).map((bond) => ({
    title: characters.find((item) => item.id === bond.id).name,
    detail: bondDetailParts(bond).join(' · '),
  }));
  if (profile.id) {
    characters.forEach((other) => {
      if (other.id === profile.id || characterBonds(profile).some((bond) => bond.id === other.id)) return;
      const back = characterBonds(other).find((bond) => bond.id === profile.id);
      if (back) connections.push({
        title: other.name,
        detail: [
          ...bondDetailParts(back),
          `Added on ${other.name}’s profile`,
        ].join(' · '),
      });
    });
  }
  if (connections.length) add('connections', 'Connections', connections, () => liveRowList(connections));
  const stats = (profile.stats || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const index = line.indexOf(':');
    return index > 0 ? { title: line.slice(0, index).trim(), detail: line.slice(index + 1).trim() } : { title: line, detail: '' };
  });
  if (stats.length) add('stats', 'Stats', stats, () => liveRowList(stats));
  if (profile.relations) add('relations', 'Relationships', profile.relations, () => liveTextBlock(profile.relations));
  if (profile.worlds) add('worlds', 'Worlds', profile.worlds, () => liveTextBlock(profile.worlds));
  if (profile.id) {
    const linkedPlaces = places.filter((place) => place.characterIds.includes(profile.id))
      .map((place) => ({ title: place.name, detail: PLACE_KINDS[place.kind] }));
    if (linkedPlaces.length) add('places', 'Places', linkedPlaces, () => liveRowList(linkedPlaces));
    const linkedStories = savedStories.filter((story) => (story.characterIds || []).includes(profile.id))
      .map((story) => ({ title: story.title || 'Untitled story', detail: `${STORY_KINDS[story.kind] || 'Story'} · ${STORY_PROGRESS[story.progress] || 'Drafting'}` }));
    if (linkedStories.length) add('stories', 'Stories', linkedStories, () => liveRowList(linkedStories));
  }
  const links = (profile.links || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split('|').map((part) => part.trim());
    const url = parts.length > 1 ? parts.pop() : parts[0];
    return validWebUrl(url) ? { title: parts.length ? parts.join(' | ') : url, href: url } : null;
  }).filter(Boolean);
  if (links.length) add('links', 'Links', links, () => liveRowList(links));
  const gallery = (profile.gallery || '').split(/\r?\n/).map((line) => line.trim()).filter(validImageSource);
  if (gallery.length) {
    add('gallery', 'Extra images', gallery.map((line) => `${line.length}:${line.slice(0, 40)}:${line.slice(-40)}`), () => {
      const list = document.createElement('ul');
      list.className = 'live-gallery';
      gallery.forEach((line, index) => {
        const item = document.createElement('li');
        const image = document.createElement('img');
        image.alt = `Extra image ${index + 1}`;
        image.loading = 'lazy';
        image.addEventListener('error', () => item.remove());
        image.src = line;
        item.append(image);
        list.append(item);
      });
      return list;
    });
  }
  parseCustomSections(profile.customSections).forEach((section, index) => {
    add(`custom-${index}`, section.title || 'Untitled section', section, () => (
      section.text ? liveTextBlock(section.text) : document.createDocumentFragment()
    ));
  });
  return sections;
}

function renderLiveSections(profile) {
  const container = document.querySelector('#live-sections');
  const sections = buildLiveSections(profile);
  const nodes = sections.map(({ key, title, sig, build }) => {
    const cached = liveSectionCache.get(key);
    if (cached && cached.sig === sig && cached.title === title) return cached.node;
    const details = document.createElement('details');
    details.className = 'live-section';
    details.open = cached ? cached.node.open : true;
    const summary = document.createElement('summary');
    summary.textContent = title;
    const body = document.createElement('div');
    body.className = 'live-body';
    body.append(build());
    details.append(summary, body);
    liveSectionCache.set(key, { sig, title, node: details });
    return details;
  });
  [...liveSectionCache.keys()].forEach((key) => {
    if (!sections.some((section) => section.key === key)) liveSectionCache.delete(key);
  });
  if (!nodes.length) {
    const empty = document.createElement('p');
    empty.className = 'live-empty';
    empty.textContent = 'Add a backstory, goals, connections, or your own sections. They will appear here as you type.';
    nodes.push(empty);
  }
  const current = [...container.children];
  if (current.length === nodes.length && current.every((node, index) => node === nodes[index])) return;
  container.replaceChildren(...nodes);
}

function renderProfilePlaces(profile) {
  const box = document.querySelector('#profile-places');
  box.replaceChildren();
  const linked = places.filter((place) => place.characterIds.includes(profile.id));
  if (!linked.length) {
    setProfileSectionVisible(box, false);
    return;
  }
  setProfileSectionVisible(box, true);
  linked.forEach((place) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'profile-story-link';
    const name = document.createElement('strong');
    name.textContent = place.name;
    const detail = document.createElement('span');
    detail.textContent = PLACE_KINDS[place.kind] || 'Place';
    button.append(name, detail);
    button.addEventListener('click', () => {
      requestProfileClose(() => openPlaceEditor(place.id, document.querySelector('#new-place')));
    });
    box.append(button);
  });
}

/* ---------- Places ---------- */
function placeCharacterNames(place) {
  return (place.characterIds || [])
    .map((id) => characters.find((character) => character.id === id)?.name).filter(Boolean);
}

let entityPreview = null;
let entityPreviewReturnFocus = null;

function openEntityPreview(kind, record, returnFocus = document.activeElement, fromEditor = false) {
  if (!record) return;
  const isPlace = kind === 'place';
  entityPreview = { kind, id: record.id, fromEditor };
  entityPreviewReturnFocus = returnFocus;
  const setText = (selector, text) => { document.querySelector(selector).textContent = text; };
  setText('#entity-preview-label', isPlace ? 'PLACE PREVIEW' : 'WORLD ENTRY PREVIEW');
  setText('#entity-preview-kind', (isPlace ? PLACE_KINDS[record.kind] : WORLD_ENTRY_CATEGORIES[record.category]) || '');
  setText('#entity-preview-title', record.name);
  const summary = document.querySelector('#entity-preview-summary');
  summary.textContent = record.summary || '';
  summary.classList.toggle('hidden', !record.summary);
  const cover = document.querySelector('#entity-preview-cover');
  cover.classList.add('hidden');
  if (isPlace && record.image && validImageSource(record.image)) {
    cover.classList.remove('hidden');
    setImageSource(cover, record.image, () => cover.classList.add('hidden'));
  }
  const facts = [];
  if (isPlace) {
    if (record.partOf) facts.push(['Part of', record.partOf]);
    const names = placeCharacterNames(record);
    if (names.length) facts.push(['Characters', names.join(', ')]);
    const linked = savedStories.filter((story) => (story.placeIds || []).includes(record.id))
      .map((story) => story.title || 'Untitled story');
    if (linked.length) facts.push(['Appears in', linked.join(', ')]);
  }
  document.querySelector('#entity-preview-meta').replaceChildren(...facts.map(([label, value]) => {
    const row = document.createElement('p');
    row.className = 'entity-preview-fact';
    const name = document.createElement('span');
    name.className = 'entity-preview-fact-label';
    name.textContent = label;
    row.append(name, ` ${value}`);
    return row;
  }));
  const sections = isPlace
    ? [['Description', record.description], ['Lore & story', record.lore], ['Atmosphere', record.atmosphere], ['Notes', record.notes]]
    : [['Description', record.description], ['Details', record.details]];
  const body = document.querySelector('#entity-preview-body');
  body.replaceChildren(...sections.filter(([, text]) => text).map(([heading, text]) => {
    const section = document.createElement('section');
    section.className = 'entity-preview-section';
    const title = document.createElement('h2');
    title.textContent = heading;
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    section.append(title, paragraph);
    return section;
  }));
  if (!body.children.length) {
    const empty = document.createElement('p');
    empty.className = 'entity-preview-empty';
    empty.textContent = 'Nothing written yet. Edit this entry to add a description.';
    body.append(empty);
  }
  const tags = document.querySelector('#entity-preview-tags');
  tags.replaceChildren(...(record.tags || []).map((tag) => {
    const chip = document.createElement('span');
    chip.className = 'story-chip';
    chip.textContent = `#${tag}`;
    return chip;
  }));
  tags.classList.toggle('hidden', !(record.tags || []).length);
  setText('#entity-preview-edit', fromEditor ? 'Back to editing' : (isPlace ? 'Edit this place' : 'Edit this entry'));
  const dialog = document.querySelector('#entity-preview-dialog');
  if (!dialog.open) dialog.showModal();
  syncModalScrollLock();
  dialog.querySelector('.profile-scroll').scrollTop = 0;
  document.querySelector('#entity-preview-edit').focus();
}

function closeEntityPreview() {
  const dialog = document.querySelector('#entity-preview-dialog');
  if (dialog.open) dialog.close();
}

function renderPlaces() {
  const library = document.querySelector('#place-library');
  library.replaceChildren();
  const query = document.querySelector('#place-search').value.trim().toLowerCase();
  const kindFilter = document.querySelector('#place-filter-kind').value;
  const sortMode = document.querySelector('#place-sort').value;
  const items = places.filter((place) => {
    if (kindFilter && place.kind !== kindFilter) return false;
    if (!query) return true;
    return [place.name, place.summary, place.description, place.lore, place.partOf, PLACE_KINDS[place.kind],
      ...place.tags, ...placeCharacterNames(place)].join(' ').toLowerCase().includes(query);
  });
  items.sort((a, b) => {
    if (sortMode === 'name') return a.name.localeCompare(b.name);
    const order = (a.updatedAt || '').localeCompare(b.updatedAt || '');
    return sortMode === 'oldest' ? order : -order;
  });
  items.forEach((place) => {
    const item = document.createElement('div');
    item.className = 'story-card-item';
    const card = document.createElement('button');
    card.className = 'story-card';
    card.type = 'button';
    card.setAttribute('aria-label', `Open place: ${place.name}`);
    const header = document.createElement('span');
    header.className = 'story-card-header';
    const label = document.createElement('span');
    label.className = 'story-card-label';
    label.textContent = (PLACE_KINDS[place.kind] || 'Place').toUpperCase();
    const date = document.createElement('span');
    date.className = 'story-card-date';
    date.style.marginRight = '30px';
    date.textContent = place.updatedAt
      ? new Date(place.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    header.append(label, date);
    const title = document.createElement('strong');
    title.textContent = place.name;
    const excerpt = document.createElement('span');
    excerpt.className = 'story-card-excerpt';
    excerpt.textContent = place.summary || place.description || place.lore || 'No description yet. Open this place to add one.';
    if (place.image && validImageSource(place.image)) {
      const cover = document.createElement('img');
      cover.className = 'story-card-cover';
      cover.alt = '';
      setImageSource(cover, place.image, () => cover.classList.add('hidden'));
      card.append(cover);
    }
    card.append(header, title, excerpt);
    if (place.partOf) {
      const part = document.createElement('span');
      part.className = 'place-card-part';
      part.textContent = `◈ Part of ${place.partOf}`;
      card.append(part);
    }
    if (place.tags.length) {
      const chips = document.createElement('span');
      chips.className = 'story-card-chips';
      place.tags.slice(0, 3).forEach((tag) => {
        const chip = document.createElement('span');
        chip.className = 'story-chip';
        chip.textContent = `#${tag}`;
        chips.append(chip);
      });
      card.append(chips);
    }
    const names = placeCharacterNames(place);
    if (names.length) {
      const cast = document.createElement('span');
      cast.className = 'story-card-cast';
      cast.textContent = `✦ ${names.slice(0, 2).join(', ')}${names.length > 2 ? ` +${names.length - 2}` : ''}`;
      card.append(cast);
    }
    const linkedStories = savedStories.filter((story) => (story.placeIds || []).includes(place.id));
    if (linkedStories.length) {
      const storyLinks = document.createElement('span');
      storyLinks.className = 'story-card-cast';
      storyLinks.textContent = `✎ ${linkedStories.slice(0, 2).map((story) => story.title || 'Untitled story').join(', ')}${linkedStories.length > 2 ? ` +${linkedStories.length - 2}` : ''}`;
      card.append(storyLinks);
    }
    const action = document.createElement('span');
    action.className = 'story-card-action';
    action.textContent = 'Open place →';
    card.append(action);
    card.addEventListener('click', () => openPlaceEditor(place.id, card));
    const remove = document.createElement('button');
    remove.className = 'card-delete-button story-delete-button';
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Delete place: ${place.name}`);
    remove.title = 'Delete place';
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      requestDeleteItem(place.id, 'place', place, remove);
    });
    const preview = document.createElement('button');
    preview.className = 'story-card-preview';
    preview.type = 'button';
    preview.textContent = 'Full preview ↗';
    preview.setAttribute('aria-label', `Open full preview: ${place.name}`);
    preview.addEventListener('click', (event) => {
      event.stopPropagation();
      openEntityPreview('place', place, preview);
    });
    item.append(card, preview, remove);
    library.append(item);
  });
  library.classList.toggle('is-horizontal', items.length >= 4);
  library.classList.toggle('hidden', items.length === 0);
  document.querySelector('#place-sidebar-count').textContent = String(places.length);
  document.querySelector('#place-count').textContent = `(${places.length})`;
  document.querySelector('#place-empty').classList.toggle('hidden', places.length > 0);
  document.querySelector('#place-filter-bar').classList.toggle('hidden', places.length === 0);
  document.querySelector('#place-no-results').classList.toggle('hidden', !(places.length > 0 && items.length === 0));
  renderBackupInformation();
}

function renderWorldEntries() {
  const library = document.querySelector('#world-entry-library');
  library.replaceChildren();
  const query = document.querySelector('#world-entry-search').value.trim().toLowerCase();
  const category = document.querySelector('#world-entry-filter-category').value;
  const sortMode = document.querySelector('#world-entry-sort').value;
  const items = worldEntries.filter((entry) => {
    if (category && entry.category !== category) return false;
    return !query || [entry.name, entry.summary, entry.description, entry.details, WORLD_ENTRY_CATEGORIES[entry.category], ...entry.tags]
      .join(' ').toLowerCase().includes(query);
  });
  items.sort((a, b) => sortMode === 'name'
    ? a.name.localeCompare(b.name)
    : sortMode === 'category'
      ? WORLD_ENTRY_CATEGORIES[a.category].localeCompare(WORLD_ENTRY_CATEGORIES[b.category]) || a.name.localeCompare(b.name)
      : (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  items.forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'story-card-item';
    const card = document.createElement('button');
    card.className = 'story-card';
    card.type = 'button';
    card.setAttribute('aria-label', `Open world entry: ${entry.name}`);
    const header = document.createElement('span');
    header.className = 'story-card-header';
    const label = document.createElement('span');
    label.className = 'story-card-label';
    label.textContent = WORLD_ENTRY_CATEGORIES[entry.category].toUpperCase();
    header.append(label);
    const title = document.createElement('strong');
    title.textContent = entry.name;
    const excerpt = document.createElement('span');
    excerpt.className = 'story-card-excerpt';
    excerpt.textContent = entry.summary || entry.description || entry.details || 'No description yet. Open this entry to add one.';
    card.append(header, title, excerpt);
    if (entry.tags.length) {
      const chips = document.createElement('span');
      chips.className = 'story-card-chips';
      entry.tags.slice(0, 3).forEach((tag) => {
        const chip = document.createElement('span');
        chip.className = 'story-chip';
        chip.textContent = `#${tag}`;
        chips.append(chip);
      });
      card.append(chips);
    }
    const action = document.createElement('span');
    action.className = 'story-card-action';
    action.textContent = 'Open entry →';
    card.append(action);
    card.addEventListener('click', () => openWorldEntryEditor(entry.id, card));
    const remove = document.createElement('button');
    remove.className = 'card-delete-button story-delete-button';
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Delete world entry: ${entry.name}`);
    remove.title = 'Delete world entry';
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      requestDeleteItem(entry.id, 'world-entry', entry, remove);
    });
    const preview = document.createElement('button');
    preview.className = 'story-card-preview';
    preview.type = 'button';
    preview.textContent = 'Full preview ↗';
    preview.setAttribute('aria-label', `Open full preview: ${entry.name}`);
    preview.addEventListener('click', (event) => {
      event.stopPropagation();
      openEntityPreview('world', entry, preview);
    });
    item.append(card, preview, remove);
    library.append(item);
  });
  library.classList.toggle('is-horizontal', items.length >= 4);
  library.classList.toggle('hidden', items.length === 0);
  document.querySelector('#world-entry-sidebar-count').textContent = String(worldEntries.length);
  document.querySelector('#world-entry-count').textContent = `(${worldEntries.length})`;
  document.querySelector('#world-entry-empty').classList.toggle('hidden', worldEntries.length > 0);
  document.querySelector('#world-entry-filter-bar').classList.toggle('hidden', worldEntries.length === 0);
  document.querySelector('#world-entry-no-results').classList.toggle('hidden', !(worldEntries.length > 0 && items.length === 0));
  renderBackupInformation();
}

function openWorldEntryEditor(id = '', returnFocus = document.activeElement) {
  const entry = worldEntries.find((item) => item.id === id);
  activeWorldEntryId = entry?.id || '';
  worldEntryReturnFocus = returnFocus;
  document.querySelector('#world-entry-title').innerHTML = entry
    ? 'Edit your <em>world entry.</em>' : 'A new <em>world entry.</em>';
  document.querySelector('#world-entry-name').value = entry?.name || '';
  document.querySelector('#world-entry-category').value = entry?.category || 'faction';
  document.querySelector('#world-entry-summary').value = entry?.summary || '';
  document.querySelector('#world-entry-description').value = entry?.description || '';
  document.querySelector('#world-entry-details').value = entry?.details || '';
  document.querySelector('#world-entry-tags').value = (entry?.tags || []).join(', ');
  document.querySelector('#world-entry-delete').classList.toggle('hidden', !entry);
  const dialog = document.querySelector('#world-entry-dialog');
  if (!dialog.open) dialog.showModal();
  syncModalScrollLock();
  dialog.querySelector('.profile-scroll').scrollTop = 0;
  document.querySelector('#world-entry-name').focus();
}

function closeWorldEntryEditor() {
  const dialog = document.querySelector('#world-entry-dialog');
  if (dialog.open) dialog.close();
}

function saveWorldEntry(event) {
  event.preventDefault();
  const record = normalizeWorldEntry({
    id: activeWorldEntryId || createId(),
    name: document.querySelector('#world-entry-name').value,
    category: document.querySelector('#world-entry-category').value,
    summary: document.querySelector('#world-entry-summary').value,
    description: document.querySelector('#world-entry-description').value,
    details: document.querySelector('#world-entry-details').value,
    tags: document.querySelector('#world-entry-tags').value,
    updatedAt: new Date().toISOString(),
  });
  if (!record) {
    showToast('Add a name before saving this world entry.');
    document.querySelector('#world-entry-name').focus();
    return;
  }
  const nextEntries = [...worldEntries];
  const index = nextEntries.findIndex((entry) => entry.id === record.id);
  if (index >= 0) nextEntries[index] = record;
  else nextEntries.unshift(record);
  if (!writeStorage(WORLD_ENTRIES_STORAGE_KEY, nextEntries)) {
    showToast('World entry could not be saved. Your browser storage may be full.');
    return;
  }
  worldEntries.splice(0, worldEntries.length, ...nextEntries);
  scheduleFolderBackup();
  renderWorldEntries();
  closeWorldEntryEditor();
  showToast(index >= 0 ? 'World entry updated.' : 'World entry saved.');
}

function renderPlaceCharacterPicker(selectedIds = []) {
  const picker = document.querySelector('#place-characters');
  picker.replaceChildren();
  if (!characters.length) {
    const hint = document.createElement('p');
    hint.className = 'story-picker-empty';
    hint.textContent = 'No characters yet. Create one in Characters and they will appear here.';
    picker.append(hint);
    return;
  }
  characters.forEach((character) => {
    const chip = document.createElement('label');
    chip.className = 'story-character-chip';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = character.id;
    input.checked = selectedIds.includes(character.id);
    const name = document.createElement('span');
    name.textContent = character.name;
    chip.append(input, name);
    picker.append(chip);
  });
}

function renderStoryPlacePicker(selectedIds = []) {
  const picker = document.querySelector('#story-places');
  picker.replaceChildren();
  if (!places.length) {
    const hint = document.createElement('p');
    hint.className = 'story-picker-empty';
    hint.textContent = 'Create a place here and it will be linked to this story.';
    picker.append(hint);
  } else {
    places.forEach((place) => {
      const chip = document.createElement('label');
      chip.className = 'story-character-chip';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = place.id;
      input.checked = selectedIds.includes(place.id);
      const name = document.createElement('span');
      name.textContent = place.name;
      chip.append(input, name);
      picker.append(chip);
    });
  }
  const create = document.createElement('button');
  create.className = 'button button-outline story-picker-create';
  create.type = 'button';
  create.dataset.storyPlaceCreate = 'true';
  create.textContent = places.length ? '＋ Create and link a place' : '＋ Create a place';
  create.addEventListener('click', () => openPlaceEditor('', create));
  picker.append(create);
}

function syncPlaceImageChip() {
  const field = document.querySelector('#place-image-url');
  syncImageChip(document.querySelector('#place-image-chip'), field.closest('.story-image-control'), field.value.trim(), true);
}

function readPlaceForm() {
  const value = (id) => document.querySelector(id).value;
  return {
    name: value('#place-name'), kind: value('#place-kind'), partOf: value('#place-part-of'),
    summary: value('#place-summary'), description: value('#place-description'),
    lore: value('#place-lore'),
    atmosphere: value('#place-atmosphere'), notes: value('#place-notes'), tags: value('#place-tags'),
    image: value('#place-image-url').trim(),
    characterIds: [...document.querySelectorAll('#place-characters input:checked')].map((input) => input.value),
  };
}

function openPlaceEditor(id = '', returnFocus = document.activeElement) {
  const place = places.find((item) => item.id === id);
  const recoveredDraft = (id && placeDrafts[id]) || (!id ? Object.values(placeDrafts)[0] : null);
  const current = recoveredDraft || place;
  activePlaceId = place?.id || current?.id || createId();
  placeReturnFocus = returnFocus;
  const set = (selector, value) => { document.querySelector(selector).value = value; };
  set('#place-name', current?.name || '');
  set('#place-kind', current?.kind || 'city');
  set('#place-part-of', current?.partOf || '');
  set('#place-summary', current?.summary || '');
  set('#place-description', current?.description || '');
  set('#place-lore', current?.lore || '');
  set('#place-atmosphere', current?.atmosphere || '');
  set('#place-notes', current?.notes || '');
  set('#place-tags', (current?.tags || []).join(', '));
  set('#place-image-url', current?.image || '');
  renderPlaceCharacterPicker(current?.characterIds || []);
  syncPlaceImageChip();
  document.querySelector('#place-description-count').textContent = String((current?.description || '').length);
  document.querySelector('#place-lore-count').textContent = `${String(current?.lore || '').trim() ? countWords(current.lore) : 0} words`;
  document.querySelector('#place-delete').classList.toggle('hidden', !place);
  document.querySelector('#place-title').textContent = current?.name || (recoveredDraft ? 'Continue your place.' : 'A new place.');
  if (!current?.name) {
    document.querySelector('#place-title').replaceChildren('A new ', Object.assign(document.createElement('em'), { textContent: 'place.' }));
  }
  placeHasChanges = Boolean(recoveredDraft || (current && !place));
  const dialog = document.querySelector('#place-dialog');
  dialog.classList.remove('is-closing');
  if (!dialog.open) dialog.showModal();
  syncModalScrollLock();
  dialog.querySelector('.profile-scroll').scrollTop = 0;
  document.querySelector('#place-name').focus();
}

function closePlaceNow() {
  const dialog = document.querySelector('#place-dialog');
  if (!dialog.open || dialog.classList.contains('is-closing')) return;
  dialog.classList.add('is-closing');
  const delay = getMotionDelay(400);
  placeCloseTimer = window.setTimeout(() => {
    dialog.close();
    placeCloseTimer = null;
  }, delay);
}

function requestPlaceClose() {
  const dialog = document.querySelector('#place-dialog');
  if (!dialog.open) return;
  if (!placeHasChanges) {
    closePlaceNow();
    return;
  }
  pendingDeleteId = 'place-editor';
  pendingDeleteKind = 'discard-place';
  pendingDeleteFocus = null;
  document.querySelector('#delete-dialog-title').textContent = 'Close without saving?';
  document.querySelector('#delete-dialog-message').textContent = 'Your changes are autosaved as a draft on this device. Discarding will remove that draft and keep the last saved place.';
  document.querySelector('#cancel-delete').textContent = 'Keep editing';
  document.querySelector('#confirm-delete').textContent = 'Discard changes';
  deleteDialog.showModal();
  syncModalScrollLock();
  document.querySelector('#cancel-delete').focus();
}

function savePlaceFromForm() {
  const form = readPlaceForm();
  if (!form.name.trim()) {
    showToast('Give this place a name first.');
    document.querySelector('#place-name').focus();
    return false;
  }
  const record = normalizePlace({ ...form, id: activePlaceId || createId(), updatedAt: new Date().toISOString() });
  const next = places.some((place) => place.id === record.id)
    ? places.map((place) => (place.id === record.id ? record : place)) : [record, ...places];
  if (!writeStorage(PLACES_STORAGE_KEY, next)) {
    showToast('Could not save this place. Your browser storage may be full. Try a smaller image.');
    return false;
  }
  places.splice(0, places.length, ...next);
  window.clearTimeout(placeDraftTimer);
  placeDraftPending = false;
  const removedDraft = placeDrafts[record.id];
  let draftCleared = true;
  if (removedDraft) {
    delete placeDrafts[record.id];
    draftCleared = writeStorage(PLACE_DRAFT_KEY, placeDrafts);
  }
  if (!draftCleared) {
    placeDrafts[record.id] = removedDraft;
  }
  activePlaceId = record.id;
  placeHasChanges = false;
  persistCharacterLibrary();
  renderPlaces();
  renderStories();
  const storyDialog = document.querySelector('#story-dialog');
  const fromStoryPicker = placeReturnFocus instanceof HTMLElement
    && placeReturnFocus.dataset.storyPlaceCreate === 'true'
    && storyDialog.open
    && !document.querySelector('#story-form').classList.contains('hidden');
  if (fromStoryPicker) {
    const selectedIds = [...document.querySelectorAll('#story-places input:checked')].map((input) => input.value);
    renderStoryPlacePicker([...selectedIds, record.id]);
    renderStoryPeekList();
    handleStoryEditorInput();
    flushStoryDraft();
    placeReturnFocus = [...document.querySelectorAll('#story-places input')].find((input) => input.value === record.id) || null;
  }
  showToast(draftCleared ? 'Place saved.' : 'Place saved, but its autosaved draft could not be cleared.');
  return true;
}

function handlePlaceImageUpload(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('Choose an image file.');
    input.value = '';
    return;
  }
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    showToast('Choose an image smaller than 5 MB.');
    input.value = '';
    return;
  }
  resizeStoryImage(file).then((dataUrl) => {
    document.querySelector('#place-image-url').value = dataUrl;
    syncPlaceImageChip();
    placeHasChanges = true;
    savePlaceDraft();
  }).catch(() => showToast('Could not read that image. Try another file or paste an image link.'))
    .finally(() => { input.value = ''; });
}

function currentPlaceDraft() {
  return normalizePlace({
    ...readPlaceForm(),
    name: document.querySelector('#place-name').value.trim() || 'Untitled place',
    id: activePlaceId || createId(),
    updatedAt: new Date().toISOString(),
  });
}

function savePlaceDraft() {
  placeDraftPending = true;
  window.clearTimeout(placeDraftTimer);
  placeDraftTimer = window.setTimeout(flushPlaceDraft, 500);
}

function flushPlaceDraft() {
  if (!placeDraftPending || !document.querySelector('#place-dialog').open) return;
  placeDraftPending = false;
  placeDraftTimer = 0;
  const draft = currentPlaceDraft();
  if (!draft) return;
  if (!document.querySelector('#place-name').value.trim()
    && !draft.description && !draft.lore && !draft.notes && !draft.summary && !draft.image) return;
  draft.name = document.querySelector('#place-name').value.trim();
  const previous = placeDrafts[draft.id];
  placeDrafts[draft.id] = draft;
  if (!writeStorage(PLACE_DRAFT_KEY, placeDrafts)) {
    if (previous) placeDrafts[draft.id] = previous;
    else delete placeDrafts[draft.id];
    showToast('Could not autosave this place. Save it before closing.');
    return;
  }
  scheduleFolderBackup();
  if (!writeStorage(PLACE_DRAFT_KEY, placeDrafts)) {
    showToast('Could not autosave this place. Save it before closing.');
  }
}

function renderRelationEditors() {
  renderBondsEditor();
  renderTimelineEditor();
  renderCustomEditor();
  renderCharacterHistory();
}

const BOND_TYPES = ['ally', 'rival', 'family', 'secret-crush', 'betrayed', 'other'];
const BOND_STATUSES = ['strangers', 'acquaintances', 'friends', 'rivals', 'active', 'complicated', 'strained', 'broken', 'reconciled'];
const BOND_TYPE_LABELS = {
  ally: 'Friend', rival: 'Rival', family: 'Family', 'secret-crush': 'Romantic connection', betrayed: 'Trust changed', other: 'Other',
};
const BOND_STATUS_LABELS = {
  strangers: 'Strangers', acquaintances: 'Acquaintances', friends: 'Friends', rivals: 'Rivals',
  active: 'Ongoing', complicated: 'Complicated', strained: 'Distant', broken: 'No contact', reconciled: 'Reconnected',
};

function bondDetailParts(bond) {
  return [
    bond.type && BOND_TYPE_LABELS[bond.type],
    bond.status && BOND_STATUS_LABELS[bond.status],
    bond.label,
    bond.history,
    ...bond.statusHistory.map((entry) => `${entry.when || 'Undated'}: ${BOND_STATUS_LABELS[entry.status]}${entry.note ? ` — ${entry.note}` : ''}`),
  ].filter(Boolean);
}

function parseBonds(value) {
  let source = value;
  if (typeof source === 'string') {
    try {
      const parsed = JSON.parse(source);
      if (Array.isArray(parsed)) source = parsed;
    } catch {
      // Older connections use one "id|label" line per character.
    }
  }
  const normalize = (bond) => {
    if (typeof bond === 'string') {
      const index = bond.indexOf('|');
      return {
        id: (index < 0 ? bond : bond.slice(0, index)).trim().slice(0, 100),
        label: (index < 0 ? '' : bond.slice(index + 1)).trim().slice(0, 40),
        type: 'other',
        status: 'active',
        history: '',
        statusHistory: [],
      };
    }
    if (!bond || typeof bond !== 'object') return null;
    const statusHistory = Array.isArray(bond.statusHistory) ? bond.statusHistory.slice(0, 40).map((entry) => ({
      when: String(entry?.when ?? '').trim().slice(0, 60),
      status: BOND_STATUSES.includes(entry?.status) ? entry.status : 'active',
      note: String(entry?.note ?? '').trim().slice(0, 300),
    })).filter((entry) => entry.when || entry.note) : [];
    return {
      id: String(bond.id ?? '').trim().slice(0, 100),
      label: String(bond.label ?? '').trim().slice(0, 40),
      type: bond.type === '' ? '' : BOND_TYPES.includes(bond.type) ? bond.type : 'other',
      status: statusHistory.length ? statusHistory[statusHistory.length - 1].status
        : bond.status === '' ? '' : BOND_STATUSES.includes(bond.status) ? bond.status : 'active',
      history: String(bond.history ?? '').trim().slice(0, 500),
      statusHistory,
    };
  };
  const bonds = Array.isArray(source) ? source.map(normalize) : String(source || '').split(/\r?\n/).map(normalize);
  return bonds.filter((bond, position, list) => bond?.id && list.findIndex((item) => item?.id === bond.id) === position).slice(0, 30);
}

function serializeBonds(list) {
  const bonds = parseBonds(list).map((bond) => ({
    id: bond.id,
    label: bond.label.replace(/[\r\n|]+/g, ' ').slice(0, 40),
    type: bond.type,
    status: bond.status,
    history: bond.history.replace(/[\r\n]+/g, ' ').slice(0, 500),
    statusHistory: bond.statusHistory.map((entry) => ({
      when: entry.when.replace(/[\r\n]+/g, ' ').slice(0, 60),
      status: entry.status,
      note: entry.note.replace(/[\r\n]+/g, ' ').slice(0, 300),
    })),
  }));
  return bonds.length ? JSON.stringify(bonds) : '';
}

function recordCharacterRelationshipEvent(sourceId, targetId, event) {
  const when = typeof event?.when === 'string' ? event.when.trim().slice(0, 60) : '';
  const status = event?.status;
  const note = typeof event?.note === 'string' ? event.note.trim().slice(0, 300) : '';
  const sourceIndex = characters.findIndex((character) => character.id === sourceId);
  if (!when || !BOND_STATUSES.includes(status) || sourceId === targetId || sourceIndex < 0
    || !characters.some((character) => character.id === targetId)) {
    showToast('Choose a valid connection, timeline point, and relationship status.');
    return false;
  }
  const source = characters[sourceIndex];
  const bonds = parseBonds(source.bonds);
  const bondIndex = bonds.findIndex((bond) => bond.id === targetId);
  if (bondIndex < 0) {
    showToast('That connection no longer exists. Refresh the relationship history and try again.');
    return false;
  }
  if (bonds[bondIndex].statusHistory.length >= 40) {
    showToast('A connection can have up to 40 status changes.');
    return false;
  }
  const updatedBonds = bonds.map((bond, index) => index === bondIndex ? {
    ...bond,
    status,
    statusHistory: [...bond.statusHistory, { when, status, note }],
  } : bond);
  const nextCharacters = [...characters];
  const updatedCharacter = {
    ...source,
    bonds: serializeBonds(updatedBonds),
    updatedAt: new Date().toISOString(),
  };
  nextCharacters[sourceIndex] = updatedCharacter;
  if (!writeStorage(STORAGE_KEY, nextCharacters)) {
    showToast('Could not save this relationship change. Your browser storage may be full.');
    return false;
  }
  characters.splice(0, characters.length, ...nextCharacters);
  if (activeId === sourceId) {
    document.querySelector('#bonds').value = updatedCharacter.bonds;
    characterFormHasChanges = true;
    renderRelationEditors();
    updatePreview();
    saveDraft();
  }
  renderCharacters();
  scheduleFolderBackup();
  window.dispatchEvent(new CustomEvent('FictionTales:relationship-updated'));
  showToast('Relationship change recorded.');
  return true;
}

function characterBonds(character) {
  return parseBonds(character?.bonds).filter((bond) => bond.id !== character.id && characters.some((item) => item.id === bond.id));
}

function setBonds(list) {
  document.querySelector('#bonds').value = serializeBonds(list);
  characterFormHasChanges = true;
  renderRelationEditors();
  updatePreview();
  saveDraft();
}

function renderBondsEditor() {
  const select = document.querySelector('#bond-character');
  const addButton = document.querySelector('#bond-add');
  const list = document.querySelector('#bond-list');
  const bonds = parseBonds(document.querySelector('#bonds').value).filter((bond) => characters.some((item) => item.id === bond.id));
  const others = characters.filter((item) => item.id !== activeId);
  const available = others.filter((item) => !bonds.some((bond) => bond.id === item.id));
  select.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = available.length ? 'Choose a character…'
    : others.length ? 'Everyone is already connected' : 'Save another character to connect them';
  select.append(placeholder);
  available.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.name;
    select.append(option);
  });
  select.disabled = !available.length;
  addButton.disabled = !available.length;
  list.replaceChildren();
  bonds.forEach((bond) => {
    const target = characters.find((item) => item.id === bond.id);
    const row = document.createElement('li');
    row.className = `bond-editor-row${bond.type ? ` bond-type-${bond.type}` : ''}${bond.status ? ` bond-status-${bond.status}` : ''}`;
    const name = document.createElement('strong');
    name.textContent = target.name;
    const label = document.createElement('span');
    label.className = 'bond-editor-summary';
    label.textContent = bondDetailParts(bond).join(' · ');
    const detailEditor = document.createElement('details');
    detailEditor.className = 'bond-detail-editor';
    const detailSummary = document.createElement('summary');
    detailSummary.textContent = 'Edit connection details';
    const detailFields = document.createElement('div');
    detailFields.className = 'bond-detail-fields';
    const type = document.createElement('select');
    type.setAttribute('aria-label', `Optional connection type with ${target.name}`);
    const optionalType = document.createElement('option');
    optionalType.value = '';
    optionalType.textContent = 'Type not set (optional)';
    type.append(optionalType);
    BOND_TYPES.forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = BOND_TYPE_LABELS[value];
      type.append(option);
    });
    type.value = bond.type;
    const detailInput = document.createElement('input');
    detailInput.type = 'text';
    detailInput.maxLength = 40;
    detailInput.value = bond.label;
    detailInput.placeholder = 'Optional connection detail';
    detailInput.setAttribute('aria-label', `Connection detail with ${target.name}`);
    const historyNote = document.createElement('textarea');
    historyNote.maxLength = 500;
    historyNote.value = bond.history;
    historyNote.rows = 2;
    historyNote.placeholder = 'Optional shared history';
    historyNote.setAttribute('aria-label', `Optional shared history with ${target.name}`);
    const saveDetails = document.createElement('button');
    saveDetails.type = 'button';
    saveDetails.className = 'button button-quiet bond-details-save';
    saveDetails.textContent = 'Save details';
    saveDetails.addEventListener('click', () => setBonds(bonds.map((item) => item.id === bond.id ? {
      ...item,
      type: type.value,
      label: detailInput.value.trim(),
      history: historyNote.value.trim(),
    } : item)));
    detailFields.append(type, detailInput, historyNote, saveDetails);
    detailEditor.append(detailSummary, detailFields);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove connection to ${target.name}`);
    remove.addEventListener('click', () => setBonds(bonds.filter((item) => item.id !== bond.id)));
    const historyWhen = document.createElement('input');
    historyWhen.type = 'text';
    historyWhen.maxLength = 60;
    historyWhen.placeholder = 'When? e.g. Chapter 5';
    historyWhen.setAttribute('aria-label', `Timeline point for ${target.name} relationship status`);
    const status = document.createElement('select');
    status.setAttribute('aria-label', `New status for relationship with ${target.name}`);
    BOND_STATUSES.forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = BOND_STATUS_LABELS[value];
      status.append(option);
    });
    status.value = bond.status;
    const note = document.createElement('input');
    note.type = 'text';
    note.maxLength = 300;
    note.placeholder = 'What changed? (optional)';
    note.setAttribute('aria-label', `Status change note for ${target.name}`);
    const addStatus = document.createElement('button');
    addStatus.type = 'button';
    addStatus.className = 'button button-quiet bond-status-add';
    addStatus.textContent = 'Record change';
    addStatus.addEventListener('click', () => {
      if (!historyWhen.value.trim()) {
        showToast('Add a timeline point for this relationship change.');
        historyWhen.focus();
        return;
      }
      if (bond.statusHistory.length >= 40) {
        showToast('A connection can have up to 40 status changes.');
        return;
      }
      setBonds(bonds.map((item) => item.id === bond.id ? {
        ...item,
        status: status.value,
        statusHistory: [...item.statusHistory, {
          when: historyWhen.value.trim(),
          status: status.value,
          note: note.value.trim(),
        }],
      } : item));
    });
    const statusEditor = document.createElement('div');
    statusEditor.className = 'bond-status-editor';
    statusEditor.append(historyWhen, status, note, addStatus);
    row.append(name);
    if (label.textContent) row.append(label);
    row.append(detailEditor, statusEditor, remove);
    list.append(row);
  });
}

function addBondFromEditor() {
  const select = document.querySelector('#bond-character');
  const labelInput = document.querySelector('#bond-label');
  const historyInput = document.querySelector('#bond-history-note');
  if (!select.value) {
    showToast('Choose a character to connect first.');
    select.focus();
    return;
  }
  const bonds = parseBonds(document.querySelector('#bonds').value);
  bonds.push({
    id: select.value,
    label: labelInput.value.trim(),
    type: document.querySelector('#bond-type').value,
    status: document.querySelector('#bond-status').value,
    history: historyInput.value.trim(),
    statusHistory: [],
  });
  labelInput.value = '';
  historyInput.value = '';
  setBonds(bonds);
}

function renderProfileDepth(profile) {
  const box = document.querySelector('#profile-depth');
  box.replaceChildren();
  [['Goal', profile.goal], ['Fear', profile.fear], ['Secret', profile.secret], ['Flaw', profile.flaw],
    ['Voice', profile.voice], ['Appearance', profile.appearance]].filter(([, value]) => value).forEach(([label, value]) => {
    const wrap = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    detail.textContent = value;
    wrap.append(term, detail);
    box.append(wrap);
  });
  setProfileSectionVisible(box, Boolean(box.childElementCount));
}

function renderProfilePersonality(profile) {
  const questionnaire = document.querySelector('#profile-questionnaire');
  questionnaire.replaceChildren();
  parseCharacterQuestionnaire(profile.questionnaire).forEach(({ question, answer }) => {
    const item = document.createElement('div');
    item.className = 'profile-question-answer';
    const prompt = document.createElement('strong');
    prompt.textContent = question;
    const response = document.createElement('p');
    response.textContent = answer;
    item.append(prompt, response);
    questionnaire.append(item);
  });
  const voice = document.querySelector('#profile-voice');
  voice.replaceChildren();
  const lines = String(profile.voiceSamples || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 20);
  if (profile.voice) {
    const catchphrase = document.createElement('p');
    catchphrase.className = 'profile-voice-catchphrase';
    catchphrase.textContent = `Voice note: ${profile.voice}`;
    voice.append(catchphrase);
  }
  lines.forEach((line) => {
    const sample = document.createElement('blockquote');
    sample.textContent = line;
    voice.append(sample);
  });
  setProfileSectionVisible(questionnaire, Boolean(questionnaire.childElementCount || voice.childElementCount));
}

let compareReturnFocus = null;

function renderCharacterComparison() {
  const idA = document.querySelector('#compare-character-a').value;
  const idB = document.querySelector('#compare-character-b').value;
  const first = characters.find((character) => character.id === idA);
  const second = characters.find((character) => character.id === idB);
  const container = document.querySelector('#character-comparison');
  container.replaceChildren();
  if (!first || !second) {
    const hint = document.createElement('p');
    hint.className = 'profile-empty';
    hint.textContent = 'Choose two different characters to compare their profiles.';
    container.append(hint);
    return;
  }
  if (first.id === second.id) {
    const hint = document.createElement('p');
    hint.className = 'profile-empty';
    hint.textContent = 'Choose two different characters to compare their profiles.';
    container.append(hint);
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'compare-grid';
  const heading = document.createElement('div');
  heading.className = 'compare-grid-heading';
  const label = document.createElement('span');
  label.textContent = 'PROFILE DETAIL';
  const nameA = document.createElement('strong');
  nameA.textContent = first.name;
  const nameB = document.createElement('strong');
  nameB.textContent = second.name;
  heading.append(label, nameA, nameB);
  grid.append(heading);
  const rows = [
    ['Role', first.role, second.role],
    ['Description', first.description, second.description],
    ['Traits', (first.traits || []).join(', '), (second.traits || []).join(', ')],
    ['Goal', first.goal, second.goal],
    ['Fear', first.fear, second.fear],
    ['Flaw', first.flaw, second.flaw],
    ['Secret', first.secret, second.secret],
    ['Starting belief', first.arcStart, second.arcStart],
    ['Turning point', first.arcTurningPoint, second.arcTurningPoint],
    ['Learned truth', first.arcEnd, second.arcEnd],
    ['Voice note', first.voice, second.voice],
    ['Dialogue samples', first.voiceSamples, second.voiceSamples],
    ['Questionnaire answers', parseCharacterQuestionnaire(first.questionnaire).map((entry) => `${entry.question}\n${entry.answer}`).join('\n\n'),
      parseCharacterQuestionnaire(second.questionnaire).map((entry) => `${entry.question}\n${entry.answer}`).join('\n\n')],
  ];
  rows.forEach(([title, valueA, valueB]) => {
    const row = document.createElement('div');
    row.className = 'compare-grid-row';
    const term = document.createElement('strong');
    term.textContent = title;
    const cellA = document.createElement('p');
    cellA.textContent = valueA || '—';
    const cellB = document.createElement('p');
    cellB.textContent = valueB || '—';
    row.append(term, cellA, cellB);
    grid.append(row);
  });
  container.append(grid);
}

function openCharacterComparison(returnFocus = document.activeElement) {
  if (characters.length < 2) {
    showToast('Create at least two characters to compare their profiles.');
    return;
  }
  compareReturnFocus = returnFocus;
  const selects = [document.querySelector('#compare-character-a'), document.querySelector('#compare-character-b')];
  selects.forEach((select, selectIndex) => {
    select.replaceChildren(...characters.map((character) => new Option(character.name, character.id)));
    select.value = characters[Math.min(selectIndex, characters.length - 1)].id;
  });
  renderCharacterComparison();
  compareDialog.showModal();
  syncModalScrollLock();
  document.querySelector('#compare-character-a').focus();
}

function renderProfileConnections(profile) {
  const box = document.querySelector('#profile-connections');
  box.replaceChildren();
  const rows = characterBonds(profile).map((bond) => ({
    other: characters.find((item) => item.id === bond.id), bond,
  }));
  characters.forEach((other) => {
    if (other.id === profile.id || rows.some((row) => row.other.id === other.id)) return;
    const back = characterBonds(other).find((bond) => bond.id === profile.id);
    if (back) rows.push({ other, bond: back, addedOn: other.name });
  });
  if (!rows.length) {
    setProfileSectionVisible(box, false);
    return;
  }
  setProfileSectionVisible(box, true);
  rows.forEach(({ other, bond, addedOn }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'profile-story-link';
    const name = document.createElement('strong');
    name.textContent = other.name;
    const label = document.createElement('span');
    label.textContent = [
      ...bondDetailParts(bond),
      addedOn && `Added on ${addedOn}’s profile`,
    ].filter(Boolean).join(' · ');
    button.append(name);
    if (label.textContent) button.append(label);
    button.addEventListener('click', () => {
      requestProfileClose(() => openCharacterProfile(other, document.querySelector('#character-grid')));
    });
    box.append(button);
  });
}

function syncCharacterActions(editing) {
  document.querySelector('#delete-character').classList.toggle('hidden', !editing);
  document.querySelector('#duplicate-character').classList.toggle('hidden', !editing);
}

function duplicateCharacter() {
  const profile = currentProfile();
  if (!profile.name) return;
  activeId = '';
  document.querySelector('#character-id').value = '';
  document.querySelector('#name').value = `${profile.name} (copy)`.slice(0, 48);
  document.querySelector('#save-label').textContent = 'Save character';
  syncCharacterActions(false);
  characterFormHasChanges = true;
  document.querySelector('#autosave-status').textContent = 'Copy ready — save to add it';
  renderRelationEditors();
  updatePreview();
  saveDraft();
  showToast('Copy ready. Rename it and save to add it to your cast.');
  document.querySelector('#name').focus();
  document.querySelector('#name').select();
}

function requestNewCharacter(returnFocus = document.activeElement) {
  if (!characterFormHasChanges) {
    resetForm();
    return;
  }
  pendingDeleteId = 'new-character';
  pendingDeleteKind = 'discard-character';
  pendingDeleteFocus = returnFocus;
  document.querySelector('#delete-dialog-title').textContent = 'Start a new character?';
  document.querySelector('#delete-dialog-message').textContent = 'You have unsaved changes. Starting a new character will discard them.';
  document.querySelector('#cancel-delete').textContent = 'Keep editing';
  document.querySelector('#confirm-delete').textContent = 'Discard & start new';
  deleteDialog.showModal();
  syncModalScrollLock();
  document.querySelector('#cancel-delete').focus();
}

function updateProfileMeter(profile) {
  const checks = [
    ['a role', profile.role, '#role', null, 'A role helps place them in the story.'],
    ['a quick description', profile.description, '#description', null, 'A first impression makes the profile feel like them.'],
    ['a few traits', profile.traits.length, '#traits', null, 'A few traits give you a quick personality anchor.'],
    ['a backstory', profile.story, '#story', null, 'A formative moment can explain how they became this person.'],
    ['a portrait', profile.avatar, '#avatar', 'appearance-details', 'A portrait makes their card easy to recognize.'],
    ['a goal, fear, or secret', profile.goal || profile.fear || profile.secret, '#goal', 'depth-details', 'A want or fear gives them something to push against.'],
    ['a connection to another character', parseBonds(profile.bonds).length, '#bond-character', 'profile-extras', 'A relationship can reveal a different side of them.'],
    ['a dialogue sample', profile.voiceSamples, '#voice-samples', 'depth-details', 'A sample line helps keep their voice consistent.'],
    ['a questionnaire answer', parseCharacterQuestionnaire(profile.questionnaire).length, '#questionnaire-question', 'questionnaire-details', 'Answer a prompt to discover a detail you can use in a scene.'],
  ];
  const done = checks.filter(([, value]) => value).length + (profile.name ? 1 : 0);
  const total = checks.length + 1;
  const percent = Math.round((done / total) * 100);
  const next = checks.find(([, value]) => !value);
  document.querySelector('#profile-meter-fill').style.width = `${percent}%`;
  document.querySelector('#profile-meter-text').textContent = !profile.name
    ? 'Start with a name'
    : `Profile ${percent}% complete${next ? ` · next, add ${next[0]}` : ' · fully fleshed out ✦'}`;
  const hints = document.querySelector('#profile-meter-hints');
  hints.replaceChildren();
  checks.filter(([, value]) => !value).slice(0, 3).forEach(([label, , selector, sectionId, suggestion]) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `Add ${label}`;
    button.title = suggestion;
    button.addEventListener('click', () => {
      if (sectionId) document.getElementById(sectionId).open = true;
      const field = document.querySelector(selector);
      field?.scrollIntoView({ behavior: getMotionScrollBehavior(), block: 'center' });
      field?.focus({ preventScroll: true });
    });
    const detail = document.createElement('span');
    detail.textContent = suggestion;
    item.append(button, detail);
    hints.append(item);
  });
  hints.classList.toggle('hidden', !hints.childElementCount || !profile.name);
}

function currentProfile() {
  return {
    id: document.querySelector('#character-id').value || activeId || '',
    name: document.querySelector('#name').value.trim(),
    role: document.querySelector('#role').value.trim(),
    pronouns: document.querySelector('#pronouns').value.trim(),
    age: document.querySelector('#age').value.trim(),
    species: document.querySelector('#species').value.trim(),
    description: document.querySelector('#description').value.trim(),
    traits: document.querySelector('#traits').value.split(',').map((trait) => trait.trim()).filter(Boolean),
    avatar: document.querySelector('#avatar').value.trim(),
    cover: document.querySelector('#cover').value.trim(),
    avatarCrop: serializeImageCrop(imageCropState.avatar),
    coverCrop: serializeImageCrop(imageCropState.cover),
    accent: document.querySelector('#accent').value,
    story: document.querySelector('#story').value.trim(),
    gallery: document.querySelector('#gallery').value.trim(),
    relations: document.querySelector('#relations').value.trim(),
    links: document.querySelector('#links').value.trim(),
    worlds: document.querySelector('#worlds').value.trim(),
    stats: document.querySelector('#stats').value.trim(),
    groups: document.querySelector('#groups').value.split(',').map((group) => group.trim()).filter(Boolean).slice(0, 10),
    tags: document.querySelector('#character-tags').value.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 20),
    goal: document.querySelector('#goal').value.trim(),
    fear: document.querySelector('#fear').value.trim(),
    secret: document.querySelector('#secret').value.trim(),
    flaw: document.querySelector('#flaw').value.trim(),
    voice: document.querySelector('#voice').value.trim(),
    voiceSamples: document.querySelector('#voice-samples').value.trim().slice(0, 1600),
    appearance: document.querySelector('#appearance').value.trim(),
    questionnaire: serializeCharacterQuestionnaire(document.querySelector('#questionnaire').value),
    bonds: document.querySelector('#bonds').value.trim(),
    timeline: document.querySelector('#timeline').value.trim(),
    arcStart: document.querySelector('#arc-start').value.trim(),
    arcTurningPoint: document.querySelector('#arc-turning-point').value.trim(),
    arcEnd: document.querySelector('#arc-end').value.trim(),
    snapshots: document.querySelector('#snapshots').value.trim(),
    customSections: document.querySelector('#customSections').value.trim(),
  };
}

function createId() {
  return globalThis.crypto?.randomUUID?.() || `character-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeStoryBackground(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value
    : DEFAULT_STORY_BACKGROUND;
}

function storyTextPalette(backgroundColor) {
  const channels = backgroundColor.slice(1).match(/.{2}/g).map((channel) => parseInt(channel, 16) / 255);
  const luminance = channels.reduce((sum, channel, index) => {
    const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][index];
  }, 0);
  return luminance > 0.42
    ? { heading: '#294d65', body: '#405d70', muted: '#6c8798' }
    : { heading: '#f4f8fc', body: '#e7eff8', muted: '#c5d7e6' };
}

function normalizeStories(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((story) => story && typeof story === 'object' && typeof story.id === 'string')
    .map((story) => ({
      id: story.id,
      title: typeof story.title === 'string' ? story.title : '',
      text: typeof story.text === 'string' ? story.text : '',
      titleFont: STORY_FONTS[story.titleFont] ? story.titleFont : 'playfair',
      bodyFont: STORY_FONTS[story.bodyFont] ? story.bodyFont : 'dm-sans',
      backgroundColor: normalizeStoryBackground(story.backgroundColor),
      image: typeof story.image === 'string' ? story.image : '',
      updatedAt: typeof story.updatedAt === 'string' ? story.updatedAt : '',
      ...normalizeStoryMeta(story),
    }));
}

function normalizeStoryDrafts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([id, story]) => id && story && typeof story === 'object')
    .map(([id, story]) => [id, {
      id,
      title: typeof story.title === 'string' ? story.title : '',
      text: typeof story.text === 'string' ? story.text : '',
      titleFont: STORY_FONTS[story.titleFont] ? story.titleFont : 'playfair',
      bodyFont: STORY_FONTS[story.bodyFont] ? story.bodyFont : 'dm-sans',
      backgroundColor: normalizeStoryBackground(story.backgroundColor),
      image: typeof story.image === 'string' ? story.image : '',
      updatedAt: typeof story.updatedAt === 'string' ? story.updatedAt : '',
      ...normalizeStoryMeta(story),
    }]));
}

function migrateLegacyLore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const sections = [];
  if (typeof value.setting === 'string' && value.setting.trim()) sections.push(`Setting\n${value.setting.trim()}`);
  if (typeof value.premise === 'string' && value.premise.trim()) sections.push(`Story idea\n${value.premise.trim()}`);
  if (typeof value.conflict === 'string' && value.conflict.trim()) sections.push(`Main problem\n${value.conflict.trim()}`);
  if (Array.isArray(value.plotPoints) && value.plotPoints.length) {
    sections.push(`Story events\n${value.plotPoints.map((point) => [point.title, point.description].filter(Boolean).join('\n')).filter(Boolean).join('\n\n')}`);
  }
  if (!sections.length && typeof value.name !== 'string') return [];
  return [{
    id: createId(),
    title: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : 'My story',
    text: sections.join('\n\n'),
    titleFont: 'playfair',
    bodyFont: 'dm-sans',
    backgroundColor: DEFAULT_STORY_BACKGROUND,
    image: '',
    updatedAt: new Date().toISOString(),
    ...normalizeStoryMeta({}),
  }];
}

function currentStoryDraft() {
  return {
    id: activeStoryId,
    title: document.querySelector('#story-title').value.trim(),
    text: document.querySelector('#story-text').value,
    titleFont: STORY_FONTS[document.querySelector('#story-title-font').value] ? document.querySelector('#story-title-font').value : 'playfair',
    bodyFont: STORY_FONTS[document.querySelector('#story-body-font').value] ? document.querySelector('#story-body-font').value : 'dm-sans',
    backgroundColor: normalizeStoryBackground(document.querySelector('#story-background').value),
    image: document.querySelector('#story-image-url').value.trim(),
    ...normalizeStoryMeta({
      kind: document.querySelector('#story-kind').value,
      progress: document.querySelector('#story-progress').value,
      seriesId: document.querySelector('#story-series').value,
      seriesOrder: document.querySelector('#story-series-order').value,
      wordGoal: document.querySelector('#story-word-goal').value,
      summary: document.querySelector('#story-summary').value,
      setting: document.querySelector('#story-setting').value,
      tags: document.querySelector('#story-tags').value,
      characterIds: [...document.querySelectorAll('#story-characters input:checked')].map((input) => input.value),
      placeIds: [...document.querySelectorAll('#story-places input:checked')].map((input) => input.value),
      chapterPlaces: document.querySelector('#story-chapter-places').value,
      chapterMeta: document.querySelector('#story-chapter-meta-data').value,
      notes: document.querySelector('#story-notes-data').value,
      todos: document.querySelector('#story-todos-data').value,
    }),
    updatedAt: new Date().toISOString(),
  };
}

function updateStoryPreview(story) {
  const hasContent = Boolean(story && (story.title || story.text || story.image));
  loadStoryFont(story?.titleFont);
  loadStoryFont(story?.bodyFont);
  const titleFont = STORY_FONTS[story?.titleFont] || STORY_FONTS.playfair;
  const bodyFont = STORY_FONTS[story?.bodyFont] || STORY_FONTS['dm-sans'];
  const backgroundColor = normalizeStoryBackground(story?.backgroundColor);
  const textPalette = storyTextPalette(backgroundColor);
  const imageSource = story?.image?.trim() || '';
  document.querySelector('#story-preview-open').disabled = !hasContent;
  document.querySelector('#story-editor-preview').disabled = !hasContent;
  const readingTitle = document.querySelector('#story-reading-title');
  const readingText = document.querySelector('#story-reading-text');
  const readingCoverWrap = document.querySelector('#story-reading-cover-wrap');
  const readingCover = document.querySelector('#story-reading-cover');
  readingTitle.textContent = story?.title || 'Your story title';
  renderStoryMarkdown(readingText, story?.text || '');
  const readingSummary = document.querySelector('#story-reading-summary');
  const readingMeta = document.querySelector('#story-reading-meta');
  const castNames = storyCharacterNames(story);
  const series = bookSeries.find((item) => item.id === story?.seriesId);
  const metaParts = story ? [
    STORY_KINDS[story.kind], STORY_PROGRESS[story.progress],
    story.setting && `Set in ${story.setting}`,
    series && `${series.name} · Book ${story.seriesOrder}`,
    castNames.length && `Featuring ${castNames.join(', ')}`,
    story.tags?.length && story.tags.map((tag) => `#${tag}`).join(' '),
  ].filter(Boolean) : [];
  readingSummary.textContent = story?.summary || '';
  readingSummary.classList.toggle('hidden', !story?.summary);
  readingMeta.textContent = metaParts.join('  ·  ');
  readingMeta.classList.toggle('hidden', !metaParts.length);
  readingTitle.style.fontFamily = titleFont;
  readingText.style.fontFamily = bodyFont;
  readingText.style.setProperty('--story-reader-font-size', `${storyReaderFontSize}px`);
  [document.querySelector('#story-reading-view'), document.querySelector('#story-form')].forEach((element) => {
    element.style.setProperty('--story-background', backgroundColor);
    element.style.setProperty('--story-heading-color', textPalette.heading);
    element.style.setProperty('--story-body-color', textPalette.body);
    element.style.setProperty('--story-muted-color', textPalette.muted);
  });
  document.querySelector('#story-title-font').style.fontFamily = titleFont;
  document.querySelector('#story-body-font').style.fontFamily = bodyFont;
  document.querySelector('#story-editor-title').style.fontFamily = titleFont;
  document.querySelector('#story-title').style.fontFamily = titleFont;
  document.querySelector('#story-text').style.fontFamily = bodyFont;
  document.querySelector('#story-reading-view').classList.toggle('has-cover', Boolean(imageSource && validImageSource(imageSource)));
  if (imageSource && validImageSource(imageSource)) {
    readingCover.alt = story?.title ? `${story.title} cover` : 'Story cover';
    readingCoverWrap.classList.remove('hidden');
    setImageSource(readingCover, imageSource, () => readingCoverWrap.classList.add('hidden'));
  } else {
    setImageSource(readingCover, '');
    readingCoverWrap.classList.add('hidden');
  }
  updateStoryReaderFontSize();
  updateStoryReaderProgress();
}

function setStoryDialogMode(mode) {
  const isEditor = mode === 'edit';
  const isReading = mode === 'reading';
  const dialog = document.querySelector('#story-dialog');
  document.querySelector('#story-form').classList.toggle('hidden', !isEditor);
  document.querySelector('#story-reading-view').classList.toggle('hidden', isEditor);
  document.querySelector('#story-preview-toolbar').classList.toggle('hidden', isReading);
  document.querySelector('#story-reader-toolbar').classList.toggle('hidden', !isReading);
  document.querySelector('#story-back-to-draft').classList.toggle('hidden', mode !== 'preview' || !previewFromEditor);
  document.querySelector('#story-focus-toggle').classList.toggle('hidden', !isEditor);
  document.querySelector('#story-save-status').classList.toggle('hidden', !isEditor);
  dialog.classList.toggle('is-reading-mode', isReading);
  dialog.setAttribute('aria-labelledby', isEditor ? 'story-editor-title' : 'story-reading-title');
}

function updateStoryReaderFontSize() {
  document.querySelector('#story-reading-text').style.setProperty('--story-reader-font-size', `${storyReaderFontSize}px`);
  document.querySelector('#story-reader-font-size').textContent = `${storyReaderFontSize} px`;
  document.querySelector('#story-reader-font-down').disabled = storyReaderFontSize <= 16;
  document.querySelector('#story-reader-font-up').disabled = storyReaderFontSize >= 32;
  updateStoryReaderProgress();
}

function updateStoryReaderProgress() {
  const readingView = document.querySelector('#story-reading-view');
  const maxScroll = readingView.scrollHeight - readingView.clientHeight;
  const hasText = Boolean(document.querySelector('#story-reading-text').textContent.trim());
  const progress = maxScroll <= 0 ? (hasText ? 100 : 0) : Math.round((readingView.scrollTop / maxScroll) * 100);
  const progressBar = document.querySelector('#story-reader-progress');
  progressBar.setAttribute('aria-valuenow', String(progress));
  document.querySelector('#story-reader-progress-fill').style.width = `${progress}%`;
  document.querySelector('#story-reader-progress-label').textContent = `${progress}% read`;
}

function openStoryReadingMode() {
  const readingView = document.querySelector('#story-reading-view');
  readingView.scrollTop = 0;
  setStoryDialogMode('reading');
  requestAnimationFrame(() => {
    updateStoryReaderProgress();
    document.querySelector('#story-reader-preview').focus();
  });
}

function openStoryPreview() {
  const dialog = document.querySelector('#story-dialog');
  const editorIsOpen = dialog.open && !document.querySelector('#story-form').classList.contains('hidden');
  if (editorIsOpen) {
    handleStoryEditorInput();
    previewStoryId = activeStoryId;
  }
  previewFromEditor = editorIsOpen;
  const story = editorIsOpen
    ? storyDrafts[activeStoryId] || savedStories.find((item) => item.id === activeStoryId)
    : Object.values(storyDrafts).find((item) => item.id === previewStoryId)
      || savedStories.find((item) => item.id === previewStoryId);
  if (!story) {
    showToast('Write a story first to open its preview.');
    return;
  }
  activeStoryId = story.id;
  updateStoryPreview(story);
  setStoryDialogMode('preview');
  document.querySelector('#story-save-status').textContent = storyDrafts[story.id] ? 'Draft preview' : 'Saved story';
  if (!dialog.open) {
    storyReturnFocus = document.activeElement;
    dialog.showModal();
    syncModalScrollLock();
  }
  document.querySelector('#story-reading-mode-open').focus();
  updateBackToTopVisibility();
}

function replaceStoryTextRange(start, end, replacement, selectFrom = null, selectTo = null) {
  const textarea = document.querySelector('#story-text');
  textarea.focus();
  textarea.setSelectionRange(start, end);
  let done = false;
  try {
    done = typeof document.execCommand === 'function' && document.execCommand('insertText', false, replacement)
      && textarea.value.slice(start, start + replacement.length) === replacement;
  } catch { done = false; }
  if (!done) {
    textarea.setRangeText(replacement, start, end, 'end');
    handleStoryEditorInput();
  }
  const from = selectFrom ?? start + replacement.length;
  textarea.setSelectionRange(from, selectTo ?? from);
}

function applyStoryFormat(kind) {
  const textarea = document.querySelector('#story-text');
  if (kind === 'undo' || kind === 'redo') {
    textarea.focus();
    try { document.execCommand(kind); } catch { /* browser without execCommand */ }
    handleStoryEditorInput();
    return;
  }
  const { selectionStart: start, selectionEnd: end, value } = textarea;
  const selected = value.slice(start, end);
  if (kind === 'bold' || kind === 'italic') {
    const mark = kind === 'bold' ? '**' : '*';
    const inner = selected || (kind === 'bold' ? 'bold text' : 'italic text');
    replaceStoryTextRange(start, end, `${mark}${inner}${mark}`, start + mark.length, start + mark.length + inner.length);
  } else if (kind === 'quote') {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const block = value.slice(lineStart, end) || 'A line worth remembering';
    replaceStoryTextRange(lineStart, end, block.split('\n').map((line) => (line.startsWith('> ') ? line : `> ${line}`)).join('\n'));
  } else if (kind === 'break') {
    const before = start === 0 ? '' : value.slice(0, start).endsWith('\n\n') ? '' : value.slice(0, start).endsWith('\n') ? '\n' : '\n\n';
    replaceStoryTextRange(start, end, `${before}---\n\n`);
  } else if (kind === 'chapter') {
    const number = parseStoryChapters(value).length + 1;
    const title = `Chapter ${number}`;
    const before = start === 0 ? '' : value.slice(0, start).endsWith('\n\n') ? '' : value.slice(0, start).endsWith('\n') ? '\n' : '\n\n';
    const prefix = writingPreferences.chapterFormat === 'markdown-h1' ? '# '
      : writingPreferences.chapterFormat === 'plain' ? '' : '## ';
    const heading = `${before}${prefix}${title}\n\n`;
    const titleStart = start + before.length + prefix.length;
    replaceStoryTextRange(start, end, heading, titleStart, titleStart + title.length);
  }
  handleStoryEditorInput();
}

function jumpToStoryPosition(position, length) {
  const textarea = document.querySelector('#story-text');
  const total = Math.max(1, textarea.value.length);
  textarea.scrollTop = Math.max(0, (position / total) * (textarea.scrollHeight - textarea.clientHeight) - 24);
  textarea.focus();
  textarea.setSelectionRange(position, position + length);
}

function moveStoryChapter(index, targetIndex) {
  const textarea = document.querySelector('#story-text');
  const text = textarea.value;
  const chapters = parseStoryChapters(text);
  if (!chapters[index] || !chapters[targetIndex] || index === targetIndex) return;
  const preamble = text.slice(0, chapters[0].start).trim();
  const segments = chapters.map((chapter) => text.slice(chapter.start, chapter.end).trim());
  const [moved] = segments.splice(index, 1);
  segments.splice(targetIndex, 0, moved);
  const next = `${[preamble, ...segments].filter(Boolean).join('\n\n')}\n`;
  if (activeStoryChapterIndex === index) activeStoryChapterIndex = targetIndex;
  else if (index < activeStoryChapterIndex && targetIndex >= activeStoryChapterIndex) activeStoryChapterIndex -= 1;
  else if (index > activeStoryChapterIndex && targetIndex <= activeStoryChapterIndex) activeStoryChapterIndex += 1;
  textarea.focus();
  textarea.setSelectionRange(0, text.length);
  let done = false;
  try { done = document.execCommand('insertText', false, next) && textarea.value === next; } catch { done = false; }
  if (!done) { textarea.value = next; }
  activeStoryChapterIndex = targetIndex;
  updateStoryChapterMetadata(targetIndex, {});
  const selected = parseStoryChapters(textarea.value)[activeStoryChapterIndex];
  if (selected) jumpToStoryPosition(selected.start, selected.headingLength);
  handleStoryEditorInput();
}

function storyChapterMetadata(chapters) {
  const stored = normalizeStoryChapterMeta(document.querySelector('#story-chapter-meta-data').value);
  const used = new Set();
  const metadata = chapters.map((chapter, index) => {
    const title = chapter.title.toLowerCase();
    let storedIndex = stored.findIndex((item, candidateIndex) => !used.has(candidateIndex) && item.title.toLowerCase() === title);
    if (storedIndex < 0 && stored.length === chapters.length && stored[index] && !used.has(index)) storedIndex = index;
    if (storedIndex >= 0) used.add(storedIndex);
    return {
      ...(storedIndex >= 0 ? stored[storedIndex] : {}),
      title: chapter.title,
      summary: storedIndex >= 0 ? stored[storedIndex].summary : '',
      status: storedIndex >= 0 ? stored[storedIndex].status : 'draft',
      povCharacterId: storedIndex >= 0 ? stored[storedIndex].povCharacterId : '',
      timelinePoint: storedIndex >= 0 ? stored[storedIndex].timelinePoint : '',
      updatedAt: storedIndex >= 0 ? stored[storedIndex].updatedAt : '',
    };
  });
  document.querySelector('#story-chapter-meta-data').value = JSON.stringify(metadata);
  return metadata;
}

function updateStoryChapterMetadata(index, changes) {
  const chapters = parseStoryChapters(document.querySelector('#story-text').value);
  if (!chapters[index]) return;
  const metadata = storyChapterMetadata(chapters);
  metadata[index] = {
    ...metadata[index],
    ...changes,
    title: chapters[index].title,
    updatedAt: new Date().toISOString(),
  };
  document.querySelector('#story-chapter-meta-data').value = JSON.stringify(metadata);
}

function formatChapterLastEdited(value) {
  if (!value) return 'Last edited time not recorded yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Last edited time not recorded yet' : `Last edited ${date.toLocaleString()}`;
}

function renderStoryChapterDetails(chapters, metadata, placeMap) {
  const details = document.querySelector('#story-chapter-details');
  const summary = document.querySelector('#story-chapter-summary');
  if (!chapters.length) {
    activeStoryChapterIndex = -1;
    details.classList.add('hidden');
    return;
  }
  activeStoryChapterIndex = Math.min(Math.max(activeStoryChapterIndex, 0), chapters.length - 1);
  const index = activeStoryChapterIndex;
  const chapter = chapters[index];
  const chapterMeta = metadata[index];
  const selectedTitle = document.querySelector('#story-chapter-selected-title');
  selectedTitle.textContent = `Chapter ${index + 1} · ${chapter.title}`;
  if (document.activeElement !== summary) summary.value = chapterMeta.summary;
  const timelinePoint = document.querySelector('#story-chapter-timeline-point');
  if (document.activeElement !== timelinePoint) timelinePoint.value = chapterMeta.timelinePoint;
  const status = document.querySelector('#story-chapter-status');
  if (document.activeElement !== status) status.value = chapterMeta.status;

  const pov = document.querySelector('#story-chapter-pov');
  if (document.activeElement !== pov) {
    const selectedPov = chapterMeta.povCharacterId;
    pov.replaceChildren(new Option('No POV character', ''));
    characters.forEach((character) => pov.add(new Option(character.name, character.id)));
    pov.value = characters.some((character) => character.id === selectedPov) ? selectedPov : '';
  }
  const location = document.querySelector('#story-chapter-location');
  if (document.activeElement !== location) {
    const selectedPlaceId = placeMap.find((item) => item.chapter.toLowerCase() === chapter.title.toLowerCase())?.placeId || '';
    location.replaceChildren(new Option('No location', ''));
    places.forEach((place) => location.add(new Option(place.name, place.id)));
    location.value = selectedPlaceId;
  }
  const lastEdited = chapterMeta.updatedAt
    || storyDrafts[activeStoryId]?.updatedAt
    || savedStories.find((story) => story.id === activeStoryId)?.updatedAt
    || '';
  document.querySelector('#story-chapter-last-edited').textContent = formatChapterLastEdited(lastEdited);
  const previousTitle = document.querySelector('#story-previous-summary-title');
  const previousText = document.querySelector('#story-previous-summary-text');
  if (index > 0) {
    previousTitle.textContent = `Chapter ${index} · ${chapters[index - 1].title}`;
    previousText.textContent = metadata[index - 1].summary || 'No summary saved for the previous chapter yet.';
  } else {
    previousTitle.textContent = 'Previous chapter';
    previousText.textContent = 'This is the first chapter.';
  }
  details.classList.remove('hidden');
}

function renderStoryChapters() {
  const text = document.querySelector('#story-text').value;
  const chapters = parseStoryChapters(text);
  const list = document.querySelector('#story-chapter-list');
  const placeMap = parseStoryChapterPlaces(document.querySelector('#story-chapter-places').value);
  activeStoryChapterIndex = chapters.length ? Math.min(Math.max(activeStoryChapterIndex, 0), chapters.length - 1) : -1;
  const metadata = storyChapterMetadata(chapters);
  renderStoryNoteChapterOptions(chapters);
  const totalWords = countWords(text);
  const averageWords = chapters.length ? Math.round(chapters.reduce((sum, chapter) => sum + chapter.words, 0) / chapters.length) : 0;
  document.querySelector('#story-pacing-summary').textContent = chapters.length
    ? `${chapters.length} chapters · ${totalWords.toLocaleString()} words · ${Math.max(1, Math.ceil(totalWords / 220))} min read · ${averageWords.toLocaleString()} words per chapter on average`
    : `${totalWords.toLocaleString()} words · ${totalWords ? `${Math.max(1, Math.ceil(totalWords / 220))} min read` : 'No reading time yet'}`;
  list.replaceChildren();
  document.querySelector('#story-chapter-count').textContent = chapters.length
    ? `${chapters.length} chapter${chapters.length === 1 ? '' : 's'}` : 'None yet';
  document.querySelector('#story-chapter-hint').classList.toggle('hidden', chapters.length > 0);
  chapters.forEach((chapter, index) => {
    const row = document.createElement('li');
    row.draggable = true;
    row.dataset.chapterIndex = String(index);
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'story-chapter-jump';
    jump.setAttribute('aria-current', index === activeStoryChapterIndex ? 'true' : 'false');
    const number = document.createElement('span');
    number.className = 'story-chapter-number';
    number.textContent = String(index + 1).padStart(2, '0');
    const name = document.createElement('strong');
    name.textContent = chapter.title;
    const meta = document.createElement('span');
    const status = metadata[index].status;
    meta.textContent = `${chapter.words.toLocaleString()} words · ${status[0].toUpperCase()}${status.slice(1)}`;
    jump.append(number, name, meta);
    jump.addEventListener('click', () => {
      activeStoryChapterIndex = index;
      renderStoryChapters();
      updateStoryCounter(text);
      jumpToStoryPosition(chapter.start, chapter.headingLength);
    });
    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'story-chapter-move';
    up.textContent = '↑';
    up.disabled = index === 0;
    up.setAttribute('aria-label', `Move ${chapter.title} up`);
    up.addEventListener('click', () => moveStoryChapter(index, index - 1));
    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'story-chapter-move';
    down.textContent = '↓';
    down.disabled = index === chapters.length - 1;
    down.setAttribute('aria-label', `Move ${chapter.title} down`);
    down.addEventListener('click', () => moveStoryChapter(index, index + 1));
    row.addEventListener('dragstart', (event) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
      row.classList.add('is-dragging');
    });
    row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
    row.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    });
    row.addEventListener('dragenter', (event) => {
      event.preventDefault();
      row.classList.add('is-drop-target');
    });
    row.addEventListener('dragleave', (event) => {
      if (!row.contains(event.relatedTarget)) row.classList.remove('is-drop-target');
    });
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      row.classList.remove('is-drop-target');
      const sourceIndex = Number(event.dataTransfer.getData('text/plain'));
      moveStoryChapter(sourceIndex, index);
    });
    row.append(jump, up, down);
    list.append(row);
  });
  if (chapters.length) document.querySelector('#story-chapters-panel').open = true;
  renderStoryChapterDetails(chapters, metadata, placeMap);
  renderStoryContinuity(chapters, placeMap);
}

function parseStoryChapterPlaces(value) {
  let list = value;
  if (typeof list === 'string') {
    try { list = JSON.parse(list || '[]'); } catch { return []; }
  }
  if (!Array.isArray(list)) return [];
  return list.slice(0, 100).filter((item) => item && typeof item.chapter === 'string' && typeof item.placeId === 'string')
    .map((item) => ({ chapter: item.chapter.trim().slice(0, 100), placeId: item.placeId.trim().slice(0, 100) }))
    .filter((item) => item.chapter && item.placeId && places.some((place) => place.id === item.placeId));
}

function storySnapshotsForChapters(character, chapters) {
  return parseCharacterSnapshots(character.snapshots).map((snapshot, sourceIndex) => ({
    ...snapshot,
    sourceIndex,
    chapterIndex: chapters.findIndex((chapter) => {
      const when = snapshot.when.trim().toLowerCase();
      const title = chapter.title.trim().toLowerCase();
      return when === title || when.startsWith(`${title} ·`) || when.startsWith(`${title} -`) || when.startsWith(`${title}:`);
    }),
  })).filter((snapshot) => snapshot.chapterIndex >= 0)
    .sort((a, b) => a.chapterIndex - b.chapterIndex || a.sourceIndex - b.sourceIndex);
}

function snapshotForStoryChapter(snapshots, chapterIndex) {
  const latest = (key) => snapshots.filter((snapshot) => snapshot.chapterIndex <= chapterIndex && snapshot[key]).at(-1)?.[key] || '';
  return { location: latest('location'), availability: latest('availability') };
}

function parseStoryTimelinePoint(value) {
  const point = value.trim();
  const date = point.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (date) {
    const parsedDate = new Date(`${point}T00:00:00Z`);
    if (!Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === point) {
      return Number(date[1]) + (Number(date[2]) - 1) / 12 + (Number(date[3]) - 1) / 365;
    }
    return null;
  }
  const year = point.match(/^(?:year\s+)?(\d{1,6})\s*(BCE?|CE|AD)?$/i);
  if (!year) return null;
  const numericYear = Number(year[1]);
  return /^(?:bc|bce)$/i.test(year[2] || '') ? -numericYear : numericYear;
}

function parseContinuityAge(value) {
  const age = value.match(/^\s*(\d{1,3})(?:\s*(?:years?|yo|y\/o)(?:\s*old)?)?\s*$/i);
  return age ? Number(age[1]) : null;
}

function normalizeContinuityLocation(value) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/^(?:the|a|an)\s+/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function continuityNameDistance(left, right, limit) {
  if (Math.abs(left.length - right.length) > limit) return limit + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let minimum = row;
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(current[column - 1] + 1, previous[column] + 1, previous[column - 1] + cost);
      minimum = Math.min(minimum, current[column]);
    }
    if (minimum > limit) return limit + 1;
    previous = current;
  }
  return previous[right.length];
}

function similarStoryPlaceName(location) {
  const normalized = normalizeContinuityLocation(location);
  if (normalized.length < 6) return null;
  const limit = normalized.length >= 10 ? 2 : 1;
  let best = null;
  let bestDistance = limit + 1;
  let tied = false;
  places.forEach((place) => {
    const candidate = normalizeContinuityLocation(place.name);
    if (!candidate || candidate === normalized) return;
    const distance = continuityNameDistance(normalized, candidate, limit);
    if (distance < bestDistance) {
      best = place;
      bestDistance = distance;
      tied = false;
    } else if (distance === bestDistance) tied = true;
  });
  return bestDistance <= limit && !tied ? best : null;
}

function renderStoryContinuity(chapters, placeMap) {
  const checker = document.querySelector('#story-continuity-checker');
  const summary = document.querySelector('#story-continuity-summary');
  checker.replaceChildren();
  const metadata = storyChapterMetadata(chapters);
  const snapshots = new Map(characters.map((character) => [character.id, storySnapshotsForChapters(character, chapters)]));
  const timelinePoints = metadata.map((chapter) => parseStoryTimelinePoint(chapter.timelinePoint));
  const linkedCharacterIds = new Set([...document.querySelectorAll('#story-characters input:checked')].map((input) => input.value));
  const warnings = [];
  const warningKeys = new Set();
  const storyReferenceIds = new Set();
  const addWarning = (key, message) => {
    if (warningKeys.has(key)) return;
    warningKeys.add(key);
    warnings.push(message);
  };
  let previousDatedChapter = null;
  chapters.forEach((chapter, index) => {
    const content = document.querySelector('#story-text').value.slice(chapter.start + chapter.headingLength, chapter.end);
    const mentions = findCharacterMentions(content);
    const mentionedIds = new Set(mentions.map(({ character }) => character.id));
    const references = new Map(mentions.map(({ character }) => [character.id, character]));
    const povCharacter = characters.find((character) => character.id === metadata[index].povCharacterId);
    if (povCharacter) references.set(povCharacter.id, povCharacter);
    const placeId = placeMap.find((item) => item.chapter.toLowerCase() === chapter.title.toLowerCase())?.placeId;
    const scenePlace = places.find((place) => place.id === placeId);
    const timelinePoint = timelinePoints[index];
    if (timelinePoint !== null) {
      if (previousDatedChapter && timelinePoint < previousDatedChapter.point) {
        addWarning(`timeline:${index}`, `“${chapter.title}” is dated ${metadata[index].timelinePoint}, before the previous dated chapter “${previousDatedChapter.title}” (${previousDatedChapter.label}).`);
      }
      previousDatedChapter = { point: timelinePoint, title: chapter.title, label: metadata[index].timelinePoint };
    }
    references.forEach((character) => {
      storyReferenceIds.add(character.id);
      const state = snapshotForStoryChapter(snapshots.get(character.id) || [], index);
      if (!linkedCharacterIds.has(character.id)) {
        const referenceKind = mentionedIds.has(character.id) ? '@mentioned' : 'set as the POV character';
        addWarning(`${index}:${character.id}:unlinked`, `${character.name} is ${referenceKind} in “${chapter.title}” but is not linked in this story’s cast.`);
      }
      if (state.availability === 'dead') {
        addWarning(`${index}:${character.id}:dead`, `${character.name} is used in “${chapter.title}” but their latest snapshot marks them dead.`);
      } else if (state.availability === 'absent') {
        addWarning(`${index}:${character.id}:absent`, `${character.name} is used in “${chapter.title}” but their latest snapshot marks them absent.`);
      }
      if (scenePlace && state.location && normalizeContinuityLocation(state.location) !== normalizeContinuityLocation(scenePlace.name)) {
        addWarning(`${index}:${character.id}:place:${state.location.toLowerCase()}`, `${character.name} is in “${chapter.title}” at ${scenePlace.name}, but their latest snapshot places them at ${state.location}.`);
      }
    });
  });
  characters.forEach((character) => {
    if (!storyReferenceIds.has(character.id)) return;
    const characterSnapshots = snapshots.get(character.id) || [];
    const ageByChapter = new Map();
    characterSnapshots.forEach((snapshot) => {
      const age = parseContinuityAge(snapshot.age);
      if (age !== null) ageByChapter.set(snapshot.chapterIndex, { age, title: chapters[snapshot.chapterIndex].title });
      if (snapshot.location) {
        const suggestedPlace = similarStoryPlaceName(snapshot.location);
        if (suggestedPlace) {
          addWarning(`${character.id}:${snapshot.chapterIndex}:place-name:${snapshot.location.toLowerCase()}`,
            `${character.name}’s snapshot calls a location “${snapshot.location}”, close to the project place “${suggestedPlace.name}”. Check for a place-name variation.`);
        }
      }
    });
    const agePoints = [...ageByChapter.entries()].sort(([a], [b]) => a - b);
    agePoints.forEach(([chapterIndex, point], index) => {
      if (!index) return;
      const [previousChapterIndex, previous] = agePoints[index - 1];
      const ageChange = point.age - previous.age;
      if (ageChange < 0) {
        addWarning(`${character.id}:${previousChapterIndex}:${chapterIndex}:age-order`,
          `${character.name}’s snapshot age goes from ${previous.age} in “${previous.title}” to ${point.age} in “${point.title}”.`);
        return;
      }
      const previousTime = timelinePoints[previousChapterIndex];
      const currentTime = timelinePoints[chapterIndex];
      if (previousTime === null || currentTime === null || currentTime < previousTime) return;
      const elapsedYears = currentTime - previousTime;
      const minimumChange = Math.max(0, Math.floor(elapsedYears) - 1);
      const maximumChange = Math.floor(elapsedYears) + 1;
      if (ageChange < minimumChange || ageChange > maximumChange) {
        addWarning(`${character.id}:${previousChapterIndex}:${chapterIndex}:age-time`,
          `${character.name}’s age changes from ${previous.age} to ${point.age} across ${previous.title} (${metadata[previousChapterIndex].timelinePoint}) and ${point.title} (${metadata[chapterIndex].timelinePoint}). Check the timeline or snapshots.`);
      }
    });
  });
  if (!chapters.length) {
    checker.textContent = 'Add chapter headings (## Chapter name) to assign scene places and run continuity checks.';
    summary.classList.add('hidden');
    return;
  }
  if (!warnings.length) {
    checker.textContent = 'No possible continuity conflicts found. Add in-world time and character snapshots with age, location, or availability for more useful checks.';
    summary.classList.add('hidden');
    return;
  }
  const heading = document.createElement('strong');
  heading.textContent = `${warnings.length} continuity warning${warnings.length === 1 ? '' : 's'}`;
  const list = document.createElement('ul');
  warnings.forEach((warning) => {
    const item = document.createElement('li');
    item.textContent = warning;
    list.append(item);
  });
  checker.append(heading, list);
  summary.textContent = `${warnings.length} continuity warning${warnings.length === 1 ? '' : 's'} — review the Chapters panel.`;
  summary.classList.remove('hidden');
}

function recordStoryVersion(story, label = '') {
  const list = storyVersions[story.id] || [];
  const latest = list[0];
  if (latest && latest.title === story.title && latest.text === story.text) return;
  if (story.id === activeStoryId) storyCompareSelection = [];
  const entry = { at: story.updatedAt || new Date().toISOString(), title: story.title, text: story.text, label };
  storyVersions[story.id] = [entry, ...list].slice(0, MAX_STORY_VERSIONS);
  if (!writeStorage(STORY_VERSIONS_KEY, storyVersions)) {
    storyVersions[story.id] = storyVersions[story.id].slice(0, 3);
    if (!writeStorage(STORY_VERSIONS_KEY, storyVersions)) {
      storyVersions[story.id] = list;
      showToast('Saved, but version history is full. Older snapshots were kept as they were.');
    }
  }
}

function renderStoryHistory() {
  const versions = storyVersions[activeStoryId] || [];
  const list = document.querySelector('#story-history-list');
  const comparison = document.querySelector('#story-history-comparison');
  list.replaceChildren();
  document.querySelector('#story-history-count').textContent = versions.length
    ? `${versions.length} saved` : 'None yet';
  versions.forEach((version, index) => {
    const row = document.createElement('li');
    const info = document.createElement('span');
    info.className = 'story-history-info';
    const when = document.createElement('strong');
    const date = new Date(version.at);
    when.textContent = version.at && !Number.isNaN(date.getTime()) ? date.toLocaleString() : 'Earlier version';
    const detail = document.createElement('span');
    detail.textContent = [
      `${countWords(version.text).toLocaleString()} words`,
      version.label || (index === 0 ? 'Latest save' : ''),
    ].filter(Boolean).join(' · ');
    info.append(when, detail);
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'button button-quiet story-history-restore';
    restore.textContent = 'Restore';
    restore.addEventListener('click', () => restoreStoryVersion(index));
    const compare = document.createElement('button');
    compare.type = 'button';
    compare.className = 'button button-quiet story-history-compare';
    const selected = storyCompareSelection.includes(index);
    compare.textContent = selected ? 'Selected' : 'Compare';
    compare.setAttribute('aria-pressed', String(selected));
    compare.addEventListener('click', () => {
      if (storyCompareSelection.includes(index)) {
        storyCompareSelection = storyCompareSelection.filter((item) => item !== index);
      } else {
        if (storyCompareSelection.length === 2) storyCompareSelection.shift();
        storyCompareSelection.push(index);
      }
      renderStoryHistory();
    });
    row.append(info, compare, restore);
    list.append(row);
  });
  comparison.replaceChildren();
  comparison.classList.toggle('hidden', storyCompareSelection.length === 0);
  comparison.classList.toggle('is-pair', storyCompareSelection.length === 2);
  if (storyCompareSelection.length === 1) {
    comparison.textContent = 'Select one more version to compare.';
  } else if (storyCompareSelection.length === 2) {
    const selectedVersions = storyCompareSelection.map((index) => versions[index]).filter(Boolean);
    if (selectedVersions.length === 2) {
      selectedVersions.forEach((version) => {
        const panel = document.createElement('article');
        panel.className = 'story-history-compare-version';
        const heading = document.createElement('h4');
        const date = new Date(version.at);
        heading.textContent = `${version.title || 'Untitled story'} · ${version.at && !Number.isNaN(date.getTime()) ? date.toLocaleString() : 'Earlier version'}`;
        const body = document.createElement('pre');
        body.textContent = version.text;
        panel.append(heading, body);
        comparison.append(panel);
      });
    }
  }
}

function updateStorySaveStatus(state) {
  const status = document.querySelector('#story-save-status');
  const labels = {
    unsaved: 'Unsaved changes',
    saving: 'Saving…',
    saved: 'Saved',
  };
  status.dataset.saveState = state;
  status.textContent = labels[state] || labels.unsaved;
}

function restoreStoryVersion(index) {
  const version = (storyVersions[activeStoryId] || [])[index];
  if (!version) return;
  const current = currentStoryDraft();
  if (current.title === version.title && current.text === version.text) {
    showToast('The editor already has that version.');
    return;
  }
  if (savedStories.some((story) => story.id === activeStoryId) && (current.text.trim() || current.title)) {
    recordStoryVersion(current, 'Before restore');
  }
  document.querySelector('#story-title').value = version.title;
  document.querySelector('#story-text').value = version.text;
  handleStoryEditorInput();
  renderStoryHistory();
  showToast('Version restored in the editor. Save to keep it, or Discard changes to go back.');
}

function updateStoryCounter(text = '') {
  const chapters = parseStoryChapters(text);
  const chapter = chapters[activeStoryChapterIndex];
  const chapterCount = chapter ? chapter.words : chapters.length ? 0 : countWords(text);
  const totalCount = chapters.length ? countStoryGoalWords(text) : countWords(text);
  const counter = document.querySelector('#story-word-count');
  const chapterLabel = chapter ? chapter.title : 'Current chapter';
  document.querySelector('#story-chapter-word-count').textContent =
    `${chapterLabel}: ${chapterCount.toLocaleString()} word${chapterCount === 1 ? '' : 's'}`;
  document.querySelector('#story-total-word-count').textContent =
    `Story total: ${totalCount.toLocaleString()} word${totalCount === 1 ? '' : 's'}`;
  const extras = [];
  if (writingPreferences.wordCount === 'words-characters' || writingPreferences.wordCount === 'all') {
    extras.push(`${text.length.toLocaleString()} / 30,000 characters`);
  }
  if (writingPreferences.wordCount === 'words-reading-time' || writingPreferences.wordCount === 'all') {
    const minutes = totalCount ? Math.max(1, Math.ceil(totalCount / 220)) : 0;
    extras.push(`${minutes} min read`);
  }
  document.querySelector('#story-word-count-extras').textContent = extras.join(' · ');
  counter.classList.toggle('is-near-limit', text.length >= 27000);
  document.querySelector('#story-starters').classList.toggle('hidden', Boolean(text.trim()));
}

function renderStoryNoteChapterOptions(chapters) {
  const select = document.querySelector('#story-note-chapter');
  const previous = select.value;
  select.replaceChildren(new Option('Use cursor chapter', ''));
  select.add(new Option('No chapter', '__general__'));
  chapters.forEach((chapter) => select.add(new Option(chapter.title, chapter.title)));
  if (previous === '__general__' || chapters.some((chapter) => chapter.title === previous)) select.value = previous;
}

function syncStoryChapterFromCaret() {
  const textarea = document.querySelector('#story-text');
  const chapterIndex = parseStoryChapters(textarea.value)
    .findIndex((chapter) => textarea.selectionStart >= chapter.start && textarea.selectionStart <= chapter.end);
  if (chapterIndex < 0 || chapterIndex === activeStoryChapterIndex) return;
  activeStoryChapterIndex = chapterIndex;
  renderStoryChapters();
  updateStoryCounter(textarea.value);
}

function normalizeWritingGoals(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const rawTarget = Number(source.target);
  const days = source.days && typeof source.days === 'object' && !Array.isArray(source.days) ? source.days : {};
  const normalizedDays = {};
  Object.entries(days).slice(-400).forEach(([date, count]) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Number(count)) && Number(count) > 0) {
      normalizedDays[date] = Math.min(1_000_000, Math.floor(Number(count)));
    }
  });
  return {
    target: Number.isFinite(rawTarget) ? Math.min(20000, Math.max(50, Math.round(rawTarget))) : 500,
    days: normalizedDays,
  };
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function writingStreak() {
  const today = new Date();
  const todayKey = localDateKey(today);
  const targetDate = writingGoals.days[todayKey] >= writingGoals.target ? 0
    : writingGoals.days[localDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1))] >= writingGoals.target ? 1 : -1;
  if (targetDate < 0) return 0;
  let streak = 0;
  for (let offset = targetDate; offset < 400; offset += 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    if ((writingGoals.days[localDateKey(date)] || 0) < writingGoals.target) break;
    streak += 1;
  }
  return streak;
}

function renderWritingGoal() {
  const todayWords = writingGoals.days[localDateKey()] || 0;
  const target = writingGoals.target;
  const progress = Math.min(100, Math.round((todayWords / target) * 100));
  const bar = document.querySelector('#story-goal-progress');
  document.querySelector('#story-writing-goal-label').textContent = todayWords >= target ? 'Daily writing goal complete!' : 'Today’s writing goal';
  document.querySelector('#story-writing-streak').textContent = `${writingStreak()} day streak`;
  document.querySelector('#story-writing-goal-count').textContent = `${todayWords.toLocaleString()} / ${target.toLocaleString()} words today`;
  document.querySelector('#story-daily-target').value = String(target);
  document.querySelector('#settings-writing-goal').value = String(target);
  document.querySelector('#story-goal-progress-fill').style.width = `${progress}%`;
  bar.setAttribute('aria-valuemax', String(target));
  bar.setAttribute('aria-valuenow', String(Math.min(todayWords, target)));
}

function recordStoryWords(words) {
  if (words === 0) return;
  const today = localDateKey();
  const previous = writingGoals.days[today] || 0;
  const updated = Math.min(1_000_000, Math.max(0, previous + words));
  if (updated) writingGoals.days[today] = updated;
  else delete writingGoals.days[today];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 400);
  const cutoffKey = localDateKey(cutoff);
  Object.keys(writingGoals.days).forEach((date) => {
    if (date < cutoffKey) delete writingGoals.days[date];
  });
  if (!writeStorage(WRITING_GOALS_KEY, writingGoals)) {
    if (previous) writingGoals.days[today] = previous;
    else delete writingGoals.days[today];
    showToast('Writing progress could not be saved. Your browser storage may be full.');
    renderWritingGoal();
    return;
  }
  scheduleFolderBackup();
  renderWritingGoal();
}

function setWritingGoalTarget(value) {
  if (!Number.isFinite(value) || value < 50 || value > 20000) {
    showToast('Choose a daily target from 50 to 20,000 words.');
    renderWritingGoal();
    return;
  }
  const previousTarget = writingGoals.target;
  writingGoals.target = Math.round(value / 50) * 50;
  if (!writeStorage(WRITING_GOALS_KEY, writingGoals)) {
    writingGoals.target = previousTarget;
    showToast('Your writing target could not be saved. Your browser storage may be full.');
    renderWritingGoal();
    return;
  }
  scheduleFolderBackup();
  renderWritingGoal();
}

function renderStoryNotesAndTodos(story = {}) {
  const notes = normalizeStoryNotes(story.notes);
  const todos = normalizeStoryTodos(story.todos);
  document.querySelector('#story-notes-data').value = JSON.stringify(notes);
  document.querySelector('#story-todos-data').value = JSON.stringify(todos);
  const notesList = document.querySelector('#story-notes-list');
  notesList.replaceChildren();
  notes.forEach((note) => {
    const item = document.createElement('li');
    const content = document.createElement('div');
    content.className = 'story-note-content';
    const text = document.createElement('span');
    text.textContent = note.text;
    content.append(text);
    if (note.quote) {
      const quote = document.createElement('blockquote');
      quote.textContent = note.quote;
      content.append(quote);
    }
    if (note.chapter) {
      const chapter = document.createElement('button');
      chapter.type = 'button';
      chapter.className = 'story-note-chapter';
      chapter.textContent = note.chapter;
      chapter.addEventListener('click', () => {
        const textarea = document.querySelector('#story-text');
        const chapterIndex = parseStoryChapters(textarea.value).findIndex((entry) => entry.title === note.chapter);
        if (chapterIndex < 0) {
          showToast('That chapter heading no longer exists.');
          return;
        }
        activeStoryChapterIndex = chapterIndex;
        renderStoryChapters();
        updateStoryCounter(textarea.value);
        const target = parseStoryChapters(textarea.value)[chapterIndex];
        jumpToStoryPosition(target.start, target.headingLength);
      });
      content.append(chapter);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove note: ${note.text}`);
    remove.addEventListener('click', () => {
      document.querySelector('#story-notes-data').value = JSON.stringify(notes.filter((entry) => entry.id !== note.id));
      renderStoryNotesAndTodos({ notes: document.querySelector('#story-notes-data').value, todos: document.querySelector('#story-todos-data').value });
      handleStoryEditorInput();
    });
    item.append(content, remove);
    notesList.append(item);
  });

  const todoList = document.querySelector('#story-todos-list');
  todoList.replaceChildren();
  todos.forEach((todo) => {
    const item = document.createElement('li');
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = todo.done;
    const text = document.createElement('span');
    text.textContent = todo.text;
    label.append(checkbox, text);
    checkbox.addEventListener('change', () => {
      const updated = todos.map((entry) => entry.id === todo.id ? { ...entry, done: checkbox.checked } : entry);
      document.querySelector('#story-todos-data').value = JSON.stringify(updated);
      renderStoryNotesAndTodos({ notes: document.querySelector('#story-notes-data').value, todos: updated });
      handleStoryEditorInput();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove task: ${todo.text}`);
    remove.addEventListener('click', () => {
      const updated = todos.filter((entry) => entry.id !== todo.id);
      document.querySelector('#story-todos-data').value = JSON.stringify(updated);
      renderStoryNotesAndTodos({ notes: document.querySelector('#story-notes-data').value, todos: updated });
      handleStoryEditorInput();
    });
    item.append(label, remove);
    todoList.append(item);
  });
  const remaining = todos.filter((todo) => !todo.done).length;
  document.querySelector('#story-todo-count').textContent = `${remaining} task${remaining === 1 ? '' : 's'} left`;
}

function openCharacterEditorFromStory() {
  storyToResumeAfterCharacterCreate = activeStoryId;
  handleStoryEditorInput();
  document.querySelector('#story-dialog').close();
  window.setTimeout(() => {
    const characters = document.querySelector('#characters');
    setActiveNavigation('characters');
    characters.scrollIntoView({ behavior: getMotionScrollBehavior() });
    document.querySelector('#character-new-button').click();
  }, 0);
}

function renderStoryCharacterPicker(selectedIds = []) {
  const picker = document.querySelector('#story-characters');
  picker.replaceChildren();
  if (!characters.length) {
    const hint = document.createElement('p');
    hint.className = 'story-picker-empty';
    hint.textContent = 'Create a character, then return here to connect them to this story.';
    const create = document.createElement('button');
    create.className = 'button button-outline story-picker-create';
    create.type = 'button';
    create.textContent = '＋ Create a character';
    create.addEventListener('click', openCharacterEditorFromStory);
    picker.append(hint, create);
    return;
  }
  characters.forEach((character) => {
    const chip = document.createElement('label');
    chip.className = 'story-character-chip';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = character.id;
    input.checked = selectedIds.includes(character.id);
    const name = document.createElement('span');
    name.textContent = character.name;
    chip.append(input, name);
    picker.append(chip);
  });
}

function insertStoryStarter(key) {
  const textarea = document.querySelector('#story-text');
  if (!STORY_STARTERS[key] || textarea.value.trim()) return;
  textarea.value = STORY_STARTERS[key];
  handleStoryEditorInput();
  textarea.focus();
  textarea.setSelectionRange(0, 0);
}

function renderStoryTemplatePreview(templateId) {
  const template = STORY_TEMPLATES[templateId];
  const preview = document.querySelector('#story-template-preview');
  const applyButton = document.querySelector('#story-template-apply');
  applyButton.disabled = !template;
  applyButton.textContent = template ? `Apply ${document.querySelector('#story-template-select').selectedOptions[0].textContent} template` : 'Apply template';
  preview.classList.toggle('hidden', !template);
  if (!template) return;
  document.querySelector('#story-template-description').textContent = template.description;
  [
    ['#story-template-characters', template.characters],
    ['#story-template-structure', template.structure],
    ['#story-template-chapters', template.chapters],
  ].forEach(([selector, items]) => {
    const list = document.querySelector(selector);
    list.replaceChildren(...items.map((item) => {
      const entry = document.createElement('li');
      entry.textContent = item;
      return entry;
    }));
  });
}

function applyStoryTemplate() {
  const select = document.querySelector('#story-template-select');
  const template = STORY_TEMPLATES[select.value];
  if (!template) {
    showToast('Choose a story template first.');
    select.focus();
    return;
  }
  const textarea = document.querySelector('#story-text');
  if (textarea.value.trim() && !window.confirm('Replace the current story text with this template outline? Your title and story details will stay as they are.')) return;
  const headingPrefix = writingPreferences.chapterFormat === 'markdown-h1' ? '# '
    : writingPreferences.chapterFormat === 'plain' ? '' : '## ';
  textarea.value = template.chapters.map((chapter, index) => `${headingPrefix}Chapter ${index + 1} · ${chapter}`).join('\n\n');
  handleStoryEditorInput();
  document.querySelector('#story-chapters-panel').open = true;
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  showToast(`${select.selectedOptions[0].textContent} outline added. Add your title and start writing.`);
}

let discardArmTimer = 0;
function disarmStoryDiscard() {
  window.clearTimeout(discardArmTimer);
  const button = document.querySelector('#story-discard');
  button.classList.remove('is-armed');
  const saved = savedStories.some((story) => story.id === activeStoryId);
  button.textContent = saved ? 'Discard changes' : 'Discard draft';
}

function discardStoryChanges() {
  const id = activeStoryId;
  const button = document.querySelector('#story-discard');
  const dialog = document.querySelector('#story-dialog');
  const saved = savedStories.some((story) => story.id === id);
  const current = currentStoryDraft();
  const hasDraft = Boolean(storyDrafts[id]);
  const hasContent = hasDraft || current.title || current.text.trim() || current.image;
  if (saved && !hasDraft) {
    showToast('No unsaved changes to discard.');
    return;
  }
  if (!saved && !hasContent) {
    dialog.close();
    return;
  }
  if (!button.classList.contains('is-armed')) {
    button.classList.add('is-armed');
    button.textContent = 'Click again to confirm';
    discardArmTimer = window.setTimeout(disarmStoryDiscard, 3500);
    return;
  }
  cancelStoryDraftSave();
  const nextDrafts = { ...storyDrafts };
  delete nextDrafts[id];
  if (!writeStorage(STORY_DRAFTS_KEY, nextDrafts)) {
    showToast('Could not discard this draft. Your browser storage may be unavailable.');
    return;
  }
  delete storyDrafts[id];
  if (saved) {
    openStoryEditor(id, storyReturnFocus);
    showToast('Changes discarded. Showing your last saved version.');
  } else {
    dialog.close();
    showToast('Draft discarded.');
  }
}

var storyViewTimer = 0;
let storyMentionMatches = [];
let storyMentionActiveIndex = 0;
let storyPeekKind = 'character';
let storyCompareSelection = [];

function renderStoryMentionSuggestions() {
  const textarea = document.querySelector('#story-text');
  const suggestions = document.querySelector('#story-mention-suggestions');
  const beforeCaret = textarea.value.slice(0, textarea.selectionStart);
  const mentionStart = beforeCaret.lastIndexOf('@');
  if (mentionStart < 0 || (mentionStart > 0 && /[\w@]/.test(beforeCaret[mentionStart - 1]))) {
    suggestions.classList.add('hidden');
    return;
  }
  const query = beforeCaret.slice(mentionStart + 1);
  if (/[\r\n]/.test(query) || query.length > 60) {
    suggestions.classList.add('hidden');
    return;
  }
  const normalizedQuery = query.trim().toLowerCase();
  storyMentionMatches = characters
    .filter((character) => !normalizedQuery || character.name.toLowerCase().includes(normalizedQuery))
    .sort((a, b) => Number(b.name.toLowerCase().startsWith(normalizedQuery)) - Number(a.name.toLowerCase().startsWith(normalizedQuery))
      || a.name.localeCompare(b.name))
    .slice(0, 7);
  storyMentionActiveIndex = 0;
  suggestions.replaceChildren();
  if (!storyMentionMatches.length) {
    suggestions.classList.add('hidden');
    return;
  }
  storyMentionMatches.forEach((character, index) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'story-mention-option';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(index === storyMentionActiveIndex));
    option.textContent = character.name;
    option.addEventListener('mousedown', (event) => event.preventDefault());
    option.addEventListener('click', () => insertStoryMention(character));
    suggestions.append(option);
  });
  suggestions.classList.remove('hidden');
}

function insertStoryMention(character) {
  const textarea = document.querySelector('#story-text');
  const caret = textarea.selectionStart;
  const beforeCaret = textarea.value.slice(0, caret);
  const mentionStart = beforeCaret.lastIndexOf('@');
  if (mentionStart < 0) return;
  const nextText = `${textarea.value.slice(0, mentionStart)}@${character.name} ${textarea.value.slice(caret)}`;
  const nextCaret = mentionStart + character.name.length + 2;
  textarea.value = nextText;
  textarea.setSelectionRange(nextCaret, nextCaret);
  document.querySelector('#story-mention-suggestions').classList.add('hidden');
  handleStoryEditorInput();
  textarea.focus();
}

function renderStoryPeekList() {
  const list = document.querySelector('#story-peek-list');
  const items = storyPeekKind === 'character' ? characters : storyPeekKind === 'place' ? places : worldEntries;
  list.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'story-picker-empty';
    empty.textContent = storyPeekKind === 'character' ? 'No characters to preview yet.'
      : storyPeekKind === 'place' ? 'No places to preview yet.' : 'No world entries to preview yet.';
    list.append(empty);
    return;
  }
  items.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'story-peek-item';
    button.textContent = item.name || 'Untitled';
    button.addEventListener('click', () => renderStoryPeekDetail(storyPeekKind, item.id));
    list.append(button);
  });
}

function renderStoryPeekDetail(kind, id) {
  const detail = document.querySelector('#story-peek-detail');
  const item = (kind === 'character' ? characters : kind === 'place' ? places : worldEntries).find((entry) => entry.id === id);
  detail.replaceChildren();
  if (!item) {
    detail.textContent = 'This item is no longer available.';
    return;
  }
  const heading = document.createElement('strong');
  heading.textContent = item.name || 'Untitled';
  detail.append(heading);
  const values = kind === 'character'
    ? [item.role, item.age && `Age: ${item.age}`, item.species && `Species: ${item.species}`, item.description, item.goal && `Goal: ${item.goal}`, item.secret && `Secret: ${item.secret}`]
    : kind === 'place'
      ? [PLACE_KINDS[item.kind] || item.kind, item.summary, item.description, item.atmosphere && `Atmosphere: ${item.atmosphere}`]
      : [WORLD_ENTRY_CATEGORIES[item.category] || 'World entry', item.summary, item.description, item.details, item.tags.length && `Tags: ${item.tags.join(', ')}`];
  values.filter(Boolean).forEach((value) => {
    const paragraph = document.createElement('p');
    paragraph.textContent = value;
    detail.append(paragraph);
  });
  if (kind === 'character') {
    const snapshots = parseCharacterSnapshots(item.snapshots);
    const latest = snapshots.at(-1);
    if (latest) {
      const state = document.createElement('p');
      state.textContent = [latest.when, latest.location && `At: ${latest.location}`, latest.availability && `Availability: ${latest.availability}`,
        latest.knowledge && `Knows: ${latest.knowledge}`, latest.trust && `Trusts: ${latest.trust}`].filter(Boolean).join(' · ');
      detail.append(state);
    }
  }
}

function showStoryPeek(kind, id) {
  const dialog = document.querySelector('#story-dialog');
  const editorVisible = dialog.open && !document.querySelector('#story-form').classList.contains('hidden');
  if (!editorVisible) {
    if (dialog.open && previewFromEditor) {
      previewFromEditor = false;
      setStoryDialogMode('edit');
    } else if (!dialog.open) {
      openStoryEditor(previewStoryId);
    } else {
      openStoryEditor(activeStoryId);
    }
  }
  const content = document.querySelector('#story-peek-content');
  const toggle = document.querySelector('#story-peek-toggle');
  content.classList.remove('hidden');
  document.querySelector('#story-peek-panel').classList.add('is-expanded');
  toggle.textContent = 'Close';
  toggle.setAttribute('aria-expanded', 'true');
  storyPeekKind = kind;
  document.querySelectorAll('[data-peek-kind]').forEach((button) => {
    button.classList.toggle('active', button.dataset.peekKind === kind);
  });
  renderStoryPeekList();
  renderStoryPeekDetail(kind, id);
}

function renderStoryEditorViews() {
  storyViewTimer = 0;
  renderStoryChapters();
  updateStoryPreview(currentStoryDraft());
}

function handleStoryEditorInput(event) {
  const storyText = document.querySelector('#story-text').value;
  if (event?.target?.id === 'story-text') {
    const caret = event.target.selectionStart;
    const chapterIndex = parseStoryChapters(storyText).findIndex((chapter) => caret >= chapter.start && caret <= chapter.end);
    if (chapterIndex >= 0) {
      activeStoryChapterIndex = chapterIndex;
      updateStoryChapterMetadata(chapterIndex, {});
    }
  }
  updateStoryCounter(storyText);
  const words = countStoryGoalWords(storyText);
  if (words !== lastStoryWordCount) recordStoryWords(words - lastStoryWordCount);
  lastStoryWordCount = words;
  renderStoryMentionSuggestions();
  window.clearTimeout(storyViewTimer);
  storyViewTimer = window.setTimeout(renderStoryEditorViews, 160);
  saveStoryDraft();
}

function handleStoryImageUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/') || file.size > MAX_IMAGE_UPLOAD_BYTES) {
    showToast('Choose a valid image that is 5 MB or smaller. You can also paste an image link.');
    event.target.value = '';
    return;
  }
  const input = event.target;
  resizeStoryImage(file).then((dataUrl) => {
    document.querySelector('#story-image-url').value = dataUrl;
    syncStoryImageChip();
    handleStoryEditorInput();
  }).catch(() => showToast('Could not read that image. Try another file or paste an image link.'))
    .finally(() => { input.value = ''; });
}

function imageHasTransparency(image) {
  const probe = document.createElement('canvas');
  probe.width = 48;
  probe.height = 48;
  const context = probe.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, 48, 48);
  const pixels = context.getImageData(0, 0, 48, 48).data;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] < 250) return true;
  }
  return false;
}

function resizeStoryImage(file, maxSide = 1400, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.addEventListener('load', () => {
      URL.revokeObjectURL(url);
      if (!image.naturalWidth || !image.naturalHeight) { reject(new Error('Unreadable image')); return; }
      let keepAlpha = false;
      try { keepAlpha = /^image\/(png|webp|gif)$/.test(file.type) && imageHasTransparency(image); } catch { keepAlpha = false; }
      const limit = keepAlpha ? Math.min(maxSide, 1000) : maxSide;
      const scale = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!keepAlpha) {
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(keepAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality));
    });
    image.addEventListener('error', () => { URL.revokeObjectURL(url); reject(new Error('Unreadable image')); });
    image.src = url;
  });
}

function currentDialogueDraft() {
  return {
    id: document.querySelector('#dialogue-draft-id').value || createId(),
    title: document.querySelector('#dialogue-title').value.trim().slice(0, 100),
    participantIds: [...document.querySelectorAll('#dialogue-character-list input:checked')].map((input) => input.value),
    context: document.querySelector('#dialogue-context').value.trim().slice(0, 700),
    text: document.querySelector('#dialogue-text').value.slice(0, 15000),
    storyId: document.querySelector('#dialogue-story').value,
    updatedAt: new Date().toISOString(),
  };
}

function dialogueStories() {
  const stories = new Map(savedStories.map((story) => [story.id, story]));
  Object.values(storyDrafts).forEach((draft) => stories.set(draft.id, { ...draft, isDraft: true }));
  return [...stories.values()].sort((first, second) => (first.title || '').localeCompare(second.title || ''));
}

function dialoguePassage(draft) {
  return [
    `**${draft.title}**`,
    draft.context ? `> **Emotional context:** ${draft.context.replace(/\r?\n/g, ' ')}` : '',
    draft.text.trim(),
  ].filter(Boolean).join('\n\n');
}

function renderDialogueCharacters(selectedIds = []) {
  const list = document.querySelector('#dialogue-character-list');
  list.replaceChildren();
  if (!characters.length) {
    const empty = document.createElement('p');
    empty.className = 'dialogue-empty-hint';
    empty.textContent = 'Add characters in Characters to include them here.';
    list.append(empty);
    return;
  }
  characters.forEach((character) => {
    const label = document.createElement('label');
    label.className = 'dialogue-character-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = character.id;
    checkbox.checked = selectedIds.includes(character.id);
    const name = document.createElement('span');
    name.textContent = character.name;
    label.append(checkbox, name);
    list.append(label);
  });
}

function renderDialogueStories(selectedId = '') {
  const select = document.querySelector('#dialogue-story');
  const stories = dialogueStories();
  select.replaceChildren(new Option('Choose a story', ''));
  stories.forEach((story) => {
    const option = new Option(`${story.title || 'Untitled story'}${story.isDraft ? ' · Draft' : ''}`, story.id);
    select.add(option);
  });
  select.value = stories.some((story) => story.id === selectedId) ? selectedId : '';
  document.querySelector('#dialogue-create-story').classList.toggle('hidden', stories.length > 0);
}

function renderDialogueDraftList() {
  const list = document.querySelector('#dialogue-draft-list');
  const empty = document.querySelector('#dialogue-drafts-empty');
  const entries = Object.values(dialogueDrafts).sort((first, second) => (second.updatedAt || '').localeCompare(first.updatedAt || ''));
  list.replaceChildren();
  entries.forEach((draft) => {
    const item = document.createElement('article');
    item.className = 'dialogue-draft-item';
    const info = document.createElement('div');
    info.className = 'dialogue-draft-info';
    const title = document.createElement('strong');
    title.textContent = draft.title || 'Untitled conversation';
    const preview = document.createElement('span');
    preview.textContent = draft.text.trim() || draft.context || 'No dialogue yet.';
    info.append(title, preview);
    const actions = document.createElement('div');
    actions.className = 'dialogue-draft-actions';
    const load = document.createElement('button');
    load.type = 'button';
    load.className = 'button button-quiet';
    load.dataset.loadDialogue = draft.id;
    load.setAttribute('aria-current', document.querySelector('#dialogue-draft-id').value === draft.id ? 'true' : 'false');
    load.textContent = 'Open';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'button button-quiet dialogue-draft-remove';
    remove.dataset.deleteDialogue = draft.id;
    remove.setAttribute('aria-label', `Delete ${draft.title || 'untitled conversation'}`);
    remove.textContent = '×';
    actions.append(load, remove);
    item.append(info, actions);
    list.append(item);
  });
  document.querySelector('#dialogue-draft-count').textContent = String(entries.length);
  empty.classList.toggle('hidden', entries.length > 0);
}

function updateDialogueSaveButton() {
  const draft = currentDialogueDraft();
  const story = storyDrafts[draft.storyId] || savedStories.find((item) => item.id === draft.storyId);
  const passage = dialoguePassage(draft);
  const alreadyAdded = Boolean(story && passage.trim() && story.text.includes(passage));
  const button = document.querySelector('#dialogue-add-to-story');
  button.disabled = !story || !draft.title || !draft.text.trim() || alreadyAdded;
  button.textContent = alreadyAdded ? 'Already in story' : 'Add conversation';
}

function saveDialogueDraft(showSuccess = false) {
  const draft = currentDialogueDraft();
  if (!draft.title && !draft.context && !draft.text.trim() && !draft.participantIds.length) return true;
  const existing = dialogueDrafts[draft.id];
  if (existing && existing.title === draft.title && existing.context === draft.context
    && existing.text === draft.text && existing.storyId === draft.storyId
    && existing.participantIds.length === draft.participantIds.length
    && existing.participantIds.every((id, index) => id === draft.participantIds[index])) {
    document.querySelector('#dialogue-draft-id').value = draft.id;
    document.querySelector('#dialogue-save-status').textContent = 'Draft saved on this device';
    updateDialogueSaveButton();
    if (showSuccess) showToast('Conversation draft saved.');
    return true;
  }
  draft.updatedAt = new Date().toISOString();
  const nextDrafts = { ...dialogueDrafts, [draft.id]: draft };
  if (!writeStorage(DIALOGUE_DRAFTS_KEY, nextDrafts)) {
    document.querySelector('#dialogue-save-status').textContent = 'Draft not saved';
    showToast('Could not save this conversation. Your browser storage may be full.');
    return false;
  }
  Object.keys(dialogueDrafts).forEach((id) => delete dialogueDrafts[id]);
  Object.assign(dialogueDrafts, nextDrafts);
  document.querySelector('#dialogue-draft-id').value = draft.id;
  document.querySelector('#dialogue-save-status').textContent = 'Draft saved on this device';
  renderDialogueDraftList();
  updateDialogueSaveButton();
  scheduleFolderBackup();
  if (showSuccess) showToast('Conversation draft saved.');
  return true;
}

function scheduleDialogueDraftSave() {
  document.querySelector('#dialogue-save-status').textContent = 'Saving…';
  window.clearTimeout(dialogueDraftTimer);
  dialogueDraftTimer = window.setTimeout(() => saveDialogueDraft(), 450);
  updateDialogueSaveButton();
}

function flushDialogueDraft() {
  window.clearTimeout(dialogueDraftTimer);
  dialogueDraftTimer = 0;
  return saveDialogueDraft();
}

function startNewDialogue(saveCurrent = true) {
  if (saveCurrent && !flushDialogueDraft()) return;
  document.querySelector('#dialogue-draft-id').value = '';
  document.querySelector('#dialogue-title').value = '';
  document.querySelector('#dialogue-context').value = '';
  document.querySelector('#dialogue-text').value = '';
  renderDialogueCharacters();
  renderDialogueStories();
  document.querySelector('#dialogue-save-status').textContent = 'A new conversation is ready.';
  renderDialogueDraftList();
  updateDialogueSaveButton();
  document.querySelector('#dialogue-title').focus();
}

function loadDialogueDraft(id) {
  if (!flushDialogueDraft()) return;
  const draft = dialogueDrafts[id];
  if (!draft) {
    showToast('This conversation draft is no longer available.');
    renderDialogueDraftList();
    return;
  }
  document.querySelector('#dialogue-draft-id').value = draft.id;
  document.querySelector('#dialogue-title').value = draft.title;
  document.querySelector('#dialogue-context').value = draft.context;
  document.querySelector('#dialogue-text').value = draft.text;
  renderDialogueCharacters(draft.participantIds);
  renderDialogueStories(draft.storyId);
  document.querySelector('#dialogue-save-status').textContent = 'Draft opened';
  renderDialogueDraftList();
  updateDialogueSaveButton();
  document.querySelector('#dialogue-title').focus();
}

function deleteDialogueDraft(id) {
  const draft = dialogueDrafts[id];
  if (!draft || !window.confirm(`Delete "${draft.title || 'Untitled conversation'}" permanently?`)) return;
  const nextDrafts = { ...dialogueDrafts };
  delete nextDrafts[id];
  if (!writeStorage(DIALOGUE_DRAFTS_KEY, nextDrafts)) {
    showToast('Could not delete this conversation draft. Your browser storage may be unavailable.');
    return;
  }
  delete dialogueDrafts[id];
  if (document.querySelector('#dialogue-draft-id').value === id) startNewDialogue(false);
  renderDialogueDraftList();
  scheduleFolderBackup();
  showToast('Conversation draft deleted.');
}

function saveDialogueToStory() {
  const draft = currentDialogueDraft();
  if (!draft.title) {
    showToast('Add a title to this conversation first.');
    document.querySelector('#dialogue-title').focus();
    return;
  }
  if (!draft.text.trim()) {
    showToast('Write some dialogue before adding it to a story.');
    document.querySelector('#dialogue-text').focus();
    return;
  }
  const storyId = document.querySelector('#dialogue-story').value;
  const story = storyDrafts[storyId] || savedStories.find((item) => item.id === storyId);
  if (!story) {
    showToast('Choose a story to add this conversation to.');
    document.querySelector('#dialogue-story').focus();
    return;
  }
  document.querySelector('#dialogue-draft-id').value = draft.id;
  if (!saveDialogueDraft()) return;
  const passage = dialoguePassage(draft);
  if (story.text.includes(passage)) {
    document.querySelector('#dialogue-save-status').textContent = 'This dialogue is already in that story.';
    updateDialogueSaveButton();
    return;
  }
  const separator = story.text.trim() ? '\n\n---\n\n' : '';
  const text = `${story.text.trimEnd()}${separator}${passage}`;
  if (text.length > 30000) {
    showToast('This story is at its 30,000-character limit. Shorten it before adding the conversation.');
    return;
  }
  const participantIds = new Set(characters.map((character) => character.id));
  const updatedStory = {
    ...story,
    text,
    characterIds: [...new Set([...(story.characterIds || []), ...draft.participantIds.filter((id) => participantIds.has(id))])],
    updatedAt: new Date().toISOString(),
  };
  const nextDialogueDrafts = {
    ...dialogueDrafts,
    [draft.id]: { ...draft, storyId, updatedAt: new Date().toISOString() },
  };
  const updates = [[DIALOGUE_DRAFTS_KEY, nextDialogueDrafts]];
  const storyIsDraft = Boolean(storyDrafts[storyId]);
  let nextStories = savedStories;
  let nextStoryDrafts = storyDrafts;
  if (storyIsDraft) {
    nextStoryDrafts = { ...storyDrafts, [storyId]: updatedStory };
    updates.push([STORY_DRAFTS_KEY, nextStoryDrafts]);
  } else {
    nextStories = savedStories.map((item) => item.id === storyId ? updatedStory : item);
    updates.push([STORIES_STORAGE_KEY, nextStories]);
  }
  if (!commitStorageUpdates(updates)) {
    showToast('Could not add this conversation to the story. Your browser storage may be full.');
    return;
  }
  if (storyIsDraft) {
    Object.keys(storyDrafts).forEach((id) => delete storyDrafts[id]);
    Object.assign(storyDrafts, nextStoryDrafts);
  } else {
    recordStoryVersion(story, 'Before Dialogue Workshop');
    savedStories.splice(0, savedStories.length, ...nextStories);
    recordStoryVersion(updatedStory, 'Dialogue Workshop');
  }
  Object.keys(dialogueDrafts).forEach((id) => delete dialogueDrafts[id]);
  Object.assign(dialogueDrafts, nextDialogueDrafts);
  recordStoryWords(countStoryGoalWords(passage));
  renderDialogueDraftList();
  renderDialogueStories(storyId);
  updateDialogueSaveButton();
  document.querySelector('#dialogue-save-status').textContent = `Added to ${story.title || 'your story'}`;
  renderStories();
  renderCharacters();
  renderPlaces();
  window.FictionTalesPlanning?.reloadFromStorage();
  persistCharacterLibrary();
  scheduleFolderBackup();
  showToast(`Conversation added to ${story.title || 'your story'}.`);
}

var dialogueDraftTimer = 0;

function renderStories() {
  const library = document.querySelector('#story-library');
  library.replaceChildren();
  const savedById = new Map(savedStories.map((story) => [story.id, story]));
  const all = [...savedStories];
  Object.values(storyDrafts).forEach((draft) => {
    const saved = savedById.get(draft.id);
    const item = { ...draft, isDraft: true };
    if (saved) all[all.findIndex((story) => story.id === draft.id)] = item;
    else all.unshift(item);
  });
  const query = document.querySelector('#story-search').value.trim().toLowerCase();
  const kindFilter = document.querySelector('#story-filter-kind').value;
  const progressFilter = document.querySelector('#story-filter-progress').value;
  const sortMode = document.querySelector('#story-sort').value;
  const items = all.filter((story) => {
    if (kindFilter && story.kind !== kindFilter) return false;
    if (progressFilter && story.progress !== progressFilter) return false;
    if (!query) return true;
    return [
      story.title, story.text, story.summary, story.setting, STORY_KINDS[story.kind],
      ...(story.tags || []), ...storyCharacterNames(story), ...storyPlaceNames(story),
    ].join(' ').toLowerCase().includes(query);
  });
  items.sort((a, b) => {
    if (sortMode === 'title') return (a.title || 'Untitled story').localeCompare(b.title || 'Untitled story');
    const order = (a.updatedAt || '').localeCompare(b.updatedAt || '');
    return sortMode === 'oldest' ? order : -order;
  });
  items.forEach((story) => {
    const item = document.createElement('div');
    item.className = 'story-card-item';
    const card = document.createElement('button');
    card.className = 'story-card';
    card.type = 'button';
    card.setAttribute('aria-label', `${story.isDraft ? 'Continue draft' : 'Open story'}: ${story.title || 'Untitled story'}`);
    const header = document.createElement('span');
    header.className = 'story-card-header';
    const label = document.createElement('span');
    label.className = 'story-card-label';
    label.textContent = story.isDraft ? `DRAFT · ${(STORY_KINDS[story.kind] || 'Story').toUpperCase()}` : (STORY_KINDS[story.kind] || 'Story').toUpperCase();
    const date = document.createElement('span');
    date.className = 'story-card-date';
    date.textContent = story.updatedAt
      ? new Date(story.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : '';
    header.append(label, date);
    const title = document.createElement('strong');
    title.textContent = story.title || 'Untitled story';
    title.style.fontFamily = STORY_FONTS[story.titleFont] || STORY_FONTS.playfair;
    const excerpt = document.createElement('span');
    excerpt.className = 'story-card-excerpt';
    excerpt.textContent = story.summary || story.text.trim() || 'Nothing written yet. Open this story to keep going.';
    const chips = document.createElement('span');
    chips.className = 'story-card-chips';
    const progressChip = document.createElement('span');
    progressChip.className = `story-chip story-chip-${story.progress}`;
    progressChip.textContent = STORY_PROGRESS[story.progress] || 'Drafting';
    chips.append(progressChip);
    const chapterTotal = parseStoryChapters(story.text || '').length;
    if (chapterTotal) {
      const chapterChip = document.createElement('span');
      chapterChip.className = 'story-chip';
      chapterChip.textContent = `${chapterTotal} chapter${chapterTotal === 1 ? '' : 's'}`;
      chips.append(chapterChip);
    }
    if (story.seriesId) {
      const series = bookSeries.find((item) => item.id === story.seriesId);
      if (series) {
        const seriesChip = document.createElement('span');
        seriesChip.className = 'story-chip';
        seriesChip.textContent = `${series.name} · Book ${story.seriesOrder}`;
        chips.append(seriesChip);
      }
    }
    (story.tags || []).slice(0, 3).forEach((tag) => {
      const chip = document.createElement('span');
      chip.className = 'story-chip';
      chip.textContent = `#${tag}`;
      chips.append(chip);
    });
    const castNames = storyCharacterNames(story);
    const cast = document.createElement('span');
    cast.className = 'story-card-cast';
    cast.textContent = castNames.length
      ? `✦ ${castNames.slice(0, 2).join(', ')}${castNames.length > 2 ? ` +${castNames.length - 2}` : ''}`
      : '';
    const action = document.createElement('span');
    action.className = 'story-card-action';
    action.textContent = story.isDraft ? 'Continue writing →' : 'Open story →';
    date.style.marginRight = '30px';
    if (story.image && validImageSource(story.image)) {
      const cover = document.createElement('img');
      cover.className = 'story-card-cover';
      cover.alt = '';
      setImageSource(cover, story.image, () => cover.classList.add('hidden'));
      card.append(cover);
    }
    card.append(header, title, excerpt, chips);
    if (castNames.length) card.append(cast);
    const placeNames = storyPlaceNames(story);
    if (placeNames.length) {
      const settings = document.createElement('span');
      settings.className = 'story-card-cast';
      settings.textContent = `◈ ${placeNames.slice(0, 2).join(', ')}${placeNames.length > 2 ? ` +${placeNames.length - 2}` : ''}`;
      card.append(settings);
    }
    card.append(action);
    card.addEventListener('click', () => {
      previewStoryId = story.id;
      updateStoryPreview(story);
      openStoryEditor(story.id, card);
    });
    const remove = document.createElement('button');
    remove.className = 'card-delete-button story-delete-button';
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Delete ${story.isDraft ? 'draft' : 'story'}: ${story.title || 'Untitled story'}`);
    remove.title = `Delete ${story.isDraft ? 'draft' : 'story'}`;
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      requestDeleteItem(story.id, 'story', story, remove);
    });
    item.append(card, remove);
    library.append(item);
  });
  library.classList.toggle('is-horizontal', items.length >= 4);
  if (items.length >= 4) {
    library.tabIndex = 0;
    library.setAttribute('aria-label', 'Stories. Scroll horizontally to see more.');
  } else {
    library.removeAttribute('tabindex');
    library.removeAttribute('aria-label');
  }
  document.querySelector('#story-sidebar-count').textContent = String(all.length);
  document.querySelector('#lore-count').textContent = `(${all.length})`;
  document.querySelector('#story-empty').classList.toggle('hidden', all.length > 0);
  document.querySelector('#story-filter-bar').classList.toggle('hidden', all.length === 0);
  document.querySelector('#story-no-results').classList.toggle('hidden', !(all.length > 0 && items.length === 0));
  renderBackupInformation();
  library.classList.toggle('hidden', items.length === 0);
  const previewStory = all.find((story) => story.id === previewStoryId) || items[0] || all[0];
  if (previewStory) {
    previewStoryId = previewStory.id;
    updateStoryPreview(previewStory);
  } else {
    previewStoryId = '';
    updateStoryPreview(null);
  }
  renderSeriesLibrary();
  renderProjectDashboard();
}

function getProjectDashboardStories() {
  const all = [...savedStories];
  Object.values(storyDrafts).forEach((draft) => {
    const savedIndex = all.findIndex((story) => story.id === draft.id);
    if (savedIndex >= 0) all[savedIndex] = { ...draft, isDraft: true };
    else all.unshift({ ...draft, isDraft: true });
  });
  return all.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

function renderProjectOverview() {
  const project = projects.find((entry) => entry.id === activeProjectId);
  if (!project) return;
  const stats = projectStats(project.id);
  const stories = getProjectDashboardStories();
  const totalWords = stories.reduce((total, story) => total + countStoryGoalWords(story.text || ''), 0);
  const totalGoal = stories.reduce((total, story) => total + normalizeStoryMeta(story).wordGoal, 0);
  const percent = totalGoal ? Math.min(100, Math.round((totalWords / totalGoal) * 100)) : 0;
  const date = project.updatedAt ? new Date(project.updatedAt) : null;
  const modified = date && Number.isFinite(date.getTime())
    ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'Not modified yet';

  document.querySelector('#project-overview-name').textContent = project.name;
  document.querySelector('#project-overview-description').textContent = project.description || 'Add a description to capture what this project is about.';
  document.querySelector('#project-overview-genre').textContent = project.genre || 'Genre not set';
  document.querySelector('#project-overview-stories').textContent = String(stats.stories);
  document.querySelector('#project-overview-characters').textContent = String(stats.characters);
  document.querySelector('#project-overview-modified').textContent = modified;
  document.querySelector('#project-overview-progress-label').textContent = totalGoal
    ? `${totalWords.toLocaleString()} of ${totalGoal.toLocaleString()} words`
    : 'Create a story to track overall progress';
  document.querySelector('#project-overview-progress-percent').textContent = `${percent}%`;
  const progress = document.querySelector('#project-overview-progress');
  progress.setAttribute('aria-valuemax', String(Math.max(totalGoal, 1)));
  progress.setAttribute('aria-valuenow', String(Math.min(totalWords, totalGoal)));
  progress.setAttribute('aria-valuetext', totalGoal
    ? `${totalWords.toLocaleString()} of ${totalGoal.toLocaleString()} words, ${percent}%`
    : 'No story word goals set');
  document.querySelector('#project-overview-progress-fill').style.width = `${percent}%`;

  const tags = document.querySelector('#project-overview-tags');
  tags.replaceChildren(...project.tags.map((value) => {
    const tag = document.createElement('span');
    tag.textContent = value;
    return tag;
  }));
  const cover = document.querySelector('#project-overview-cover-image');
  const coverEmpty = document.querySelector('#project-overview-cover-empty');
  const hasCover = Boolean(stats.coverImage && validImageSource(stats.coverImage));
  cover.classList.toggle('hidden', !hasCover);
  coverEmpty.classList.toggle('hidden', hasCover);
  if (hasCover) setImageSource(cover, stats.coverImage, () => {
    cover.classList.add('hidden');
    coverEmpty.classList.remove('hidden');
  });
}

function openProjectOverviewForm() {
  const project = projects.find((entry) => entry.id === activeProjectId);
  if (!project) return;
  document.querySelector('#project-overview-name-input').value = project.name;
  document.querySelector('#project-overview-description-input').value = project.description;
  document.querySelector('#project-overview-genre-input').value = project.genre;
  document.querySelector('#project-overview-tags-input').value = project.tags.join(', ');
  document.querySelector('#project-overview-cover-input').value = projectStats(project.id).coverImage;
  document.querySelector('#project-overview-form').classList.remove('hidden');
  document.querySelector('#project-overview-edit').classList.add('hidden');
  document.querySelector('#project-overview-name-input').focus();
}

function previewProjectOverviewCover() {
  const image = document.querySelector('#project-overview-cover-image');
  const empty = document.querySelector('#project-overview-cover-empty');
  const requestedSource = document.querySelector('#project-overview-cover-input').value.trim();
  const requestedIsValid = requestedSource.length <= MAX_IMAGE_DATA_URL_LENGTH && validImageSource(requestedSource);
  const source = requestedIsValid
    ? requestedSource
    : requestedSource ? projectStorage.read(PROJECT_COVER_STORAGE_KEY, '') : '';
  const visible = Boolean(source && validImageSource(source));
  image.classList.toggle('hidden', !visible);
  empty.classList.toggle('hidden', visible);
  if (visible) setImageSource(image, source, () => {
    image.classList.add('hidden');
    empty.classList.remove('hidden');
    showToast('Could not load the project cover. Use an image URL or upload another image.');
  });
}

function renderProjectWorkflow(story) {
  const list = document.querySelector('#project-workflow-list');
  const metadata = normalizeStoryMeta(story);
  const chapters = parseStoryChapters(story.text || '');
  const linkedCharacters = metadata.characterIds.filter((id) => characters.some((character) => character.id === id));
  const linkedPlaces = [...new Set([
    ...metadata.placeIds,
    ...metadata.chapterPlaces.map((entry) => entry.placeId),
  ])].filter((id) => places.some((place) => place.id === id));
  const datedChapters = metadata.chapterMeta.filter((chapter) => chapter.timelinePoint).length;
  const storyEvents = window.FictionTalesPlanning?.getData().events.filter((event) => event.storyId === story.id) || [];
  const hasTitle = Boolean(story.title?.trim());
  const hasText = Boolean(story.text?.trim());
  const steps = [
    {
      id: 'draft',
      title: 'Write the story',
      detail: hasTitle && hasText ? `${countStoryGoalWords(story.text).toLocaleString()} words in this draft` : 'Give the story a title and start writing',
      status: hasTitle && hasText ? 'In progress' : 'Start here',
      complete: hasTitle && hasText,
      action: hasTitle ? 'Continue writing' : 'Add a title',
    },
    {
      id: 'characters',
      title: 'Connect characters',
      detail: linkedCharacters.length ? `${linkedCharacters.length} character${linkedCharacters.length === 1 ? '' : 's'} linked` : 'Link the cast who appear in this story',
      status: linkedCharacters.length ? 'Connected' : 'Not connected',
      complete: linkedCharacters.length > 0,
      action: 'Connect characters',
    },
    {
      id: 'places',
      title: 'Connect places',
      detail: linkedPlaces.length ? `${linkedPlaces.length} place${linkedPlaces.length === 1 ? '' : 's'} linked` : 'Link story settings or chapter locations',
      status: linkedPlaces.length ? 'Connected' : 'Not connected',
      complete: linkedPlaces.length > 0,
      action: 'Connect places',
    },
    {
      id: 'chapters',
      title: 'Organize chapters',
      detail: chapters.length ? `${chapters.length} chapter${chapters.length === 1 ? '' : 's'} organized` : 'Add chapter headings to shape the manuscript',
      status: chapters.length ? 'Organized' : 'No chapters yet',
      complete: chapters.length > 0,
      action: chapters.length ? 'Review chapters' : 'Add chapters',
    },
    {
      id: 'events',
      title: 'Track timeline events',
      detail: `${storyEvents.length} linked event${storyEvents.length === 1 ? '' : 's'} · ${datedChapters} dated chapter${datedChapters === 1 ? '' : 's'}`,
      status: storyEvents.length || datedChapters ? 'Timeline started' : story.isDraft ? 'Save story to link events' : 'No events yet',
      complete: storyEvents.length > 0 || datedChapters > 0,
      action: story.isDraft ? 'Save story first' : 'Add a timeline event',
    },
    {
      id: 'continuity',
      title: 'Check continuity',
      detail: chapters.length ? 'Review cast, locations, availability, ages, and chronology' : 'Add chapters before reviewing continuity',
      status: chapters.length ? 'Ready to review' : 'Waiting for chapters',
      action: 'Review continuity',
    },
    {
      id: 'reading',
      title: 'Read the manuscript',
      detail: hasText ? 'Open the distraction-free reader at any time' : 'Write a little first to open Reading Mode',
      status: hasText ? (story.progress === 'finished' ? 'Ready · marked finished' : 'Ready when you are') : 'Waiting for a draft',
      action: hasText ? 'Open Reading Mode' : 'Start writing',
    },
  ];
  const nextStep = steps.find((step) => !step.complete);
  list.replaceChildren(...steps.map((step, index) => {
    const item = document.createElement('li');
    item.className = `project-workflow-step${step.complete ? ' is-complete' : ''}${step === nextStep ? ' is-next' : ''}`;
    const button = document.createElement('button');
    button.className = 'project-workflow-action';
    button.type = 'button';
    button.dataset.storyWorkflowStep = step.id;
    button.setAttribute('aria-label', `${step.title}. ${step.status}. ${step.action}.`);
    const number = document.createElement('span');
    number.className = 'project-workflow-number';
    number.textContent = step.complete ? '✓' : String(index + 1).padStart(2, '0');
    const copy = document.createElement('span');
    copy.className = 'project-workflow-copy';
    const title = document.createElement('strong');
    title.textContent = step.title;
    const detail = document.createElement('small');
    detail.textContent = step.detail;
    copy.append(title, detail);
    const status = document.createElement('span');
    status.className = 'project-workflow-status';
    status.textContent = step.status;
    const action = document.createElement('span');
    action.className = 'project-workflow-link';
    action.textContent = `${step.action} →`;
    button.append(number, copy, status, action);
    item.append(button);
    return item;
  }));
}

function renderProjectDashboard() {
  const selector = document.querySelector('#project-dashboard-story');
  if (!selector) return;
  renderProjectOverview();
  const projects = getProjectDashboardStories();
  const previousId = selector.value;
  selector.replaceChildren(new Option('Choose a story', ''));
  projects.forEach((story) => {
    const option = new Option(
      `${story.title || 'Untitled story'}${story.isDraft ? ' · Draft' : ''}`,
      story.id,
    );
    selector.add(option);
  });
  const selectedProject = projects.find((story) => story.id === previousId) || projects[0];
  selector.value = selectedProject?.id || '';
  const empty = document.querySelector('#project-dashboard-empty');
  const content = document.querySelector('#project-dashboard-content');
  const openButton = document.querySelector('#project-dashboard-open-story');
  empty.classList.toggle('hidden', projects.length > 0);
  content.classList.toggle('hidden', !selectedProject);
  openButton.disabled = !selectedProject;
  if (!selectedProject) return;
  renderProjectWorkflow(selectedProject);

  const goal = normalizeStoryMeta(selectedProject).wordGoal;
  const words = countStoryGoalWords(selectedProject.text || '');
  const chapters = parseStoryChapters(selectedProject.text || '').length;
  const linkedCharacters = new Set((selectedProject.characterIds || [])
    .filter((id) => characters.some((character) => character.id === id)));
  const percent = Math.min(100, Math.round((words / goal) * 100));
  const edited = selectedProject.updatedAt ? new Date(selectedProject.updatedAt) : null;
  const editedLabel = edited && Number.isFinite(edited.getTime())
    ? edited.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'Not edited yet';
  const pendingTasks = normalizeStoryTodos(selectedProject.todos).filter((task) => !task.done);

  document.querySelector('#project-dashboard-words').textContent = words.toLocaleString();
  document.querySelector('#project-dashboard-chapters').textContent = chapters.toLocaleString();
  document.querySelector('#project-dashboard-characters').textContent = linkedCharacters.size.toLocaleString();
  document.querySelector('#project-dashboard-edited').textContent = editedLabel;
  document.querySelector('#project-dashboard-stage').textContent = STORY_PROGRESS[selectedProject.progress] || 'Drafting';
  document.querySelector('#project-dashboard-word-goal').value = String(goal);
  document.querySelector('#project-dashboard-progress-label').textContent = `${words.toLocaleString()} of ${goal.toLocaleString()} words`;
  document.querySelector('#project-dashboard-progress-percent').textContent = `${percent}%`;
  const progress = document.querySelector('#project-dashboard-progress');
  progress.setAttribute('aria-valuemax', String(goal));
  progress.setAttribute('aria-valuenow', String(Math.min(words, goal)));
  progress.setAttribute('aria-valuetext', `${words.toLocaleString()} of ${goal.toLocaleString()} words, ${percent}%`);
  document.querySelector('#project-dashboard-progress-fill').style.width = `${percent}%`;

  const taskList = document.querySelector('#project-dashboard-tasks');
  taskList.replaceChildren();
  pendingTasks.forEach((task) => {
    const item = document.createElement('li');
    const text = document.createElement('span');
    text.textContent = task.text;
    const openTask = document.createElement('button');
    openTask.className = 'project-task-open';
    openTask.type = 'button';
    openTask.dataset.projectStoryId = selectedProject.id;
    openTask.textContent = 'Open story';
    openTask.setAttribute('aria-label', `Open ${selectedProject.title || 'untitled story'} to work on: ${task.text}`);
    item.append(text, openTask);
    taskList.append(item);
  });
  document.querySelector('#project-dashboard-task-count').textContent = String(pendingTasks.length);
  document.querySelector('#project-dashboard-tasks-empty').classList.toggle('hidden', pendingTasks.length > 0);
}

function openStoryWorkflowStep(story, step, returnFocus) {
  if (step === 'events' && !story.isDraft) {
    document.querySelector('[data-planning-tab="timeline"]').click();
    const planning = document.querySelector('#planning');
    setActiveNavigation('planning');
    planning.scrollIntoView({ behavior: getMotionScrollBehavior() });
    const storySelect = document.querySelector('#world-event-story');
    if ([...storySelect.options].some((option) => option.value === story.id)) storySelect.value = story.id;
    document.querySelector('#world-event-form details').open = true;
    document.querySelector('#world-event-form [name="date"]').focus({ preventScroll: true });
    return;
  }

  openStoryEditor(story.id, returnFocus);
  if (step === 'reading' && story.text?.trim()) {
    openStoryPreview();
    openStoryReadingMode();
    return;
  }

  const editorForm = document.querySelector('#story-form');
  const details = document.querySelector('#story-details');
  const chapterTools = document.querySelector('#story-chapters-panel');
  let target;
  if (step === 'draft') {
    target = story.title ? document.querySelector('#story-text') : document.querySelector('#story-title');
  } else if (step === 'characters' || step === 'places') {
    details.open = true;
    target = document.querySelector(`#story-${step} input`)
      || document.querySelector(`#story-${step} .story-picker-create`)
      || document.querySelector(`#story-${step}`);
  } else if (step === 'chapters') {
    target = parseStoryChapters(story.text || '').length
      ? document.querySelector('#story-chapter-list .story-chapter-jump')
      : document.querySelector('#story-text');
  } else if (step === 'events') {
    target = story.title
      ? document.querySelector('#story-form button[type="submit"]')
      : document.querySelector('#story-title');
  } else if (step === 'continuity') {
    chapterTools.open = true;
    target = chapterTools.querySelector('summary');
  } else if (step === 'reading') {
    target = editorForm.querySelector('#story-text');
  }
  if (target) {
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: getMotionScrollBehavior(), block: 'center' });
      target.focus?.({ preventScroll: true });
    });
  }
}

function getSeriesBooks(seriesId) {
  return getProjectDashboardStories().filter((story) => story.seriesId === seriesId)
    .sort((a, b) => a.seriesOrder - b.seriesOrder || (a.title || '').localeCompare(b.title || ''));
}

function getNextSeriesBookOrder(seriesId, excludeStoryId = '') {
  const books = getSeriesBooks(seriesId).filter((story) => story.id !== excludeStoryId);
  return Math.max(0, ...books.map((book) => book.seriesOrder)) + 1;
}

function renderSharedSeriesPicker(container, records, selectedIds, kind) {
  container.replaceChildren();
  if (!records.length) {
    const empty = document.createElement('span');
    empty.className = 'series-empty-note';
    empty.textContent = kind === 'character' ? 'Create a character first to link one here.' : 'Create a place first to link one here.';
    container.append(empty);
    return;
  }
  records.forEach((record) => {
    const label = document.createElement('label');
    label.className = 'series-shared-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = record.id;
    checkbox.checked = selectedIds.includes(record.id);
    const name = document.createElement('span');
    name.textContent = record.name;
    label.append(checkbox, name);
    container.append(label);
  });
}

function updateStorySeriesPicker(selectedId = document.querySelector('#story-series')?.value || '') {
  const select = document.querySelector('#story-series');
  if (!select) return;
  select.replaceChildren(new Option('Not in a series', ''));
  bookSeries.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((series) => {
    select.add(new Option(series.name, series.id));
  });
  select.value = bookSeries.some((series) => series.id === selectedId) ? selectedId : '';
  document.querySelector('#story-series-order').disabled = !select.value;
}

function renderSeriesLibrary() {
  const list = document.querySelector('#series-library');
  if (!list) return;
  list.replaceChildren();
  const selector = document.querySelector('#series-record-select');
  if (selector) {
    const selectedId = selector.value;
    selector.replaceChildren(new Option('Choose a series', ''));
    bookSeries.slice().sort((a, b) => a.name.localeCompare(b.name))
      .forEach((series) => selector.add(new Option(series.name, series.id)));
    selector.value = bookSeries.some((series) => series.id === selectedId) ? selectedId : '';
    document.querySelector('#series-edit-selected').disabled = !selector.value;
  }
  document.querySelector('#series-empty').classList.toggle('hidden', bookSeries.length > 0);
  document.querySelector('#series-sidebar-count').textContent = String(bookSeries.length);
  updateStorySeriesPicker();
  if (!document.querySelector('#series-editor').classList.contains('hidden')) renderSeriesEventEditor();
  bookSeries.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((series) => {
    const card = document.createElement('article');
    card.className = 'series-card';
    const header = document.createElement('div');
    header.className = 'series-card-heading';
    const copy = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = series.name;
    const summary = document.createElement('p');
    summary.textContent = series.summary || 'No series description yet.';
    copy.append(title, summary);
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'button button-outline';
    edit.dataset.editSeries = series.id;
    edit.textContent = 'Edit series';
    header.append(copy, edit);
    card.append(header);

    const books = getSeriesBooks(series.id);
    const bookHeading = document.createElement('h4');
    bookHeading.textContent = `Books (${books.length})`;
    card.append(bookHeading);
    if (books.length) {
      const bookList = document.createElement('ol');
      bookList.className = 'series-book-list';
      books.forEach((book) => {
        const row = document.createElement('li');
        const open = document.createElement('button');
        open.type = 'button';
        open.dataset.openSeriesBook = book.id;
        open.textContent = `${book.isDraft ? 'Draft · ' : ''}Book ${book.seriesOrder}: ${book.title || 'Untitled story'}`;
        row.append(open);
        bookList.append(row);
      });
      card.append(bookList);
    } else {
      const empty = document.createElement('p');
      empty.className = 'series-empty-note';
      empty.textContent = 'No books linked yet. Choose this series in a story’s details to add a book.';
      card.append(empty);
    }

    const links = document.createElement('p');
    links.className = 'series-card-links';
    const sharedCharacters = series.characterIds.map((id) => characters.find((item) => item.id === id)?.name).filter(Boolean);
    const sharedPlaces = series.placeIds.map((id) => places.find((item) => item.id === id)?.name).filter(Boolean);
    links.textContent = [
      sharedCharacters.length ? `Characters: ${sharedCharacters.join(', ')}` : 'No shared characters',
      sharedPlaces.length ? `Places: ${sharedPlaces.join(', ')}` : 'No shared places',
      `${series.events.length} event${series.events.length === 1 ? '' : 's'}`,
    ].join(' · ');
    card.append(links);
    if (series.events.length) {
      const eventHeading = document.createElement('h4');
      eventHeading.textContent = 'Series timeline';
      const timeline = document.createElement('ol');
      timeline.className = 'series-card-timeline';
      const orderByStory = new Map(books.map((book, index) => [book.id, index]));
      series.events.slice().sort((a, b) => {
        const aOrder = orderByStory.has(a.bookId) ? orderByStory.get(a.bookId) : -1;
        const bOrder = orderByStory.has(b.bookId) ? orderByStory.get(b.bookId) : -1;
        return aOrder - bOrder || series.events.indexOf(a) - series.events.indexOf(b);
      }).forEach((event) => {
        const row = document.createElement('li');
        const eventTitle = document.createElement('strong');
        eventTitle.textContent = event.title;
        const detail = document.createElement('span');
        const book = books.find((item) => item.id === event.bookId);
        detail.textContent = [book ? `Book ${book.seriesOrder}: ${book.title || 'Untitled story'}`
          : event.bookId ? 'Book no longer available' : 'Series-wide',
          event.chapter, event.description].filter(Boolean).join(' · ');
        row.append(eventTitle, detail);
        timeline.append(row);
      });
      card.append(eventHeading, timeline);
    }
    list.append(card);
  });
}

function renderSeriesEventEditor() {
  const list = document.querySelector('#series-events-list');
  list.replaceChildren();
  const seriesId = document.querySelector('#series-id').value;
  const books = seriesId ? getSeriesBooks(seriesId) : [];
  const bookPicker = document.querySelector('#series-event-book');
  const selectedBook = bookPicker.value;
  bookPicker.replaceChildren(new Option('Series-wide / not assigned', ''));
  books.forEach((book) => {
    bookPicker.add(new Option(`Book ${book.seriesOrder}: ${book.title || 'Untitled story'}`, book.id));
  });
  bookPicker.value = books.some((book) => book.id === selectedBook) ? selectedBook : '';
  const orderByStory = new Map(books.map((book, index) => [book.id, index]));
  editingSeriesEvents.slice().sort((a, b) => {
    const aOrder = orderByStory.has(a.bookId) ? orderByStory.get(a.bookId) : -1;
    const bOrder = orderByStory.has(b.bookId) ? orderByStory.get(b.bookId) : -1;
    return aOrder - bOrder || editingSeriesEvents.indexOf(a) - editingSeriesEvents.indexOf(b);
  }).forEach((event) => {
    const item = document.createElement('li');
    const text = document.createElement('span');
    const book = books.find((entry) => entry.id === event.bookId);
    text.textContent = [event.title, book ? `Book ${book.seriesOrder}: ${book.title || 'Untitled story'}`
      : event.bookId ? 'Book no longer available' : 'Series-wide',
      event.chapter, event.description].filter(Boolean).join(' · ');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.removeSeriesEvent = event.id;
    remove.setAttribute('aria-label', `Remove event: ${event.title}`);
    remove.textContent = 'Remove';
    item.append(text, remove);
    list.append(item);
  });
  document.querySelector('#series-events-empty').classList.toggle('hidden', editingSeriesEvents.length > 0);
}

function openSeriesEditor(seriesId = '') {
  const series = bookSeries.find((item) => item.id === seriesId);
  editingSeriesEvents = series ? series.events.map((event) => ({ ...event })) : [];
  document.querySelector('#series-id').value = series?.id || '';
  document.querySelector('#series-name').value = series?.name || '';
  document.querySelector('#series-summary').value = series?.summary || '';
  document.querySelector('#series-editor-title').textContent = series ? 'Edit series' : 'Create a series';
  document.querySelector('#series-delete').classList.toggle('hidden', !series);
  renderSharedSeriesPicker(document.querySelector('#series-characters'), characters,
    series?.characterIds || [], 'character');
  renderSharedSeriesPicker(document.querySelector('#series-places'), places,
    series?.placeIds || [], 'place');
  renderSeriesEventEditor();
  document.querySelector('#series-editor').classList.remove('hidden');
  document.querySelector('#series-name').focus();
}

function saveBookSeries(event) {
  event.preventDefault();
  const name = document.querySelector('#series-name').value.trim();
  const currentId = document.querySelector('#series-id').value || createId();
  if (bookSeries.some((series) => series.id !== currentId && series.name.toLowerCase() === name.toLowerCase())) {
    showToast('A series with that name already exists. Choose a different name.');
    document.querySelector('#series-name').focus();
    return;
  }
  const series = {
    id: currentId,
    name,
    summary: document.querySelector('#series-summary').value.trim(),
    characterIds: [...document.querySelectorAll('#series-characters input:checked')].map((input) => input.value),
    placeIds: [...document.querySelectorAll('#series-places input:checked')].map((input) => input.value),
    events: editingSeriesEvents,
    updatedAt: new Date().toISOString(),
  };
  const next = [...bookSeries];
  const index = next.findIndex((item) => item.id === currentId);
  if (index >= 0) next[index] = series;
  else next.unshift(series);
  if (!writeStorage(SERIES_STORAGE_KEY, next)) {
    showToast('Could not save this series. Your browser storage may be full.');
    return;
  }
  bookSeries = next;
  document.querySelector('#series-editor').classList.add('hidden');
  renderStories();
  scheduleFolderBackup();
  showToast(index >= 0 ? 'Series updated.' : 'Series created.');
}

function deleteBookSeries() {
  const seriesId = document.querySelector('#series-id').value;
  const series = bookSeries.find((item) => item.id === seriesId);
  if (!series || !window.confirm(`Delete “${series.name}”? Its books will stay in Stories, but they will no longer be grouped in this series.`)) return;
  const nextSeries = bookSeries.filter((item) => item.id !== seriesId);
  const nextStories = savedStories.map((story) => story.seriesId === seriesId ? { ...story, seriesId: '' } : story);
  const nextDrafts = Object.fromEntries(Object.entries(storyDrafts).map(([id, draft]) => [
    id, draft.seriesId === seriesId ? { ...draft, seriesId: '' } : draft,
  ]));
  const updates = [[SERIES_STORAGE_KEY, nextSeries]];
  if (nextStories.some((story, index) => story !== savedStories[index])) updates.push([STORIES_STORAGE_KEY, nextStories]);
  if (Object.entries(nextDrafts).some(([id, draft]) => draft !== storyDrafts[id])) updates.push([STORY_DRAFTS_KEY, nextDrafts]);
  if (!commitStorageUpdates(updates)) {
    showToast('Could not delete this series. Your browser storage may be full.');
    return;
  }
  bookSeries = nextSeries;
  savedStories.splice(0, savedStories.length, ...nextStories);
  Object.keys(storyDrafts).forEach((id) => delete storyDrafts[id]);
  Object.assign(storyDrafts, nextDrafts);
  document.querySelector('#series-editor').classList.add('hidden');
  renderStories();
  scheduleFolderBackup();
  showToast('Series deleted. Its books are still in Stories.');
}

function openStoryEditor(storyId = '', returnFocus = document.activeElement) {
  flushStoryDraft();
  activeStoryId = storyId || createId();
  storyReturnFocus = returnFocus;
  const saved = savedStories.find((story) => story.id === activeStoryId);
  const draft = storyDrafts[activeStoryId];
  storyCompareSelection = [];
  document.querySelector('#story-note-chapter').value = '';
  document.querySelector('#story-toolbar-tools').open = false;
  document.querySelector('#story-template-panel').classList.toggle('hidden', Boolean(saved || draft));
  document.querySelector('#story-template-select').value = '';
  renderStoryTemplatePreview('');
  const story = draft || saved || {
    id: activeStoryId, title: '', text: '', titleFont: 'playfair', bodyFont: editorPreferences.defaultFont,
    backgroundColor: writingPreferences.readingAppearance, image: '',
    ...normalizeStoryMeta({ kind: writingPreferences.defaultKind }),
  };
  document.querySelector('#story-title').value = story.title;
  document.querySelector('#story-text').value = story.text;
  document.querySelector('#story-title-font').value = story.titleFont || 'playfair';
  document.querySelector('#story-body-font').value = story.bodyFont || 'dm-sans';
  document.querySelector('#story-background').value = normalizeStoryBackground(story.backgroundColor);
  document.querySelector('#story-background-hex').value = normalizeStoryBackground(story.backgroundColor);
  document.querySelector('#story-image-url').value = story.image;
  syncStoryImageChip();
  const meta = normalizeStoryMeta(story);
  document.querySelector('#story-kind').value = meta.kind;
  document.querySelector('#story-progress').value = meta.progress;
  updateStorySeriesPicker(meta.seriesId);
  document.querySelector('#story-series-order').value = String(meta.seriesOrder);
  document.querySelector('#story-word-goal').value = String(meta.wordGoal);
  document.querySelector('#story-summary').value = meta.summary;
  document.querySelector('#story-setting').value = meta.setting;
  document.querySelector('#story-tags').value = meta.tags.join(', ');
  document.querySelector('#story-chapter-places').value = JSON.stringify(meta.chapterPlaces);
  document.querySelector('#story-chapter-meta-data').value = JSON.stringify(meta.chapterMeta);
  activeStoryChapterIndex = meta.chapterMeta.length ? 0 : -1;
  renderStoryNotesAndTodos(meta);
  renderStoryCharacterPicker(meta.characterIds);
  renderStoryPlacePicker([...new Set([...meta.placeIds, ...meta.chapterPlaces.map((entry) => entry.placeId)])]);
  renderStoryPeekList();
  document.querySelector('#story-peek-content').classList.add('hidden');
  document.querySelector('#story-peek-toggle').textContent = 'Open';
  document.querySelector('#story-peek-toggle').setAttribute('aria-expanded', 'false');
  document.querySelector('#story-peek-panel').classList.remove('is-expanded');
  document.querySelector('#story-peek-panel').style.height = '';
  document.querySelector('#story-mention-suggestions').classList.add('hidden');
  updateStoryCounter(story.text);
  lastStoryWordCount = countStoryGoalWords(story.text);
  renderWritingGoal();
  document.querySelector('#story-dialog').classList.remove('is-focus-mode');
  document.querySelector('#story-focus-toggle').textContent = 'Focus mode';
  document.querySelector('#story-focus-toggle').setAttribute('aria-pressed', 'false');
  document.querySelector('#story-chapters-panel').open = false;
  renderStoryChapters();
  renderStoryHistory();
  disarmStoryDiscard();
  document.querySelector('#story-editor-title').textContent = story.title || 'Write a story';
  updateStorySaveStatus(draft || saved ? 'saved' : 'unsaved');
  setStoryDialogMode('edit');
  const dialog = document.querySelector('#story-dialog');
  if (!dialog.open) dialog.showModal();
  document.querySelector('#story-style-settings').open = Boolean(story.image
    || story.titleFont !== 'playfair' || story.bodyFont !== 'dm-sans'
    || story.backgroundColor !== DEFAULT_STORY_BACKGROUND);
  updateStoryPreview(story);
  syncModalScrollLock();
  updateBackToTopVisibility();
  document.querySelector('#story-title').focus();
}

function saveProjectWordGoal() {
  const storyId = document.querySelector('#project-dashboard-story').value;
  const input = document.querySelector('#project-dashboard-word-goal');
  const requestedGoal = Number(input.value);
  if (!Number.isFinite(requestedGoal) || requestedGoal < 100 || requestedGoal > 1_000_000) {
    showToast('Choose a project word goal between 100 and 1,000,000.');
    renderProjectDashboard();
    return;
  }
  const wordGoal = Math.round(requestedGoal / 100) * 100;
  const currentDraft = storyDrafts[storyId];
  if (currentDraft) {
    const nextDrafts = { ...storyDrafts, [storyId]: { ...currentDraft, wordGoal, updatedAt: new Date().toISOString() } };
    if (!writeStorage(STORY_DRAFTS_KEY, nextDrafts)) {
      showToast('Could not save this project word goal. Your browser storage may be full.');
      renderProjectDashboard();
      return;
    }
    Object.keys(storyDrafts).forEach((id) => delete storyDrafts[id]);
    Object.assign(storyDrafts, nextDrafts);
  } else {
    const nextStories = savedStories.map((story) => story.id === storyId
      ? { ...story, wordGoal, updatedAt: new Date().toISOString() } : story);
    if (!nextStories.some((story) => story.id === storyId)) {
      renderProjectDashboard();
      return;
    }
    if (!writeStorage(STORIES_STORAGE_KEY, nextStories)) {
      showToast('Could not save this project word goal. Your browser storage may be full.');
      renderProjectDashboard();
      return;
    }
    savedStories.splice(0, savedStories.length, ...nextStories);
  }
  scheduleFolderBackup();
  renderStories();
  renderProjectDashboard();
}

function saveCurrentStory() {
  const story = currentStoryDraft();
  if (!story.title) {
    showToast('Add a title so you can find this story later.');
    document.querySelector('#story-title').focus();
    return;
  }
  if (story.image && !validImageSource(story.image)) {
    showToast('Add a direct http(s) image link or upload an image file.');
    document.querySelector('#story-image-url').focus();
    return;
  }
  if (story.seriesId && getSeriesBooks(story.seriesId).some((book) => book.id !== story.id && book.seriesOrder === story.seriesOrder)) {
    showToast(`Book ${story.seriesOrder} is already in this series. Choose a different book number.`);
    document.querySelector('#story-series-order').focus();
    return;
  }
  const nextStories = [...savedStories];
  const existingIndex = nextStories.findIndex((item) => item.id === story.id);
  if (existingIndex >= 0) nextStories[existingIndex] = story;
  else nextStories.unshift(story);
  updateStorySaveStatus('saving');
  if (!writeStorage(STORIES_STORAGE_KEY, nextStories)) {
    updateStorySaveStatus('unsaved');
    showToast('Could not save this story. Your browser storage may be full.');
    return;
  }
  const previousSaved = savedStories.find((item) => item.id === story.id);
  savedStories.splice(0, savedStories.length, ...nextStories);
  cancelStoryDraftSave();
  delete storyDrafts[story.id];
  if (previousSaved && !(storyVersions[story.id] || []).length) recordStoryVersion(previousSaved);
  recordStoryVersion(story);
  renderStoryHistory();
  if (!writeStorage(STORY_DRAFTS_KEY, storyDrafts)) {
    showToast('Story saved, but its temporary draft could not be cleared.');
  }
  updateStorySaveStatus('saved');
  document.querySelector('#story-editor-title').textContent = story.title;
  persistCharacterLibrary();
  renderStories();
  renderPlaces();
  renderProjectDashboard();
  showToast('Story saved.');
  return true;
}

var storyDraftTimer = 0;
var storyDraftPending = false;

function saveStoryDraft() {
  storyDraftPending = true;
  updateStorySaveStatus('unsaved');
  window.clearTimeout(storyDraftTimer);
  storyDraftTimer = window.setTimeout(flushStoryDraft, 450);
}

function cancelStoryDraftSave() {
  window.clearTimeout(storyDraftTimer);
  storyDraftPending = false;
}

function flushPendingDrafts() {
  flushDraftSave();
  flushStoryDraft();
  flushDialogueDraft();
  flushPlaceDraft();
}

function flushStoryDraft() {
  if (!storyDraftPending) return;
  cancelStoryDraftSave();
  const draft = currentStoryDraft();
  const saved = savedStories.find((story) => story.id === draft.id);
  const unchanged = saved && saved.title === draft.title && saved.text === draft.text
    && saved.titleFont === draft.titleFont && saved.bodyFont === draft.bodyFont
    && saved.backgroundColor === draft.backgroundColor && saved.image === draft.image
    && storyMetaEqual(saved, draft);
  if (unchanged) {
    delete storyDrafts[draft.id];
    if (writeStorage(STORY_DRAFTS_KEY, storyDrafts)) scheduleFolderBackup();
    window.dispatchEvent(new CustomEvent('FictionTales:story-draft-updated', { detail: { id: draft.id } }));
    updateStorySaveStatus('saved');
    return;
  }
  storyDrafts[draft.id] = draft;
  updateStorySaveStatus('saving');
  if (!writeStorage(STORY_DRAFTS_KEY, storyDrafts)) {
    updateStorySaveStatus('unsaved');
    showToast('Could not autosave this draft. Save the story before closing.');
    return;
  }
  scheduleFolderBackup();
  updateStorySaveStatus('saved');
  document.querySelector('#story-editor-title').textContent = draft.title || 'Write a story';
  window.dispatchEvent(new CustomEvent('FictionTales:story-draft-updated', { detail: { id: draft.id } }));
}

var storageMeterTimer = 0;
var storageWarned = false;
var storageProblem = false;
let browserStorageRatio = null;
const UI_PREFS_KEY = 'FictionTales.ui.v1';
const UI_PREF_FIELDS = {
  '#cast-sort': 'castSort',
  '#story-sort': 'storySort', '#story-filter-kind': 'storyKind', '#story-filter-progress': 'storyProgress', '#story-export-format': 'storyExport',
  '#place-sort': 'placeSort', '#place-filter-kind': 'placeKind',
  '#settings-default-font': 'storyDefaultFont',
  '#settings-font-size': 'storyFontSize',
  '#settings-line-spacing': 'storyLineSpacing',
  '#settings-editor-width': 'storyEditorWidth',
  '#settings-story-type': 'storyDefaultKind',
  '#settings-chapter-format': 'storyChapterFormat',
  '#settings-word-count': 'storyWordCount',
  '#settings-reading-appearance': 'storyReadingAppearance',
};
const BACKUP_LAST_KEY = 'FictionTales.backup.last.v1';
let deferredInstallPrompt = null;
let appInstalledThisSession = false;
let globalSearchTimer = 0;
let storageEstimateGeneration = 0;
const globalSearchResults = document.querySelector('#global-search-results');

function estimateStorageBytes() {
  return window.FictionTaleStorage.getUsageBytes();
}

function updateStorageMeter() {
  storageMeterTimer = 0;
  const appUsage = document.querySelector('#settings-app-usage');
  const browserUsage = document.querySelector('#settings-browser-usage');
  const bytes = estimateStorageBytes();
  if (appUsage) appUsage.textContent = formatStorageSize(bytes);
  const estimateGeneration = ++storageEstimateGeneration;
  browserStorageRatio = null;
  if (browserUsage) browserUsage.textContent = 'Checking browser storage…';
  updateWorkspaceStorageStatus();
  renderStorageWarning();
  if (navigator.storage?.estimate) {
    navigator.storage.estimate().then(({ usage, quota }) => {
      if (estimateGeneration !== storageEstimateGeneration) return;
      if (typeof usage !== 'number' || typeof quota !== 'number' || quota <= 0) {
        if (browserUsage) browserUsage.textContent = 'Usage estimate unavailable.';
        return;
      }
      const ratio = usage / quota;
      browserStorageRatio = ratio;
      if (browserUsage) {
        browserUsage.textContent = `${formatStorageSize(usage)} of ${formatStorageSize(quota)} used`;
        browserUsage.classList.toggle('is-high', ratio >= 0.8);
      }
      updateWorkspaceStorageStatus();
      renderStorageWarning();
      if (ratio > 0.9 && !storageWarned) {
        storageWarned = true;
        showToast('Browser storage is nearly full. Export a full backup from Settings before clearing unused data.');
      }
    }).catch((error) => {
      if (estimateGeneration !== storageEstimateGeneration) return;
      if (browserUsage) {
        browserUsage.textContent = 'Could not read browser storage usage.';
        browserUsage.classList.remove('is-high');
      }
      console.warn('Could not estimate browser storage quota.', error);
    });
  } else {
    if (browserUsage) {
      browserUsage.textContent = 'Usage estimate unavailable in this browser.';
      browserUsage.classList.remove('is-high');
    }
  }
}

function backupReminderText(timestamp = readStorage(BACKUP_LAST_KEY, '')) {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return 'Backup needed';
  const ageDays = Math.max(0, Math.floor((Date.now() - parsed) / 86400000));
  return ageDays >= 7 ? `Backup due · ${backupAgeLabel(timestamp)}` : `Last backup ${backupAgeLabel(timestamp)}`;
}

function updateWorkspaceStorageStatus() {
  const status = document.querySelector('#workspace-storage-status');
  if (!status) return;
  const isLow = browserStorageRatio !== null && browserStorageRatio >= 0.8;
  const backupStatus = backupReminderText();
  const statusLabel = document.querySelector('#workspace-storage-label');
  const statusDetail = document.querySelector('#workspace-storage-detail');
  statusLabel.textContent = storageProblem ? 'Check your saved data' : isLow ? 'Storage space is low' : 'Saved in this browser';
  statusDetail.textContent = `${storageProblem ? 'A save may have failed' : 'Autosave active'} · ${backupStatus}`;
  status.classList.toggle('is-warning', isLow || backupStatus.startsWith('Backup'));
  status.classList.toggle('has-error', storageProblem);
  status.setAttribute('aria-label', `${statusLabel.textContent}. ${statusDetail.textContent}. Open Data and Storage settings.`);
  status.title = browserStorageRatio === null
    ? 'Your work is saved in this browser. Keep a full backup somewhere separate.'
    : `Your work is saved in this browser. Browser storage is ${Math.round(browserStorageRatio * 100)}% used.`;
}

function renderStorageWarning() {
  const warning = document.querySelector('#settings-storage-warning');
  if (!warning) return;
  if (storageProblem) {
    warning.textContent = 'A save could not be completed. Export a full backup now and check available browser storage before continuing.';
    warning.classList.remove('hidden');
  } else if (browserStorageRatio !== null && browserStorageRatio >= 0.8) {
    warning.textContent = `Browser storage is about ${Math.round(browserStorageRatio * 100)}% full. Export a full backup and free unused browser storage before it reaches its limit.`;
    warning.classList.remove('hidden');
  } else {
    warning.classList.add('hidden');
  }
}

function formatStorageSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unavailable';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function updateStorageMeterSoon() {
  if (storageMeterTimer) return;
  storageMeterTimer = window.setTimeout(updateStorageMeter, 700);
}

// The theme lives on <html> only (the inline script in index.html sets it before first paint).
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  delete document.body.dataset.theme;
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#16284a' : '#c8d6e2';
  updateThemeToggle(theme);
}

function initUiPrefs() {
  const prefs = readStorage(UI_PREFS_KEY, {}) || {};
  const defaultFontField = document.querySelector('#settings-default-font');
  defaultFontField.replaceChildren(...[...document.querySelector('#story-body-font').options]
    .map((option) => new Option(option.textContent, option.value)));
  const savedTheme = prefs.theme === 'dark' || prefs.theme === 'light'
    ? prefs.theme
    : document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  applyTheme(savedTheme);
  document.querySelector('#theme-toggle').addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(theme);
    const current = readStorage(UI_PREFS_KEY, {}) || {};
    current.theme = theme;
    writeStorage(UI_PREFS_KEY, current);
  });
  Object.entries(UI_PREF_FIELDS).forEach(([selector, key]) => {
    const field = document.querySelector(selector);
    if (!field) return;
    if (typeof prefs[key] === 'string' && [...field.options].some((option) => option.value === prefs[key])) {
      field.value = prefs[key];
    }
    field.addEventListener('change', () => {
      const current = readStorage(UI_PREFS_KEY, {}) || {};
      current[key] = field.value;
      writeStorage(UI_PREFS_KEY, current);
      if (selector.startsWith('#settings-')) {
        applyEditorPreferences();
        applyWritingPreferences();
      }
    });
  });
  const accessibilityFields = {
    '#settings-reduced-motion': 'reducedMotion',
    '#settings-high-contrast': 'highContrast',
    '#settings-large-text': 'largeText',
  };
  Object.entries(accessibilityFields).forEach(([selector, key]) => {
    const field = document.querySelector(selector);
    field.checked = prefs[key] === true;
    field.addEventListener('change', () => {
      const current = readStorage(UI_PREFS_KEY, {}) || {};
      current[key] = field.checked;
      writeStorage(UI_PREFS_KEY, current);
      applyAccessibilityPreferences();
    });
  });
  applyEditorPreferences();
  applyWritingPreferences();
  applyAccessibilityPreferences();
}

function applyEditorPreferences() {
  editorPreferences = {
    defaultFont: document.querySelector('#settings-default-font').value,
    fontSize: document.querySelector('#settings-font-size').value,
    lineSpacing: document.querySelector('#settings-line-spacing').value,
    editorWidth: document.querySelector('#settings-editor-width').value,
  };
  const editor = document.querySelector('#story-form');
  editor.style.setProperty('--story-editor-font-size', `${editorPreferences.fontSize}px`);
  editor.style.setProperty('--story-editor-line-spacing', editorPreferences.lineSpacing);
  editor.style.setProperty('--story-editor-width', editorPreferences.editorWidth);
}

function applyWritingPreferences() {
  writingPreferences = {
    defaultKind: document.querySelector('#settings-story-type').value || WRITING_PREFERENCES_DEFAULTS.defaultKind,
    chapterFormat: document.querySelector('#settings-chapter-format').value || WRITING_PREFERENCES_DEFAULTS.chapterFormat,
    wordCount: document.querySelector('#settings-word-count').value || WRITING_PREFERENCES_DEFAULTS.wordCount,
    readingAppearance: document.querySelector('#settings-reading-appearance').value || WRITING_PREFERENCES_DEFAULTS.readingAppearance,
  };
  updateStoryCounter(document.querySelector('#story-text').value);
}

function applyAccessibilityPreferences() {
  const root = document.documentElement;
  root.classList.toggle('accessibility-reduced-motion', document.querySelector('#settings-reduced-motion').checked);
  root.classList.toggle('accessibility-high-contrast', document.querySelector('#settings-high-contrast').checked);
  root.classList.toggle('accessibility-large-text', document.querySelector('#settings-large-text').checked);
}

function updateThemeToggle(theme) {
  const button = document.querySelector('#theme-toggle');
  const dark = theme === 'dark';
  button.setAttribute('aria-pressed', String(dark));
  button.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  button.innerHTML = `${dark ? '☀' : '☾'} <span>${dark ? 'Light mode' : 'Dark mode'}</span>`;
}

function backupAgeLabel(timestamp) {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return 'unknown';
  const ageDays = Math.max(0, Math.floor((Date.now() - parsed) / 86400000));
  if (!ageDays) return 'today';
  if (ageDays === 1) return '1 day ago';
  if (ageDays < 30) return `${ageDays} days ago`;
  const months = Math.floor(ageDays / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

function renderBackupInformation() {
  const lastBackup = readStorage(BACKUP_LAST_KEY, '');
  const lastBackupTime = Date.parse(lastBackup);
  const lastBackupLabel = document.querySelector('#settings-backup-last');
  if (!lastBackupLabel) return;
  if (!Number.isFinite(lastBackupTime)) {
    lastBackupLabel.textContent = 'No backup recorded yet. Export a full backup to keep a copy outside this browser.';
  } else {
    const ageDays = Math.max(0, Math.floor((Date.now() - lastBackupTime) / 86400000));
    lastBackupLabel.textContent = `Last backup: ${backupAgeLabel(lastBackup)} (${new Date(lastBackupTime).toLocaleString()}).${ageDays >= 7 ? ' A fresh backup is recommended.' : ''}`;
  }
  updateWorkspaceStorageStatus();
}

function markBackupCreated() {
  writeStorage(BACKUP_LAST_KEY, new Date().toISOString());
  renderBackupInformation();
}

function renderGlobalSearch() {
  const query = document.querySelector('#global-search-input').value.trim().toLowerCase();
  const list = document.querySelector('#global-search-list');
  list.replaceChildren();
  if (!query) {
    globalSearchResults.classList.add('hidden');
    return;
  }
  const results = [];
  characters.forEach((character) => {
    const detail = [character.role, character.description, character.story, character.goal, character.fear, character.secret,
      ...(character.traits || []), ...(character.groups || []), ...(character.tags || [])].filter(Boolean).join(' ');
    if (`${character.name} ${detail}`.toLowerCase().includes(query)) {
      results.push({ type: 'Character', title: character.name, detail: [character.role, character.description].filter(Boolean).join(' · '),
        open: (button) => openCharacterProfile(character, button) });
    }
  });
  const storiesById = new Map(savedStories.map((story) => [story.id, story]));
  Object.values(storyDrafts).forEach((story) => storiesById.set(story.id, story));
  storiesById.forEach((story) => {
    const detail = [story.text, story.summary, story.setting, ...(story.tags || []), ...storyCharacterNames(story), ...storyPlaceNames(story)].filter(Boolean).join(' ');
    if (`${story.title} ${detail}`.toLowerCase().includes(query)) {
      results.push({ type: storyDrafts[story.id] ? 'Story draft' : 'Story', title: story.title || 'Untitled story',
        detail: [story.summary, STORY_KINDS[story.kind] || 'Story'].filter(Boolean).join(' · '),
        open: (button) => openStoryEditor(story.id, button) });
    }
  });
  places.forEach((place) => {
    const detail = [place.summary, place.description, place.lore, place.partOf, ...place.tags, ...placeCharacterNames(place)].filter(Boolean).join(' ');
    if (`${place.name} ${detail}`.toLowerCase().includes(query)) {
      results.push({ type: 'Place', title: place.name, detail: [PLACE_KINDS[place.kind], place.summary].filter(Boolean).join(' · '),
        open: (button) => openPlaceEditor(place.id, button) });
    }
  });
  worldEntries.forEach((entry) => {
    const detail = [entry.summary, entry.description, entry.details, ...entry.tags].filter(Boolean).join(' ');
    if (`${entry.name} ${detail}`.toLowerCase().includes(query)) {
      results.push({ type: 'World entry', title: entry.name, detail: [WORLD_ENTRY_CATEGORIES[entry.category], entry.summary].filter(Boolean).join(' · '),
        open: (button) => openWorldEntryEditor(entry.id, button) });
    }
  });
  document.querySelector('#global-search-count').textContent = `${results.length} result${results.length === 1 ? '' : 's'}`;
  if (!results.length) {
    const empty = document.createElement('p');
    empty.className = 'global-search-empty';
    empty.textContent = 'No characters, stories, places, or world entries match that search.';
    list.append(empty);
  } else {
    results.slice(0, 30).forEach((result) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'global-search-result';
      const type = document.createElement('span');
      type.textContent = result.type;
      const text = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = result.title;
      const detail = document.createElement('small');
      detail.textContent = result.detail;
      text.append(title, detail);
      button.append(type, text);
      button.addEventListener('click', () => {
        globalSearchResults.classList.add('hidden');
        result.open(button);
      });
      list.append(button);
    });
  }
  globalSearchResults.classList.remove('hidden');
}

function initGlobalSearch() {
  const input = document.querySelector('#global-search-input');
  input.addEventListener('input', () => {
    window.clearTimeout(globalSearchTimer);
    globalSearchTimer = window.setTimeout(renderGlobalSearch, 120);
  });
  input.addEventListener('focus', renderGlobalSearch);
  document.querySelector('#global-search-close').addEventListener('click', () => {
    globalSearchResults.classList.add('hidden');
    input.value = '';
  });
  document.addEventListener('click', (event) => {
    if (event.target instanceof Node && !event.target.closest('.topbar') && !event.target.closest('#global-search-results')) {
      globalSearchResults.classList.add('hidden');
    }
  });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      input.focus();
      input.select();
    } else if (event.key === 'Escape' && !globalSearchResults.classList.contains('hidden')) {
      globalSearchResults.classList.add('hidden');
      input.blur();
    }
  });
}

function initPwa() {
  window.addEventListener('beforeinstallprompt', (event) => {
    if (isAppRunningStandalone() || appInstalledThisSession) return;
    event.preventDefault();
    deferredInstallPrompt = event;
    syncInstallButton();
  });
  window.addEventListener('appinstalled', () => {
    appInstalledThisSession = true;
    deferredInstallPrompt = null;
    syncInstallButton();
  });
  const standaloneQuery = window.matchMedia('(display-mode: standalone)');
  if (typeof standaloneQuery.addEventListener === 'function') standaloneQuery.addEventListener('change', syncInstallButton);
  else standaloneQuery.addListener(syncInstallButton);
  window.addEventListener('resize', syncInstallButton, { passive: true });
  window.addEventListener('pageshow', syncInstallButton);
  document.querySelector('#install-app').addEventListener('click', async () => {
    if (!deferredInstallPrompt) {
      showManualInstallInstructions();
      return;
    }
    const installPrompt = deferredInstallPrompt;
    deferredInstallPrompt = null;
    try {
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      if (outcome === 'accepted') appInstalledThisSession = true;
      syncInstallButton();
    } catch (error) {
      console.error('Fiction Tale could not open the install prompt.', error);
      syncInstallButton();
      showToast('The install prompt could not be opened. Try your browser’s menu to install the app.');
    }
  });
  syncInstallButton();
  if ('serviceWorker' in navigator && ['https:', 'http:'].includes(location.protocol)) {
    navigator.serviceWorker.register('./service-worker.js').catch((error) => {
      console.error('Fiction Tale offline support could not be enabled.', error);
    });
  }
}

function isAppRunningStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function syncInstallButton() {
  const button = document.querySelector('#install-app');
  const mobileBrowser = window.matchMedia('(max-width: 780px)').matches
    || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  button.classList.toggle('hidden', isAppRunningStandalone() || appInstalledThisSession
    || (!deferredInstallPrompt && !mobileBrowser));
}

function showManualInstallInstructions() {
  const isAppleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  showToast(isAppleMobile
    ? 'To install, tap Share, then “Add to Home Screen”.'
    : 'To install, open your browser menu and choose “Install app” or “Add to Home screen”.');
}

document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
  if (deleteDialog.open || document.querySelector('#image-crop-dialog').open) return;
  if (document.querySelector('#place-dialog').open) {
    event.preventDefault();
    document.querySelector('#place-form').requestSubmit();
  } else if (document.querySelector('#story-dialog').open) {
    event.preventDefault();
    saveCurrentStory();
  } else if (document.activeElement?.closest?.('#character-form')) {
    event.preventDefault();
    form.requestSubmit();
  }
});

function writeStorage(key, value) {
  const saved = window.FictionTaleStorage.write(key, value);
  if (saved) updateStorageMeterSoon();
  else {
    storageProblem = true;
    updateWorkspaceStorageStatus();
    renderStorageWarning();
  }
  return saved;
}

function removeStorage(key) {
  const removed = window.FictionTaleStorage.remove(key);
  if (removed) updateStorageMeterSoon();
  return removed;
}

function snapshotStorage(key) {
  const value = readStorage(key, undefined);
  return { exists: value !== undefined, value };
}

function restoreStorage(key, snapshot) {
  return snapshot.exists ? writeStorage(key, snapshot.value) : removeStorage(key);
}

function commitStorageUpdates(updates) {
  const previous = updates.map(([key]) => [key, snapshotStorage(key)]);
  for (let index = 0; index < updates.length; index += 1) {
    const [key, value] = updates[index];
    if (writeStorage(key, value)) continue;
    let restored = true;
    previous.slice(0, index).reverse().forEach(([savedKey, snapshot]) => {
      if (!restoreStorage(savedKey, snapshot)) restored = false;
    });
    if (!restored) console.error('Storage rollback failed after an incomplete library update.');
    return false;
  }
  return true;
}

function createRecentlyDeletedEntry(kind, record, related = {}) {
  return { id: createId(), kind, deletedAt: new Date().toISOString(), record, related };
}

function withRecentlyDeleted(entry) {
  return [entry, ...recentlyDeleted];
}

var draftSaveTimer = 0;
var draftSavePending = false;

function saveDraft() {
  draftSavePending = true;
  document.querySelector('#autosave-status').textContent = 'Saving…';
  window.clearTimeout(draftSaveTimer);
  draftSaveTimer = window.setTimeout(flushDraftSave, 450);
  return true;
}

function cancelDraftSave() {
  window.clearTimeout(draftSaveTimer);
  draftSavePending = false;
}

function flushDraftSave() {
  if (!draftSavePending) return true;
  cancelDraftSave();
  const saved = writeStorage(DRAFT_KEY, currentProfile());
  document.querySelector('#autosave-status').textContent = saved ? 'Draft saved' : 'Draft not saved';
  if (!saved && !draftSaveWarningShown) {
    showToast('Draft could not be saved. Export a backup or use Import JSON/CSV to restore it later.');
  }
  draftSaveWarningShown = !saved;
  if (saved) scheduleFolderBackup();
  return saved;
}

function traitsValue(traits) {
  return Array.isArray(traits) ? traits.join(', ') : String(traits || '');
}

function openFolderDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(FOLDER_DB_NAME, 1);
    request.addEventListener('upgradeneeded', () => {
      request.result.createObjectStore(FOLDER_STORE);
    });
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  });
}

async function folderDatabaseRequest(mode, action) {
  const database = await openFolderDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(FOLDER_STORE, mode);
    const store = transaction.objectStore(FOLDER_STORE);
    const request = action(store);
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
    transaction.addEventListener('complete', () => database.close());
    transaction.addEventListener('abort', () => reject(transaction.error));
  });
}

async function rememberDataDirectory(handle) {
  await folderDatabaseRequest('readwrite', (store) => store.put(handle, FOLDER_HANDLE_KEY));
}

function setFolderStatus(message) {
  document.querySelector('#settings-folder-status').textContent = message;
}

function scheduleFolderBackup() {
  if (!dataDirectory) return;
  window.clearTimeout(folderBackupTimer);
  folderBackupTimer = window.setTimeout(() => {
    folderBackupTimer = 0;
    persistCharacterLibrary();
  }, 1500);
}

function persistCharacterLibrary() {
  if (!dataDirectory) return;
  folderWritePending = folderWritePending.then(async () => {
    try {
      const permission = await dataDirectory.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        setFolderStatus('Folder permission needed — choose it again');
        return;
      }
      const file = await dataDirectory.getFileHandle('FictionTales-studio-backup.json', { create: true });
      const writable = await file.createWritable();
      await writable.write(JSON.stringify({
        format: 'FictionTales-studio-backup',
        version: 1,
        updatedAt: new Date().toISOString(),
        characters,
        characterDraft: [readStorage(DRAFT_KEY, null)].filter(Boolean),
        stories: savedStories,
        drafts: Object.values(storyDrafts),
        bookSeries,
        dialogueDrafts: Object.values(dialogueDrafts),
        writingGoals,
        places,
        worldEntries,
        recentlyDeleted,
        planning: window.FictionTalesPlanning?.getData() || readStorage('FictionTales.planning.v1', {}),
        placeDrafts: Object.values(placeDrafts),
      }, null, 2));
      await writable.close();
      markBackupCreated();
      setFolderStatus(`Backup updated in ${dataDirectory.name}`);
    } catch {
      setFolderStatus('Folder backup failed — use Export full backup');
      showToast('Could not update the folder backup. Your browser copy is still saved; use Settings to export a full backup.');
    }
  });
  return folderWritePending;
}

async function initializeDataFolder() {
  const button = document.querySelector('#connect-data-folder');
  if (!window.showDirectoryPicker || !window.indexedDB) {
    button.disabled = true;
    button.title = 'Folder access is unavailable in this browser. Export a full backup from Settings instead.';
    setFolderStatus('Folder access unavailable — use Export full backup');
    return;
  }
  try {
    const handle = await folderDatabaseRequest('readonly', (store) => store.get(FOLDER_HANDLE_KEY));
    if (!handle) return;
    const permission = await handle.queryPermission({ mode: 'readwrite' });
    dataDirectory = handle;
    button.textContent = 'Change backup folder';
    setFolderStatus(permission === 'granted'
      ? `Folder connected: ${handle.name}`
      : `Folder remembered: ${handle.name} (reconnect to allow access)`);
    if (permission === 'granted') await persistCharacterLibrary();
  } catch {
    setFolderStatus('Could not restore folder access — choose it again');
  }
}

document.querySelector('#connect-data-folder').addEventListener('click', async () => {
  try {
    const handle = await window.showDirectoryPicker({ id: 'FictionTales-character-data', mode: 'readwrite' });
    const permission = await handle.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      setFolderStatus('Permission not granted — using browser autosave');
      return;
    }
    dataDirectory = handle;
    await rememberDataDirectory(handle);
    document.querySelector('#connect-data-folder').textContent = 'Change backup folder';
    setFolderStatus(`Folder connected: ${handle.name}`);
    await persistCharacterLibrary();
    showToast(`Full backups will be saved in ${handle.name}.`);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    setFolderStatus('Could not connect folder — use Export full backup');
    showToast('Could not connect that folder. Browser autosave and full backup export are still available in Settings.');
  }
});

const resetButton = document.querySelector('#reset-content');
const resetDialog = document.querySelector('#reset-dialog');
modalDialogs.push(resetDialog);
resetDialog.addEventListener('close', syncModalScrollLock);
let resetHoldTimer = 0;
let resetHoldKey = '';
let resetHoldTriggered = false;
const RESET_HOLD_DURATION_MS = 1400;

function cancelResetHold() {
  window.clearTimeout(resetHoldTimer);
  resetHoldTimer = 0;
  resetHoldKey = '';
  resetButton.classList.remove('is-holding');
}

function startResetHold(trigger) {
  if (resetHoldTimer || resetDialog.open) return;
  resetHoldKey = trigger;
  resetButton.classList.add('is-holding');
  resetHoldTimer = window.setTimeout(() => {
    resetHoldTimer = 0;
    resetHoldKey = '';
    resetButton.classList.remove('is-holding');
    resetHoldTriggered = true;
    resetDialog.showModal();
    syncModalScrollLock();
    document.querySelector('#cancel-reset').focus();
  }, RESET_HOLD_DURATION_MS);
}

resetButton.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  startResetHold('pointer');
});
resetButton.addEventListener('pointerup', (event) => {
  if (resetHoldKey === 'pointer') cancelResetHold();
});
resetButton.addEventListener('pointercancel', cancelResetHold);
resetButton.addEventListener('pointerleave', () => {
  if (resetHoldKey === 'pointer') cancelResetHold();
});
resetButton.addEventListener('keydown', (event) => {
  if (!['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  if (!event.repeat) startResetHold(event.key);
});
resetButton.addEventListener('keyup', (event) => {
  if (resetHoldKey === event.key) cancelResetHold();
});
resetButton.addEventListener('blur', () => {
  if (resetHoldKey) cancelResetHold();
});
resetButton.addEventListener('contextmenu', (event) => event.preventDefault());
resetButton.addEventListener('click', (event) => {
  event.preventDefault();
  if (resetHoldTriggered) {
    resetHoldTriggered = false;
    return;
  }
  showToast('Press and hold the reset button to open the confirmation.');
});
document.querySelector('#cancel-reset').addEventListener('click', () => resetDialog.close());
resetDialog.addEventListener('click', (event) => {
  if (event.target === resetDialog) resetDialog.close();
});
document.querySelector('#confirm-reset').addEventListener('click', async () => {
  const confirmButton = document.querySelector('#confirm-reset');
  confirmButton.disabled = true;
  try {
    cancelDraftSave();
    cancelStoryDraftSave();
    window.clearTimeout(placeDraftTimer);
    placeDraftPending = false;
    window.clearTimeout(folderBackupTimer);
    folderBackupTimer = 0;
    await folderWritePending;

    const handle = dataDirectory || (window.indexedDB ? await folderDatabaseRequest(
      'readonly',
      (store) => store.get(FOLDER_HANDLE_KEY),
    ) : null);
    if (handle) {
      let permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') permission = await handle.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        throw new Error('Reset was cancelled because permission to remove the saved folder backup was not granted.');
      }
      for (const filename of ['FictionTales-studio-backup.json', 'FictionTales-character-library.json', 'fable-studio-backup.json', 'fable-character-library.json']) {
        try {
          await handle.removeEntry(filename);
        } catch (error) {
          if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error;
        }
      }
    }

    if (window.indexedDB) {
      await folderDatabaseRequest('readwrite', (store) => store.delete(FOLDER_HANDLE_KEY));
    }
    await window.FictionTaleStorage.clearAppData();
    resetDialog.close();
    window.location.reload();
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Reset failed. Your saved content was not cleared.');
  } finally {
    confirmButton.disabled = false;
  }
});

function setText(selector, value, fallback) {
  document.querySelector(selector).textContent = value || fallback;
}

function validImageSource(value) {
  const source = value.trim();
  return source.startsWith('data:image/') || validWebUrl(source);
}

function imageKey(source) {
  return `${source.length}:${source.slice(0, 64)}:${source.slice(-64)}`;
}

function setImageSource(image, value, onError = () => {}) {
  const source = (value || '').trim();
  if (!source || !validImageSource(source)) {
    image.dataset.imageKey = '';
    image.dataset.imageFailed = '';
    image.onerror = null;
    image.onload = null;
    image.removeAttribute('src');
    image.classList.add('hidden');
    return false;
  }
  const key = imageKey(source);
  const fail = () => {
    if (image.dataset.imageKey !== key) return;
    image.dataset.imageFailed = key;
    image.classList.add('hidden');
    onError();
  };
  if (image.dataset.imageKey === key) {
    image.onerror = fail;
    return image.dataset.imageFailed !== key;
  }
  image.dataset.imageKey = key;
  image.dataset.imageFailed = '';
  image.decoding = 'async';
  image.onload = () => {
    if (image.dataset.imageKey === key) image.classList.remove('hidden');
  };
  image.onerror = fail;
  image.src = source;
  image.classList.remove('hidden');
  return true;
}

var previewFrame = 0;

function schedulePreview() {
  if (previewFrame) return;
  previewFrame = window.setTimeout(() => {
    previewFrame = 0;
    updatePreview();
  }, 24);
}

function debounce(callback, delay = 150) {
  let timer = 0;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), delay);
  };
}

function updatePreview() {
  const profile = currentProfile();
  document.querySelector('#description-count').textContent = String(profile.description.length);
  document.querySelector('#backstory-count').textContent = String(profile.story.length);
  updateProfileMeter(profile);
  syncImageChips();
  syncGalleryThumbs();
}

function renderCharacters() {
  const query = document.querySelector('#search-characters').value.trim().toLowerCase();
  const groupSelect = document.querySelector('#cast-group-filter');
  const allGroups = [...new Set(characters.flatMap((character) => character.groups || []))].sort((a, b) => a.localeCompare(b));
  const previousGroup = groupSelect.value;
  groupSelect.replaceChildren(new Option('All groups', ''), ...allGroups.map((group) => new Option(group, group)));
  groupSelect.value = allGroups.includes(previousGroup) ? previousGroup : '';
  groupSelect.classList.toggle('hidden', !allGroups.length);
  const groupFilter = groupSelect.value;
  const sortMode = document.querySelector('#cast-sort').value;
  const filtered = characters.filter((character) => (!groupFilter || (character.groups || []).includes(groupFilter)) && [
    character.name,
    character.role,
    character.species,
    character.description,
    ...(character.traits || []),
    ...(character.groups || []),
    ...(character.tags || []),
  ].join(' ').toLowerCase().includes(query));
  if (sortMode === 'name') filtered.sort((a, b) => a.name.localeCompare(b.name));
  else if (sortMode === 'edited') filtered.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  characterGrid.replaceChildren();
  document.querySelector('#compare-characters').disabled = characters.length < 2;
  filtered.forEach((character) => {
    const item = document.createElement('div');
    item.className = 'character-card-item';
    const card = document.createElement('button');
    card.className = 'cast-card';
    card.type = 'button';
    card.style.setProperty('--thumb-accent', character.accent || '#4385e8');
    card.setAttribute('aria-label', `View profile for ${character.name}${character.role ? `, ${character.role}` : ''}`);
    card.title = [character.name, character.role, character.description].filter(Boolean).join(' — ');

    const thumb = document.createElement('span');
    thumb.className = 'cast-thumb';
    const initial = document.createElement('span');
    initial.className = 'cast-initial';
    initial.textContent = (character.name || '?').slice(0, 1).toUpperCase();
    thumb.append(initial);
    if (character.avatar) {
      const image = document.createElement('img');
      image.src = character.avatar;
      image.alt = '';
      image.loading = 'lazy';
      applyImageCrop(image, character.avatarCrop);
      image.addEventListener('error', () => {
        image.remove();
        thumb.classList.add('has-failed-image');
      }, { once: true });
      thumb.append(image);
    }

    const info = document.createElement('span');
    info.className = 'cast-info';
    const name = document.createElement('h3');
    name.textContent = character.name;
    const heading = document.createElement('span');
    heading.className = 'cast-role';
    heading.textContent = character.role || character.species || 'A character in your story';
    const description = document.createElement('span');
    description.className = 'cast-description';
    description.textContent = character.description || 'Their story is just beginning.';
    const traits = document.createElement('span');
    traits.className = 'cast-traits';
    const visibleTraits = [...(character.traits || []), ...(character.tags || [])].slice(0, 3);
    if (visibleTraits.length) {
      visibleTraits.forEach((trait) => {
        const chip = document.createElement('span');
        chip.textContent = trait;
        traits.append(chip);
      });
    }
    const viewProfile = document.createElement('span');
    viewProfile.className = 'cast-view-profile';
    viewProfile.textContent = 'View profile';
    const arrow = document.createElement('span');
    arrow.className = 'cast-arrow';
    arrow.textContent = '↗';
    info.append(name, heading, description);
    if ((character.groups || []).length) {
      const groupLine = document.createElement('span');
      groupLine.className = 'cast-groups';
      groupLine.textContent = `⚑ ${character.groups.slice(0, 2).join(', ')}${character.groups.length > 2 ? ` +${character.groups.length - 2}` : ''}`;
      info.append(groupLine);
    }
    if (visibleTraits.length) info.append(traits);
    info.append(viewProfile);
    card.append(thumb, info, arrow);
    card.addEventListener('click', () => openCharacterProfile(character, card));
    const remove = document.createElement('button');
    remove.className = 'card-delete-button character-delete-button';
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Delete character: ${character.name}`);
    remove.title = `Delete ${character.name}`;
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      requestDeleteItem(character.id, 'character', character, remove);
    });
    item.append(card, remove);
    characterGrid.append(item);
  });

  characterGrid.classList.toggle('is-horizontal', filtered.length >= 4);
  if (filtered.length >= 4) {
    characterGrid.tabIndex = 0;
    characterGrid.setAttribute('aria-label', 'Character cards. Scroll horizontally to see more.');
  } else {
    characterGrid.removeAttribute('tabindex');
    characterGrid.removeAttribute('aria-label');
  }
  document.querySelector('#sidebar-count').textContent = String(characters.length);
  document.querySelector('#cast-total').textContent = `(${characters.length})`;
  emptyState.classList.toggle('hidden', characters.length > 0);
  if (characters.length > 0 && filtered.length === 0) {
    emptyState.classList.remove('hidden');
    emptyState.querySelector('h3').textContent = 'No characters found.';
    emptyState.querySelector('p').textContent = 'Try another name or trait in your search.';
    emptyState.querySelector('button').classList.add('hidden');
  } else {
    emptyState.querySelector('h3').textContent = 'Your story is a blank page.';
    emptyState.querySelector('p').textContent = 'Create a character to see their card and profile details here.';
    emptyState.querySelector('button').classList.remove('hidden');
  }
  renderRelationEditors();
  const castSignature = characters.map((character) => `${character.id}:${character.name}`).join('|');
  if (castSignature !== lastCastSignature) {
    lastCastSignature = castSignature;
    renderPlaces();
  }
  renderBackupInformation();
}

var lastCastSignature = null;

function validWebUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function setProfileText(selector, value, fallback = '') {
  const element = document.querySelector(selector);
  element.textContent = value || fallback;
  element.classList.toggle('hidden', !value && !fallback);
}

function setProfileSectionVisible(element, visible) {
  element.closest('.profile-section')?.classList.toggle('hidden', !visible);
}

function renderProfileStories(characterId) {
  const box = document.querySelector('#profile-stories');
  box.replaceChildren();
  const storiesById = new Map(savedStories.map((story) => [story.id, story]));
  Object.values(storyDrafts).forEach((story) => storiesById.set(story.id, story));
  const appearances = [...storiesById.values()].map((story) => {
    const chapters = parseStoryChapters(story.text || '');
    const sections = chapters.length ? chapters.map((chapter, index) => ({
      title: chapter.title,
      content: story.text.slice(chapter.start + chapter.headingLength, chapter.end),
      index,
    })) : [{ title: 'Unsectioned text', content: story.text || '', index: -1 }];
    const appearedIn = sections.filter((section) => findCharacterMentions(section.content)
      .some((mention) => mention.character.id === characterId)).map((section) => section.title);
    return { story, appearedIn, linked: (story.characterIds || []).includes(characterId) };
  }).filter((entry) => entry.linked || entry.appearedIn.length);
  if (!appearances.length) {
    setProfileSectionVisible(box, false);
    return;
  }
  setProfileSectionVisible(box, true);
  appearances.forEach(({ story, appearedIn, linked }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'profile-story-link';
    const name = document.createElement('strong');
    name.textContent = story.title || 'Untitled story';
    const detail = document.createElement('span');
    const appearanceDetail = appearedIn.length ? `Appears in: ${appearedIn.join(', ')}` : 'Linked story · no @mentions yet';
    const draftLabel = storyDrafts[story.id] ? ' · Draft' : '';
    detail.textContent = `${STORY_KINDS[story.kind] || 'Story'} · ${STORY_PROGRESS[story.progress] || 'Drafting'}${draftLabel} · ${appearanceDetail}`;
    button.append(name, detail);
    button.addEventListener('click', () => {
      requestProfileClose(() => openStoryEditor(story.id, document.querySelector('#new-story')));
    });
    box.append(button);
  });
}

function openCharacterProfile(character, returnFocus = document.activeElement, draftPreview = false) {
  profileReturnFocus = returnFocus;
  profileDraftPreview = draftPreview;
  const profile = { ...character, traits: character.traits || [] };
  activeProfile = profile;
  profileGalleryRendered = false;
  const accent = profile.accent || '#4385e8';
  characterDialog.style.setProperty('--profile-accent', accent);
  characterDialog.style.setProperty('--profile-background', accent);
  document.querySelector('#profile-name').dataset.characterId = profile.id;
  setProfileText('#profile-name', profile.name, 'Your character');
  document.querySelector('#profile-back-label').textContent = draftPreview ? 'Back to studio' : 'Back to characters';
  document.querySelector('#profile-edit').textContent = draftPreview ? 'Back to studio' : 'Edit this character';
  setProfileText('#profile-role', profile.role);
  setProfileText('#profile-about', profile.description);

  const cover = document.querySelector('#profile-cover-image');
  const avatar = document.querySelector('#profile-avatar');
  const avatarPlaceholder = document.querySelector('#profile-avatar-placeholder');
  const coverImage = profile.cover || profile.avatar;
  const hasAvatar = setImageSource(avatar, profile.avatar, () => {
    avatarPlaceholder.textContent = (profile.name || '?').slice(0, 1).toUpperCase();
    avatarPlaceholder.classList.remove('hidden');
    showToast('Could not load the profile picture. Use a direct image URL or upload an image file.');
  });
  if (hasAvatar) {
    avatar.alt = `${profile.name || 'Character'} portrait`;
    avatar.decoding = 'async';
    applyImageCrop(avatar, profile.avatarCrop);
    avatarPlaceholder.classList.add('hidden');
  } else {
    avatarPlaceholder.textContent = (profile.name || '?').slice(0, 1).toUpperCase();
    avatarPlaceholder.classList.remove('hidden');
  }
  if (setImageSource(cover, coverImage, () => {
    showToast('Could not load the cover image. Use a direct image URL or upload an image file.');
  })) {
    cover.decoding = 'async';
    applyImageCrop(cover, profile.cover ? profile.coverCrop : profile.avatarCrop);
  }

  const tags = document.querySelector('#profile-tags');
  tags.replaceChildren();
  [...profile.traits, ...(profile.tags || []), profile.pronouns, profile.age, profile.species, ...(profile.groups || []).map((group) => `⚑ ${group}`)].filter(Boolean).forEach((item) => {
    const tag = document.createElement('span');
    tag.className = 'profile-tag';
    tag.textContent = item;
    tag.title = item;
    tags.append(tag);
  });

  const storyBlock = document.querySelector('#profile-story-block');
  storyBlock.classList.toggle('hidden', !profile.story);
  storyBlock.closest('.profile-section')?.classList.toggle('hidden', !profile.story);
  document.querySelector('#profile-story').textContent = profile.story || '';
  const gallery = document.querySelector('#profile-gallery');
  setProfileSectionVisible(gallery, profileImageSources(profile).length > 0);

  const stats = document.querySelector('#profile-stats');
  stats.replaceChildren();
  [
    ['Role', profile.role],
    ['Pronouns', profile.pronouns],
    ['Age', profile.age],
    ['Species', profile.species],
    ...(profile.stats || '').split(/\r?\n/).map((line) => {
      const separator = line.indexOf(':');
      return separator > -1 ? [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] : ['', line.trim()];
    }),
  ].filter(([, value]) => value).forEach(([label, value]) => {
    const item = document.createElement('div');
    item.className = 'profile-stat';
    const term = document.createElement('span');
    term.textContent = label || 'Detail';
    const description = document.createElement('strong');
    description.textContent = value;
    item.title = `${label || 'Detail'}: ${value}`;
    item.append(term, description);
    stats.append(item);
  });
  setProfileSectionVisible(stats, Boolean(stats.childElementCount));

  setProfileText('#profile-relations', profile.relations);
  setProfileSectionVisible(document.querySelector('#profile-relations'), Boolean(profile.relations));
  setProfileText('#profile-worlds', profile.worlds);
  setProfileSectionVisible(document.querySelector('#profile-worlds'), Boolean(profile.worlds));
  renderProfileStories(profile.id);
  renderProfilePlaces(profile);
  renderProfileCustom(profile);
  renderProfileDepth(profile);
  renderProfilePersonality(profile);
  renderProfileConnections(profile);
  renderProfileTimeline(profile);
  renderProfileArc(profile);
  renderProfileSnapshots(profile);
  const links = document.querySelector('#profile-links');
  links.replaceChildren();
  (profile.links || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
    const parts = line.split('|').map((part) => part.trim());
    const url = parts.length > 1 ? parts.pop() : parts[0];
    if (!validWebUrl(url)) return;
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = parts.length ? parts.join(' | ') : url;
    link.title = url;
    links.append(link);
  });
  setProfileSectionVisible(links, Boolean(links.childElementCount));

  let openedInitialSection = false;
  document.querySelectorAll('.profile-section').forEach((section) => {
    const visible = !section.classList.contains('hidden');
    section.open = visible && !openedInitialSection;
    if (visible) openedInitialSection = true;
  });
  document.querySelector('#profile-gallery').replaceChildren();
  document.querySelector('#profile-gallery-empty').classList.add('hidden');
  characterDialog.classList.remove('is-closing');
  characterDialog.showModal();
  syncModalScrollLock();
  updateBackToTopVisibility();
  document.querySelector('#profile-close').focus();
}

function renderProfileGallery() {
  if (!activeProfile || profileGalleryRendered) return;
  const gallery = document.querySelector('#profile-gallery');
  const images = profileImageSources(activeProfile);
  images.forEach((url, index) => {
    const image = document.createElement('img');
    image.src = url;
    image.alt = `${activeProfile.name || 'Character'} image ${index + 1}`;
    image.loading = 'lazy';
    image.decoding = 'async';
    gallery.append(image);
  });
  document.querySelector('#profile-gallery-empty').classList.toggle('hidden', images.length > 0);
  profileGalleryRendered = true;
}

function profileImageSources(profile) {
  return [profile.cover, profile.avatar, ...(profile.gallery || '').split(/\r?\n/)]
    .map((url) => (url || '').trim())
    .filter((url, index, all) => url && all.indexOf(url) === index && (url.startsWith('data:image/') || validWebUrl(url)));
}

document.querySelector('#profile-gallery').closest('.profile-section').addEventListener('toggle', (event) => {
  if (event.currentTarget.open) renderProfileGallery();
});

function loadCharacter(id) {
  const character = characters.find((item) => item.id === id);
  if (!character) return;
  activeId = character.id;
  Object.entries({
    'character-id': character.id,
    name: character.name,
    role: character.role,
    pronouns: character.pronouns,
    age: character.age,
    species: character.species,
    description: character.description,
    traits: traitsValue(character.traits),
    avatar: character.avatar,
    cover: character.cover,
    accent: character.accent || '#4385e8',
    story: character.story,
    gallery: character.gallery,
    relations: character.relations,
    links: character.links,
    worlds: character.worlds,
    stats: character.stats,
    groups: traitsValue(character.groups),
    'character-tags': traitsValue(character.tags),
    goal: character.goal, fear: character.fear, secret: character.secret, flaw: character.flaw,
    voice: character.voice, 'voice-samples': character.voiceSamples, appearance: character.appearance,
    questionnaire: character.questionnaire, bonds: character.bonds, timeline: character.timeline, customSections: character.customSections,
    'arc-start': character.arcStart, 'arc-turning-point': character.arcTurningPoint, 'arc-end': character.arcEnd, snapshots: character.snapshots,
  }).forEach(([idName, value]) => { document.getElementById(idName).value = value || ''; });
  imageCropState = {
    avatar: normalizeImageCrop(character.avatarCrop),
    cover: normalizeImageCrop(character.coverCrop),
  };
  rememberImageSources();
  document.querySelector('#accent-hex').value = document.querySelector('#accent').value;
  document.querySelector('#save-label').textContent = 'Update character';
  syncCharacterActions(true);
  cancelDraftSave(); removeStorage(DRAFT_KEY);
  document.querySelector('#autosave-status').textContent = 'Editing saved character';
  characterFormHasChanges = false;
  document.querySelector('#depth-details').open = Boolean(character.goal || character.fear || character.secret
    || character.flaw || character.voice || character.voiceSamples || character.appearance);
  document.querySelector('#questionnaire-details').open = parseCharacterQuestionnaire(character.questionnaire).length > 0;
  document.querySelector('#profile-extras').open = Boolean(characterBonds(character).length || parseTimeline(character.timeline).length);
  document.querySelector('#character-arc-details').open = Boolean(character.arcStart || character.arcTurningPoint || character.arcEnd
    || parseCharacterSnapshots(character.snapshots).length);
  document.querySelector('#custom-details').open = parseCustomSections(character.customSections).length > 0;
  renderTimelineEditor();
  renderCharacterSnapshotsEditor();
  renderCharacterQuestionnaireEditor();
  renderRelationEditors();
  updatePreview();
  document.querySelector('#characters').scrollIntoView({ behavior: getMotionScrollBehavior(), block: 'start' });
  setActiveNavigation('characters');
}

function resetForm() {
  form.reset();
  document.querySelector('#character-id').value = '';
  document.querySelector('#accent').value = '#4385e8';
  document.querySelector('#accent-hex').value = '#4385e8';
  imageCropState = {
    avatar: { zoom: 1, x: 0, y: 0 },
    cover: { zoom: 1, x: 0, y: 0 },
  };
  rememberImageSources();
  activeId = '';
  document.querySelector('#save-label').textContent = 'Save character';
  syncCharacterActions(false);
  document.querySelector('#appearance-details').open = false;
  document.querySelector('#profile-extras').open = false;
  document.querySelector('#character-arc-details').open = false;
  document.querySelector('#depth-details').open = false;
  document.querySelector('#questionnaire-details').open = false;
  document.querySelector('#custom-details').open = false;
  renderTimelineEditor();
  renderCharacterSnapshotsEditor();
  renderCharacterQuestionnaireEditor();
  renderRelationEditors();
  cancelDraftSave(); removeStorage(DRAFT_KEY);
  characterFormHasChanges = false;
  document.querySelector('#autosave-status').textContent = 'Draft autosaves here';
  updatePreview();
  const nameInput = document.querySelector('#name');
  setActiveNavigation('characters');
  nameInput.focus({ preventScroll: true });
  const previousScrollBehavior = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = 'auto';
  nameInput.scrollIntoView({ behavior: 'auto', block: 'center' });
  document.documentElement.style.scrollBehavior = previousScrollBehavior;
}

function showToast(message) {
  toast.textContent = message;
  syncToastLayer();
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

window.addEventListener('fictiontale-storage-error', (event) => {
  const key = event.detail?.key || 'saved data';
  storageProblem = true;
  updateWorkspaceStorageStatus();
  renderStorageWarning();
  showToast(`Could not save ${key} to browser storage. Export a backup and free browser storage space.`);
});

function syncToastLayer() {
  const activeDialog = modalDialogs.find((dialog) => dialog.open);
  const modalWindow = activeDialog?.querySelector('.profile-window');
  if (modalWindow) {
    if (toast.parentElement !== modalWindow) modalWindow.append(toast);
    toast.classList.add('toast-in-modal');
  } else {
    if (toast.parentElement !== document.body) document.body.append(toast);
    toast.classList.remove('toast-in-modal');
  }
}

function updateBackToTopVisibility() {
  const button = document.querySelector('#back-to-top');
  button.classList.toggle('is-visible', window.scrollY > 360 && !characterDialog.open && !aboutDialog.open && !changelogDialog.open && !document.querySelector('#place-dialog').open && !document.querySelector('#story-dialog').open);
}

document.querySelector('#back-to-top').addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: getMotionScrollBehavior() });
});
window.addEventListener('scroll', updateBackToTopVisibility, { passive: true });

form.addEventListener('input', (event) => {
  if (event.target.id === 'avatar' || event.target.id === 'cover') return;
  characterFormHasChanges = true;
  schedulePreview();
  saveDraft();
});

document.querySelector('#accent-hex').addEventListener('input', (event) => {
  const hex = event.currentTarget.value.trim();
  if (/^#[0-9a-f]{6}$/i.test(hex)) {
    document.querySelector('#accent').value = hex;
  }
});

document.querySelector('#accent').addEventListener('input', (event) => {
  document.querySelector('#accent-hex').value = event.currentTarget.value;
});

function handleImageUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    showToast('Choose an image that is 5 MB or smaller.');
    event.target.value = '';
    return;
  }
  if (!file.type.startsWith('image/')) {
    showToast('Choose a valid image file.');
    event.target.value = '';
    return;
  }
  const kind = event.target.id === 'cover-file' ? 'cover' : 'avatar';
  if (imageCandidateDirtyBefore[kind] === null) imageCandidateDirtyBefore[kind] = characterFormHasChanges;
  characterFormHasChanges = true;
  readImageFile(file, kind === 'cover' ? 1600 : 900).then((dataUrl) => {
    openImageCropDialog(kind, dataUrl, imageField(kind).dataset.confirmedSource || '', {
      zoom: 1, x: 0, y: 0,
    }, event.target);
  }).catch(() => {
    characterFormHasChanges = imageCandidateDirtyBefore[kind] ?? characterFormHasChanges;
    imageCandidateDirtyBefore[kind] = null;
    showToast('Could not read this image file. Try another image or paste an image URL.');
  });
}

let renderedGalleryValue = null;

function imageSummary(value) {
  if (value.startsWith('data:')) return 'Uploaded image';
  try {
    const url = new URL(value);
    const path = url.pathname.length > 1 ? url.pathname : '';
    return `${url.hostname.replace(/^www\./, '')}${path.length > 26 ? `${path.slice(0, 26)}…` : path}`;
  } catch {
    return 'Image link';
  }
}

function syncImageChip(chip, wrap, value, show) {
  const visible = Boolean(show && value && validImageSource(value));
  wrap.classList.toggle('has-image', visible);
  chip.classList.toggle('hidden', !visible);
  const image = chip.querySelector('img');
  if (!visible) {
    if (chip.dataset.src) {
      chip.dataset.src = '';
      image.removeAttribute('src');
    }
    return;
  }
  if (chip.dataset.src !== value) {
    chip.dataset.src = value;
    image.classList.remove('hidden');
    image.onerror = () => image.classList.add('hidden');
    image.src = value;
  }
  const label = chip.querySelector('.upload-chip-text');
  label.textContent = imageSummary(value);
  label.title = value.startsWith('data:') ? '' : value;
}

function syncImageChips() {
  ['avatar', 'cover'].forEach((kind) => {
    const field = imageField(kind);
    const value = field.value.trim();
    syncImageChip(document.querySelector(`#${kind}-chip`), field.closest('.avatar-input-wrap'), value,
      value === (field.dataset.confirmedSource || ''));
  });
}

function syncStoryImageChip() {
  const field = document.querySelector('#story-image-url');
  syncImageChip(document.querySelector('#story-image-chip'), field.closest('.story-image-control'), field.value.trim(), true);
}

function galleryLines() {
  return document.querySelector('#gallery').value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function setGalleryLines(lines) {
  const gallery = document.querySelector('#gallery');
  gallery.value = lines.join('\n');
  gallery.dispatchEvent(new Event('input', { bubbles: true }));
}

function syncGalleryThumbs() {
  const gallery = document.querySelector('#gallery');
  if (renderedGalleryValue === gallery.value) return;
  renderedGalleryValue = gallery.value;
  const list = document.querySelector('#gallery-thumbs');
  list.replaceChildren();
  galleryLines().forEach((line, index) => {
    const item = document.createElement('li');
    item.className = 'gallery-thumb';
    if (validImageSource(line)) {
      const image = document.createElement('img');
      image.alt = `Extra image ${index + 1}`;
      image.loading = 'lazy';
      image.title = line.startsWith('data:') ? 'Uploaded image' : line;
      image.addEventListener('error', () => {
        image.remove();
        item.classList.add('is-broken');
        item.dataset.note = 'Could not load';
      });
      image.src = line;
      item.append(image);
    } else {
      item.classList.add('is-broken');
      item.dataset.note = 'Not an image link';
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove extra image ${index + 1}`);
    remove.addEventListener('click', () => setGalleryLines(galleryLines().filter((_, position) => position !== index)));
    item.append(remove);
    list.append(item);
  });
}

function addGalleryLink() {
  const input = document.querySelector('#gallery-url');
  const value = input.value.trim();
  if (!value) {
    showToast('Paste an image link first.');
    input.focus();
    return;
  }
  if (!validWebUrl(value)) {
    showToast('Use a direct http(s) image link, or upload an image file.');
    input.focus();
    return;
  }
  if (galleryLines().includes(value)) {
    showToast('That image is already in the gallery.');
    return;
  }
  setGalleryLines([...galleryLines(), value]);
  input.value = '';
  input.focus();
}

function imageField(kind) {
  return document.querySelector(`#${kind}`);
}

function rememberImageSources() {
  ['avatar', 'cover'].forEach((kind) => {
    imageField(kind).dataset.confirmedSource = imageField(kind).value.trim();
    imageCandidateDirtyBefore[kind] = null;
  });
}

function setCropPreview(crop) {
  const preview = document.querySelector('#image-crop-preview');
  applyImageCrop(preview, serializeImageCrop(crop));
  const maxPan = (crop.zoom - 1) * 50;
  ['x', 'y'].forEach((axis) => {
    const control = document.querySelector(`#image-crop-${axis}`);
    control.min = String(-maxPan);
    control.max = String(maxPan);
    control.value = String(crop[axis]);
    control.disabled = maxPan === 0;
  });
  document.querySelector('#image-crop-zoom').value = String(crop.zoom);
  document.querySelector('#image-crop-zoom-value').textContent = `${crop.zoom.toFixed(1)}×`;
}

function openImageCropDialog(kind, source, previousSource, crop, returnFocus = imageField(kind)) {
  if (imageCropDialog.open) return;
  const cleanSource = source.trim();
  if (!cleanSource || !validImageSource(cleanSource)) {
    showToast('Add a direct image URL or upload an image before editing it.');
    return;
  }
  const requestId = ++imageCropRequestId;
  const image = new Image();
  image.onload = () => {
    if (requestId !== imageCropRequestId || imageCropDialog.open) return;
    pendingImageCrop = {
      kind,
      source: cleanSource,
      previousSource,
      crop: normalizeImageCrop(serializeImageCrop(crop)),
      returnFocus,
      dirtyBefore: imageCandidateDirtyBefore[kind] ?? characterFormHasChanges,
    };
    const preview = document.querySelector('#image-crop-preview');
    preview.src = cleanSource;
    const frame = document.querySelector('#image-crop-frame');
    frame.classList.toggle('is-avatar', kind === 'avatar');
    frame.classList.toggle('is-cover', kind === 'cover');
    setCropPreview(pendingImageCrop.crop);
    imageCropDialog.showModal();
    syncModalScrollLock();
    document.querySelector('#image-crop-zoom').focus();
  };
  image.onerror = () => {
    if (requestId !== imageCropRequestId) return;
    imageField(kind).value = previousSource;
    imageField(kind).dataset.confirmedSource = previousSource;
    characterFormHasChanges = imageCandidateDirtyBefore[kind] ?? characterFormHasChanges;
    imageCandidateDirtyBefore[kind] = null;
    updatePreview();
    showToast('Could not load this image. Use a direct image URL or choose another file.');
  };
  image.src = cleanSource;
}

function cancelImageCrop() {
  if (!imageCropDialog.open) return;
  closeImageCrop(false);
}

function closeImageCrop(confirmed) {
  imageCropRequestId += 1;
  const pending = pendingImageCrop;
  pendingImageCrop = null;
  if (pending && !confirmed) {
    imageField(pending.kind).value = pending.previousSource;
    imageField(pending.kind).dataset.confirmedSource = pending.previousSource;
    characterFormHasChanges = pending.dirtyBefore;
  } else if (pending) {
    characterFormHasChanges = true;
  }
  if (pending) imageCandidateDirtyBefore[pending.kind] = null;
  document.querySelector('#image-crop-preview').removeAttribute('src');
  if (imageCropDialog.open) imageCropDialog.close();
  syncImageChips();
  syncModalScrollLock();
  if (pending?.returnFocus instanceof HTMLElement && pending.returnFocus.isConnected) pending.returnFocus.focus();
}

['avatar', 'cover'].forEach((kind) => {
  const field = imageField(kind);
  field.addEventListener('input', () => {
    if (field.value.trim()) {
      if (field.value.trim() !== field.dataset.confirmedSource) {
        if (imageCandidateDirtyBefore[kind] === null) imageCandidateDirtyBefore[kind] = characterFormHasChanges;
        characterFormHasChanges = true;
      }
      return;
    }
    imageCandidateDirtyBefore[kind] = null;
    imageCropState[kind] = { zoom: 1, x: 0, y: 0 };
    field.dataset.confirmedSource = '';
    characterFormHasChanges = true;
    updatePreview();
    saveDraft();
  });
  field.addEventListener('change', () => {
    const source = field.value.trim();
    const previousSource = field.dataset.confirmedSource || '';
    if (!source) return;
    if (source === previousSource) {
      if (imageCandidateDirtyBefore[kind] !== null) {
        characterFormHasChanges = imageCandidateDirtyBefore[kind];
        imageCandidateDirtyBefore[kind] = null;
      }
      return;
    }
    if (!validImageSource(source)) {
      field.value = previousSource;
      characterFormHasChanges = imageCandidateDirtyBefore[kind] ?? characterFormHasChanges;
      imageCandidateDirtyBefore[kind] = null;
      showToast('Use a direct http(s) image URL, or upload an image file.');
      return;
    }
    openImageCropDialog(kind, source, previousSource, { zoom: 1, x: 0, y: 0 });
  });
  document.querySelector(`#edit-${kind}-crop`).addEventListener('click', (event) => {
    const source = field.value.trim();
    if (!source) {
      showToast(`Add a ${kind === 'avatar' ? 'profile picture' : 'cover image'} URL or upload an image first.`);
      return;
    }
    if (source !== field.dataset.confirmedSource) return;
    openImageCropDialog(kind, source, field.dataset.confirmedSource || source, imageCropState[kind], event.currentTarget);
  });
});

document.querySelector('#image-crop-zoom').addEventListener('input', (event) => {
  if (!pendingImageCrop) return;
  const zoom = Number(event.currentTarget.value);
  const maxPan = (zoom - 1) * 50;
  pendingImageCrop.crop.zoom = zoom;
  pendingImageCrop.crop.x = Math.min(maxPan, Math.max(-maxPan, pendingImageCrop.crop.x));
  pendingImageCrop.crop.y = Math.min(maxPan, Math.max(-maxPan, pendingImageCrop.crop.y));
  setCropPreview(pendingImageCrop.crop);
});

['x', 'y'].forEach((axis) => {
  document.querySelector(`#image-crop-${axis}`).addEventListener('input', (event) => {
    if (!pendingImageCrop) return;
    pendingImageCrop.crop[axis] = Number(event.currentTarget.value);
    setCropPreview(pendingImageCrop.crop);
  });
});

const cropFrame = document.querySelector('#image-crop-frame');
cropFrame.addEventListener('pointerdown', (event) => {
  if (!pendingImageCrop || pendingImageCrop.crop.zoom <= 1) return;
  cropFrame.setPointerCapture(event.pointerId);
  cropFrame.dataset.dragX = String(event.clientX);
  cropFrame.dataset.dragY = String(event.clientY);
  cropFrame.dataset.cropX = String(pendingImageCrop.crop.x);
  cropFrame.dataset.cropY = String(pendingImageCrop.crop.y);
  cropFrame.classList.add('is-dragging');
});
cropFrame.addEventListener('pointermove', (event) => {
  if (!pendingImageCrop || !cropFrame.hasPointerCapture(event.pointerId)) return;
  const zoom = pendingImageCrop.crop.zoom;
  const maxPan = (zoom - 1) * 50;
  const width = cropFrame.clientWidth;
  const height = cropFrame.clientHeight;
  pendingImageCrop.crop.x = Math.min(maxPan, Math.max(-maxPan,
    Number(cropFrame.dataset.cropX) + ((event.clientX - Number(cropFrame.dataset.dragX)) / width) * 100));
  pendingImageCrop.crop.y = Math.min(maxPan, Math.max(-maxPan,
    Number(cropFrame.dataset.cropY) + ((event.clientY - Number(cropFrame.dataset.dragY)) / height) * 100));
  setCropPreview(pendingImageCrop.crop);
});
cropFrame.addEventListener('pointerup', () => cropFrame.classList.remove('is-dragging'));
cropFrame.addEventListener('pointercancel', () => cropFrame.classList.remove('is-dragging'));

document.querySelector('#confirm-image-crop').addEventListener('click', () => {
  if (!pendingImageCrop) return;
  const { kind, source, crop } = pendingImageCrop;
  imageField(kind).value = source;
  imageField(kind).dataset.confirmedSource = source;
  imageCropState[kind] = normalizeImageCrop(serializeImageCrop(crop));
  characterFormHasChanges = true;
  updatePreview();
  saveDraft();
  closeImageCrop(true);
});
document.querySelectorAll('#cancel-image-crop, #cancel-image-crop-action').forEach((button) => {
  button.addEventListener('click', cancelImageCrop);
});
imageCropDialog.addEventListener('click', (event) => {
  if (event.target === imageCropDialog) cancelImageCrop();
});
imageCropDialog.addEventListener('close', () => {
  if (pendingImageCrop) closeImageCrop(false);
});
imageCropDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  cancelImageCrop();
});

async function readImageFile(file, maxSide = 1400) {
  try {
    return await resizeStoryImage(file, maxSide);
  } catch {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(String(reader.result)));
      reader.addEventListener('error', () => reject(new Error(`Could not read ${file.name}. Try another image.`)));
      reader.readAsDataURL(file);
    });
  }
}

async function handleGalleryImageUpload(event) {
  const input = event.currentTarget;
  const files = [...(input.files || [])];
  if (!files.length) return;
  try {
    const urls = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not a valid image.`);
      if (file.size > MAX_IMAGE_UPLOAD_BYTES) throw new Error(`${file.name} is larger than 5 MB.`);
      urls.push(await readImageFile(file));
    }
    const galleryInput = document.querySelector('#gallery');
    const current = galleryInput.value.trim();
    const nextValue = [current, ...urls].filter(Boolean).join('\n');
    if (nextValue.length > MAX_GALLERY_VALUE_LENGTH) {
      throw new Error('There is not enough room for these extra images. Upload fewer images or use direct image links.');
    }
    galleryInput.value = nextValue;
    galleryInput.dispatchEvent(new Event('input', { bubbles: true }));
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Could not upload these images.');
  } finally {
    input.value = '';
  }
}

document.querySelector('#avatar-file').addEventListener('change', handleImageUpload);
document.querySelector('#cover-file').addEventListener('change', handleImageUpload);
document.querySelector('#select-avatar-file').addEventListener('click', () => document.querySelector('#avatar-file').click());
document.querySelector('#select-cover-file').addEventListener('click', () => document.querySelector('#cover-file').click());
document.querySelector('#select-gallery-files').addEventListener('click', () => document.querySelector('#gallery-files').click());
document.querySelector('#gallery-files').addEventListener('change', handleGalleryImageUpload);

function requestProfileClose(afterClose = null) {
  if (!characterDialog.open || characterDialog.classList.contains('is-closing')) return;
  profileAfterClose = typeof afterClose === 'function' ? afterClose : null;
  characterDialog.classList.add('is-closing');
  const delay = getMotionDelay(400);
  profileCloseTimer = window.setTimeout(() => {
    characterDialog.close();
    profileCloseTimer = null;
  }, delay);
}

document.querySelector('#profile-close').addEventListener('click', requestProfileClose);
document.querySelector('#profile-back').addEventListener('click', requestProfileClose);
characterDialog.addEventListener('click', (event) => {
  if (event.target === characterDialog) requestProfileClose();
});
characterDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  requestProfileClose();
});
characterDialog.addEventListener('close', () => {
  if (profileCloseTimer) {
    window.clearTimeout(profileCloseTimer);
    profileCloseTimer = null;
  }
  characterDialog.classList.remove('is-closing');
  updateBackToTopVisibility();
  if (profileReturnFocus instanceof HTMLElement && profileReturnFocus.isConnected) profileReturnFocus.focus();
  const afterClose = profileAfterClose;
  profileAfterClose = null;
  if (typeof afterClose === 'function') afterClose();
});
document.querySelector('#profile-edit').addEventListener('click', () => {
  if (profileDraftPreview) {
    requestProfileClose(() => document.querySelector('#name').focus());
    return;
  }
  const id = document.querySelector('#profile-name').dataset.characterId;
  if (!id) return;
  requestProfileClose(() => loadCharacter(id));
});
document.querySelector('#character-preview-open').addEventListener('click', (event) => {
  openCharacterProfile(currentProfile(), event.currentTarget, true);
});
document.querySelector('#compare-characters').addEventListener('click', (event) => {
  openCharacterComparison(event.currentTarget);
});
document.querySelector('#compare-close').addEventListener('click', () => compareDialog.close());
[document.querySelector('#compare-character-a'), document.querySelector('#compare-character-b')]
  .forEach((select) => select.addEventListener('change', renderCharacterComparison));
compareDialog.addEventListener('click', (event) => {
  if (event.target === compareDialog) compareDialog.close();
});
compareDialog.addEventListener('close', () => {
  syncModalScrollLock();
  if (compareReturnFocus instanceof HTMLElement && compareReturnFocus.isConnected) compareReturnFocus.focus();
  compareReturnFocus = null;
});

function renderChangelog() {
  const renderList = (list, entries, compact = false) => {
    list.replaceChildren();
    entries.forEach((entry, index) => {
      const card = document.createElement('article');
      card.className = compact ? 'landing-changelog-entry' : 'changelog-entry';
      const header = document.createElement(compact ? 'header' : 'div');
      if (!compact) header.className = 'changelog-entry-header';
      const version = document.createElement(compact ? 'h3' : 'h2');
      version.textContent = `Version ${entry.version}`;
      header.append(version);
      if (index === 0) {
        const badge = document.createElement('span');
        badge.className = compact ? 'landing-latest-badge' : 'changelog-badge';
        badge.textContent = 'Latest';
        header.append(badge);
      }
      const date = document.createElement('time');
      date.textContent = entry.date;
      date.dateTime = entry.date.replaceAll('/', '-');
      header.append(date);
      const notes = document.createElement('ul');
      entry.notes.forEach((note) => {
        const item = document.createElement('li');
        const match = note.match(/^(Lore & Story|Characters|Images|Fixed|Added|Backups|Places|Connections)(:|\b)/);
        if (match && match[2] === ':') {
          const label = document.createElement('strong');
          label.textContent = `${match[1]}:`;
          item.append(label, note.slice(match[0].length));
        } else {
          item.textContent = note;
        }
        notes.append(item);
      });
      card.append(header, notes);
      list.append(card);
    });
  };
  renderList(document.querySelector('#changelog-list'), CHANGELOG);
  renderList(document.querySelector('#landing-changelog-list'), CHANGELOG.slice(0, 3), true);
}
renderChangelog();
document.querySelector('#landing-version').textContent = `Version ${window.FICTION_TALE_VERSION}`;

function requestChangelogClose() {
  if (!changelogDialog.open || changelogDialog.classList.contains('is-closing')) return;
  changelogDialog.classList.add('is-closing');
  const delay = getMotionDelay(400);
  changelogCloseTimer = window.setTimeout(() => {
    changelogDialog.close();
    changelogCloseTimer = null;
  }, delay);
}
document.querySelector('#changelog-open').addEventListener('click', (event) => {
  changelogReturnFocus = event.currentTarget;
  renderChangelog();
  changelogDialog.classList.remove('is-closing');
  changelogDialog.showModal();
  syncModalScrollLock();
  changelogDialog.querySelector('.profile-scroll').scrollTop = 0;
  document.querySelector('#changelog-close').focus();
});
document.querySelector('#changelog-close').addEventListener('click', requestChangelogClose);
changelogDialog.addEventListener('click', (event) => {
  if (event.target === changelogDialog) requestChangelogClose();
});
changelogDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  requestChangelogClose();
});
changelogDialog.addEventListener('close', () => {
  if (changelogCloseTimer) {
    window.clearTimeout(changelogCloseTimer);
    changelogCloseTimer = null;
  }
  changelogDialog.classList.remove('is-closing');
  updateBackToTopVisibility();
  if (changelogReturnFocus instanceof HTMLElement && changelogReturnFocus.isConnected) changelogReturnFocus.focus();
});

document.querySelector('#about-website').addEventListener('click', (event) => {
  aboutReturnFocus = event.currentTarget;
  document.querySelector('#tutorial-choices').classList.remove('hidden');
  document.querySelector('#simple-tutorial-panel').classList.add('hidden');
  document.querySelector('#detailed-tutorial-panel').classList.add('hidden');
  aboutDialog.classList.remove('is-closing');
  aboutDialog.showModal();
  syncModalScrollLock();
  document.querySelector('#simple-tutorial-open').focus();
});
document.querySelectorAll('[data-tutorial-open]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelector('#about-website').click();
    document.querySelector(button.dataset.tutorialOpen === 'detailed' ? '#detailed-tutorial-open' : '#simple-tutorial-open').click();
  });
});
document.querySelector('#simple-tutorial-open').addEventListener('click', () => {
  document.querySelector('#tutorial-choices').classList.add('hidden');
  document.querySelector('#detailed-tutorial-panel').classList.add('hidden');
  const panel = document.querySelector('#simple-tutorial-panel');
  panel.classList.remove('hidden');
  panel.focus();
});
document.querySelector('#detailed-tutorial-open').addEventListener('click', () => {
  document.querySelector('#tutorial-choices').classList.add('hidden');
  document.querySelector('#simple-tutorial-panel').classList.add('hidden');
  const panel = document.querySelector('#detailed-tutorial-panel');
  panel.classList.remove('hidden');
  panel.focus();
});
document.querySelectorAll('.tutorial-back').forEach((button) => {
  button.addEventListener('click', () => {
    const fromDetailed = !document.querySelector('#detailed-tutorial-panel').classList.contains('hidden');
    document.querySelector('#simple-tutorial-panel').classList.add('hidden');
    document.querySelector('#detailed-tutorial-panel').classList.add('hidden');
    document.querySelector('#tutorial-choices').classList.remove('hidden');
    document.querySelector(fromDetailed ? '#detailed-tutorial-open' : '#simple-tutorial-open').focus();
  });
});
function requestAboutClose() {
  if (!aboutDialog.open || aboutDialog.classList.contains('is-closing')) return;
  aboutDialog.classList.add('is-closing');
  const delay = getMotionDelay(400);
  aboutCloseTimer = window.setTimeout(() => {
    aboutDialog.close();
    aboutCloseTimer = null;
  }, delay);
}
document.querySelector('#about-close').addEventListener('click', requestAboutClose);
aboutDialog.addEventListener('click', (event) => {
  if (event.target === aboutDialog) requestAboutClose();
});
aboutDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  requestAboutClose();
});
aboutDialog.addEventListener('close', () => {
  if (aboutCloseTimer) {
    window.clearTimeout(aboutCloseTimer);
    aboutCloseTimer = null;
  }
  aboutDialog.classList.remove('is-closing');
  updateBackToTopVisibility();
  if (aboutReturnFocus instanceof HTMLElement && aboutReturnFocus.isConnected) aboutReturnFocus.focus();
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (imageCropDialog.open) return;
  const unconfirmedImageKind = ['avatar', 'cover'].find((kind) => {
    const field = imageField(kind);
    return field.value.trim() && field.value.trim() !== field.dataset.confirmedSource;
  });
  if (unconfirmedImageKind) {
    const field = imageField(unconfirmedImageKind);
    openImageCropDialog(unconfirmedImageKind, field.value, field.dataset.confirmedSource || '', {
      zoom: 1, x: 0, y: 0,
    });
    return;
  }
  const profile = currentProfile();
  if (!profile.name) {
    document.querySelector('#name').focus();
    return;
  }
  const invalidImageField = ['avatar', 'cover'].find((field) => profile[field] && !validImageSource(profile[field]));
  if (invalidImageField) {
    showToast('Use a direct http(s) image URL, or upload an image file.');
    document.querySelector(`#${invalidImageField}`).focus();
    return;
  }
  profile.id = activeId || createId();
  profile.updatedAt = new Date().toISOString();
  profile.customSections = serializeCustomSections(parseCustomSections(profile.customSections));
  profile.bonds = serializeBonds(parseBonds(profile.bonds).filter((bond) => bond.id !== profile.id && characters.some((item) => item.id === bond.id)));
  const existingIndex = characters.findIndex((item) => item.id === profile.id);
  const nextCharacters = [...characters];
  if (existingIndex >= 0) nextCharacters[existingIndex] = profile;
  else nextCharacters.unshift(profile);
  let saved = writeStorage(STORAGE_KEY, nextCharacters);
  if (!saved) {
    try {
      cancelDraftSave(); removeStorage(DRAFT_KEY);
      saved = writeStorage(STORAGE_KEY, nextCharacters);
    } catch {
      saved = false;
    }
  }
  if (!saved) {
    showToast('Could not save. Your browser storage may be full.');
    return;
  }
  const previousSaved = characters.find((item) => item.id === profile.id);
  characters = nextCharacters;
  if (previousSaved && !(characterVersions[profile.id] || []).length) recordCharacterVersion(previousSaved);
  recordCharacterVersion(profile);
  rememberImageSources();
  persistCharacterLibrary();
  activeId = profile.id;
  document.querySelector('#character-id').value = profile.id;
  cancelDraftSave(); removeStorage(DRAFT_KEY);
  characterFormHasChanges = false;
  document.querySelector('#autosave-status').textContent = 'Character saved';
  document.querySelector('#save-label').textContent = 'Update character';
  syncCharacterActions(true);
  renderCharacters();
  renderStories();
  const dialogueDraft = currentDialogueDraft();
  renderDialogueCharacters(dialogueDraft.participantIds);
  renderDialogueStories(dialogueDraft.storyId);
  renderDialogueDraftList();
  updateDialogueSaveButton();
  renderPlaces();
  updatePreview();
  const storyIdToResume = storyToResumeAfterCharacterCreate;
  storyToResumeAfterCharacterCreate = '';
  const storyToResume = storyIdToResume
    ? getProjectDashboardStories().find((story) => story.id === storyIdToResume) : null;
  if (storyToResume) {
    showToast(`${profile.name} is saved. Connect them to your story.`);
    const dashboard = document.querySelector('#project-dashboard');
    const returnFocus = document.querySelector('#project-workflow-list [data-story-workflow-step="characters"]');
    setActiveNavigation('project-dashboard');
    dashboard.scrollIntoView({ behavior: getMotionScrollBehavior() });
    openStoryWorkflowStep(storyToResume, 'characters', returnFocus || document.querySelector('#project-dashboard-open-story'));
  } else {
    showToast(`${profile.name} is saved to your cast.`);
  }
});

const exportFields = [
  ['id', 'ID'], ['name', 'Name'], ['role', 'Role'], ['pronouns', 'Pronouns'],
  ['age', 'Age'], ['species', 'Species'], ['description', 'Description'],
  ['traits', 'Traits'], ['tags', 'Tags'], ['story', 'Backstory'], ['avatar', 'Portrait'], ['cover', 'Cover'],
  ['avatarCrop', 'Portrait crop'], ['coverCrop', 'Cover crop'],
  ['accent', 'Accent'], ['gallery', 'Gallery'], ['relations', 'Relations'],
  ['links', 'Links'], ['worlds', 'Worlds'], ['stats', 'Stats'],
  ['groups', 'Groups'], ['goal', 'Goal'], ['fear', 'Fear'], ['secret', 'Secret'], ['flaw', 'Flaw'],
  ['voice', 'Voice'], ['appearance', 'Appearance'], ['bonds', 'Connections'], ['timeline', 'Timeline'],
  ['arcStart', 'Arc starting belief'], ['arcTurningPoint', 'Arc turning point'], ['arcEnd', 'Arc learned truth'],
  ['snapshots', 'Character snapshots'], ['customSections', 'Custom sections'],
];

function safeFilename(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character';
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join(' | ') : String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(profiles) {
  const header = exportFields.map(([, label]) => csvCell(label)).join(',');
  const rows = profiles.map((profile) => exportFields.map(([key]) => csvCell(profile[key])).join(','));
  return `\uFEFF${[header, ...rows].join('\r\n')}`;
}

function toText(profiles) {
  return profiles.map((profile) => exportFields
    .filter(([key]) => key !== 'id' && profile[key] !== '' && profile[key] != null && (!Array.isArray(profile[key]) || profile[key].length > 0))
    .map(([key, label]) => `${label}: ${key === 'bonds'
      ? parseBonds(profile[key]).map((bond) => {
        const name = characters.find((item) => item.id === bond.id)?.name || 'Unknown';
        const details = bondDetailParts(bond).join(' — ');
        return `${name}${details ? `: ${details}` : ''}`;
      }).join(', ')
      : key === 'customSections' ? parseCustomSections(profile[key]).map((section) => `${section.title}: ${section.text.replace(/\s+/g, ' ')}`).join(' | ')
      : key === 'timeline' ? parseTimeline(profile[key]).map((event) => `${event.when ? `${event.when}: ` : ''}${event.text}${event.knowledge ? ` (Knows: ${event.knowledge})` : ''}`).join('; ')
      : key === 'snapshots' ? parseCharacterSnapshots(profile[key]).map((snapshot) => `${snapshot.when}: ${[
        snapshot.appearance && `Appearance: ${snapshot.appearance}`,
        snapshot.knowledge && `Knows: ${snapshot.knowledge}`,
        snapshot.trust && `Trusts: ${snapshot.trust}`,
      ].filter(Boolean).join(', ')}`).join('; ')
      : Array.isArray(profile[key]) ? profile[key].join(', ') : profile[key]}`)
    .join('\n')).join('\n\n--------------------\n\n');
}

function downloadFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function zipBytes(files) {
  const encoder = new TextEncoder();
  const crcTable = Array.from({ length: 256 }, (_, value) => {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    return crc >>> 0;
  });
  const crc32 = (bytes) => {
    let crc = 0xffffffff;
    bytes.forEach((byte) => { crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8); });
    return (crc ^ 0xffffffff) >>> 0;
  };
  const write16 = (view, offset, value) => view.setUint16(offset, value, true);
  const write32 = (view, offset, value) => view.setUint32(offset, value >>> 0, true);
  const localParts = [];
  const directoryParts = [];
  let offset = 0;
  files.forEach(({ name, content }) => {
    const nameBytes = encoder.encode(name);
    const data = typeof content === 'string' ? encoder.encode(content) : content;
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    write32(localView, 0, 0x04034b50);
    write16(localView, 4, 20);
    write16(localView, 6, 0x0800);
    write16(localView, 8, 0);
    write16(localView, 12, 0x21);
    write32(localView, 14, crc);
    write32(localView, 18, data.length);
    write32(localView, 22, data.length);
    write16(localView, 26, nameBytes.length);
    local.set(nameBytes, 30);
    localParts.push(local, data);
    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    write32(centralView, 0, 0x02014b50);
    write16(centralView, 4, 20);
    write16(centralView, 6, 20);
    write16(centralView, 8, 0x0800);
    write16(centralView, 10, 0);
    write16(centralView, 14, 0x21);
    write32(centralView, 16, crc);
    write32(centralView, 20, data.length);
    write32(centralView, 24, data.length);
    write16(centralView, 28, nameBytes.length);
    write32(centralView, 42, offset);
    central.set(nameBytes, 46);
    directoryParts.push(central);
    offset += local.length + data.length;
  });
  const directoryLength = directoryParts.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054b50);
  write16(endView, 8, files.length);
  write16(endView, 10, files.length);
  write32(endView, 12, directoryLength);
  write32(endView, 16, offset);
  const all = [...localParts, ...directoryParts, end];
  const result = new Uint8Array(all.reduce((total, part) => total + part.length, 0));
  let cursor = 0;
  all.forEach((part) => { result.set(part, cursor); cursor += part.length; });
  return result;
}

function xmlEscape(value) {
  return String(value || '').replace(/[<>&"']/g, (character) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  }[character]));
}

function storyParagraphs(story) {
  return String(story.text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function createDocx(stories) {
  const paragraphs = [];
  stories.forEach((story) => {
    paragraphs.push(`<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t xml:space="preserve">${xmlEscape(story.title || 'Untitled story')}</w:t></w:r></w:p>`);
    storyParagraphs(story).forEach((line) => {
      const heading = line.match(/^#{1,3}\s+(.+)$/);
      const text = heading ? heading[1] : line;
      const style = heading ? `<w:pPr><w:pStyle w:val="Heading${heading[0].match(/^#+/)[0].length}"/></w:pPr>` : '';
      paragraphs.push(`<w:p>${style}<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`);
    });
  });
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  return zipBytes([
    { name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/document.xml', content: documentXml },
  ]);
}

function createEpub(stories) {
  const entries = stories.map((story, index) => {
    const id = `story-${index + 1}`;
    const paragraphs = storyParagraphs(story).map((line) => {
      const heading = line.match(/^#{1,3}\s+(.+)$/);
      return heading ? `<h2>${xmlEscape(heading[1])}</h2>` : `<p>${xmlEscape(line)}</p>`;
    }).join('');
    return { id, title: story.title || `Untitled story ${index + 1}`, html: `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${xmlEscape(story.title || 'Untitled story')}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><h1>${xmlEscape(story.title || 'Untitled story')}</h1>${paragraphs}</body></html>` };
  });
  const manifest = entries.map((entry) => `<item id="${entry.id}" href="${entry.id}.xhtml" media-type="application/xhtml+xml"/>`).join('')
    + '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="style" href="style.css" media-type="text/css"/>';
  const spine = entries.map((entry) => `<itemref idref="${entry.id}"/>`).join('');
  const nav = entries.map((entry) => `<li><a href="${entry.id}.xhtml">${xmlEscape(entry.title)}</a></li>`).join('');
  return zipBytes([
    { name: 'mimetype', content: 'application/epub+zip' },
    { name: 'META-INF/container.xml', content: '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    { name: 'OEBPS/content.opf', content: `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:fictiontales:${Date.now()}</dc:identifier><dc:title>Fiction Tale</dc:title><dc:language>en</dc:language></metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>` },
    { name: 'OEBPS/nav.xhtml', content: `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${nav}</ol></nav></body></html>` },
    { name: 'OEBPS/style.css', content: 'body{font-family:serif;line-height:1.6;margin:5%}h1{text-align:center;margin:2em 0}h2{margin-top:2em}' },
    ...entries.map((entry) => ({ name: `OEBPS/${entry.id}.xhtml`, content: entry.html })),
  ]);
}

function exportCharacterSheetImage(profile = activeProfile) {
  if (!profile) {
    showToast('Open a character profile first.');
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 1500;
  const context = canvas.getContext('2d');
  if (!context) {
    showToast('Your browser could not create the character sheet image.');
    return;
  }
  const accent = /^#[0-9a-f]{6}$/i.test(profile.accent || '') ? profile.accent : '#4385e8';
  context.fillStyle = '#f5f8fd';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = accent;
  context.fillRect(0, 0, canvas.width, 390);
  context.fillStyle = '#ffffff';
  context.textAlign = 'center';
  context.font = '700 24px sans-serif';
  context.fillText('Fiction Tale Character Sheet', 600, 76);
  context.font = '700 58px sans-serif';
  context.fillText(profile.name || 'Your character', 600, 188, 1000);
  context.font = '600 23px sans-serif';
  context.fillText([profile.role, profile.pronouns, profile.species].filter(Boolean).join(' · ') || 'A story waiting to happen', 600, 240, 1000);
  let y = 310;
  const sections = [
    ['ABOUT', profile.description],
    ['TRAITS & TAGS', [...(profile.traits || []), ...(profile.tags || [])].join(' · ')],
    ['WANTS & FEARS', [profile.goal && `Wants: ${profile.goal}`, profile.fear && `Fears: ${profile.fear}`].filter(Boolean).join('\n')],
    ['BACKSTORY', profile.story],
    ['VOICE', [profile.voice, ...(profile.voiceSamples || '').split(/\r?\n/).filter(Boolean).slice(0, 3)].filter(Boolean).join('\n')],
    ['CHARACTER ARC', [profile.arcStart && `Believes: ${profile.arcStart}`, profile.arcTurningPoint && `Turning point: ${profile.arcTurningPoint}`, profile.arcEnd && `Learns: ${profile.arcEnd}`].filter(Boolean).join('\n')],
  ];
  context.textAlign = 'left';
  sections.forEach(([heading, value]) => {
    if (!value || y > 1340) return;
    context.fillStyle = accent;
    context.font = '700 18px sans-serif';
    context.fillText(heading, 80, y);
    y += 28;
    context.fillStyle = '#33485c';
    context.font = '22px sans-serif';
    String(value).split(/\r?\n/).forEach((line) => {
      const words = line.split(/\s+/);
      let row = '';
      words.forEach((word) => {
        const next = row ? `${row} ${word}` : word;
        if (context.measureText(next).width > 1020 && row) {
          if (y < 1380) context.fillText(row, 80, y, 1040);
          y += 31;
          row = word;
        } else row = next;
      });
      if (row && y < 1380) context.fillText(row, 80, y, 1040);
      y += 34;
    });
    y += 18;
  });
  context.fillStyle = '#8293a1';
  context.textAlign = 'center';
  context.font = '16px sans-serif';
  context.fillText('Made with Fiction Tale · Your story, your way', 600, 1450);
  canvas.toBlob((blob) => {
    if (!blob) {
      showToast('The character sheet image could not be exported.');
      return;
    }
    downloadFile(`${safeFilename(profile.name || 'character')}-sheet.png`, blob, 'image/png');
    showToast('Character sheet image exported.');
  }, 'image/png');
}

function yamlScalar(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => typeof item === 'string' ? JSON.stringify(item) : String(item)).join(', ')}]`;
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (value == null) return 'null';
  return String(value);
}

function toYaml(data) {
  return Object.entries(data).map(([key, value]) => {
    if (!Array.isArray(value)) return `${key}: ${yamlScalar(value)}`;
    if (!value.length) return `${key}: []`;
    return `${key}:\n${value.map((record) => {
      const entries = Object.entries(record);
      return entries.map(([field, fieldValue], index) => (
        `${index === 0 ? '  - ' : '    '}${field}: ${yamlScalar(fieldValue)}`
      )).join('\n');
    }).join('\n')}`;
  }).join('\n') + '\n';
}

function stripYamlComment(line) {
  let quoted = false;
  let singleQuoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"' && !singleQuoted && line[index - 1] !== '\\') quoted = !quoted;
    else if (line[index] === "'" && !quoted) singleQuoted = !singleQuoted;
    else if (line[index] === '#' && !quoted && !singleQuoted && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index).trimEnd();
    }
  }
  return line.trimEnd();
}

function parseYamlScalar(value) {
  const scalar = value.trim();
  if (!scalar) return '';
  if (scalar.startsWith('"')) {
    try {
      return JSON.parse(scalar);
    } catch {
      throw new Error('YAML contains an invalid quoted value.');
    }
  }
  if (scalar.startsWith("'") && scalar.endsWith("'")) return scalar.slice(1, -1).replace(/''/g, "'");
  if (scalar.startsWith('[') && scalar.endsWith(']')) {
    const contents = scalar.slice(1, -1).trim();
    if (!contents) return [];
    return contents.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(parseYamlScalar);
  }
  if (/^(null|~)$/i.test(scalar)) return '';
  if (/^(true|false)$/i.test(scalar)) return scalar.toLowerCase() === 'true';
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(scalar)) return Number(scalar);
  return scalar;
}

function parseYaml(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const root = {};
  let collection = null;
  let record = null;
  let rootSequence = false;
  const parseEntry = (content) => {
    const separator = content.indexOf(':');
    if (separator < 1) throw new Error('YAML entries must use a key: value format.');
    return [content.slice(0, separator).trim(), content.slice(separator + 1).trim()];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = stripYamlComment(lines[index]);
    if (!raw.trim() || raw.trim() === '---' || raw.trim() === '...') continue;
    if (raw.includes('\t')) throw new Error('YAML indentation must use spaces, not tabs.');
    const indent = raw.length - raw.trimStart().length;
    const content = raw.trim();
    if (indent === 0 && content.startsWith('- ')) {
      if (!rootSequence) {
        rootSequence = true;
        root.records = [];
      }
      record = {};
      root.records.push(record);
      const [key, value] = parseEntry(content.slice(2));
      record[key] = parseYamlScalar(value);
      collection = root.records;
      continue;
    }
    if (indent === 0) {
      record = null;
      const [key, value] = parseEntry(content);
      if (value) {
        root[key] = parseYamlScalar(value);
        collection = null;
      } else {
        root[key] = [];
        collection = root[key];
      }
      continue;
    }
    if (indent === 2 && content.startsWith('- ')) {
      if (!collection) throw new Error('YAML story or character lists must be under a named section.');
      record = {};
      collection.push(record);
      const [key, value] = parseEntry(content.slice(2));
      record[key] = parseYamlScalar(value);
      continue;
    }
    if (indent >= 4 && record) {
      const [key, value] = parseEntry(content);
      if (/^[|>][+-]?$/.test(value)) {
        const blockIndent = indent;
        const blockLines = [];
        while (index + 1 < lines.length) {
          const next = lines[index + 1];
          if (!next.trim()) {
            blockLines.push('');
            index += 1;
            continue;
          }
          const nextIndent = next.length - next.trimStart().length;
          if (nextIndent <= blockIndent) break;
          blockLines.push(next.slice(Math.min(nextIndent, blockIndent + 2)));
          index += 1;
        }
        record[key] = value.startsWith('>') ? blockLines.join(' ').trim() : blockLines.join('\n').replace(/\n+$/, '');
      } else {
        record[key] = parseYamlScalar(value);
      }
      continue;
    }
    throw new Error('Could not read the YAML structure. Use a list of records under stories: or characters:.');
  }
  return rootSequence ? root.records : root;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted && char === '"' && text[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ',') {
      row.push(cell);
      cell = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
      if (char === '\r' && text[index + 1] === '\n') index += 1;
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error('CSV contains an unfinished quoted value.');
  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
  }
  if (rows.length < 2) throw new Error('CSV must include a header row and at least one character.');

  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, '').trim());
  if (!headers.some((header) => ['name', 'character name', 'display name'].includes(header.toLowerCase()))) {
    throw new Error('CSV is missing a Name or Character Name column.');
  }
  return rows.slice(1).map((values) => Object.fromEntries(
    headers.map((header, index) => [header, values[index] || '']),
  ));
}

function normalizeCharacter(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const fields = Object.fromEntries(Object.entries(record).map(([key, value]) => [
    key.toLowerCase().replace(/[^a-z0-9]/g, ''),
    value,
  ]));
  const get = (...keys) => {
    for (const key of keys) {
      const value = fields[key.replace(/[^a-z0-9]/gi, '').toLowerCase()];
      if (value !== undefined && value !== null) return value;
    }
    return '';
  };
  const toString = (value, limit) => String(value ?? '').trim().slice(0, limit);
  const name = toString(get('name', 'character name', 'display name', 'title'), 48);
  if (!name) return null;
  const rawTraits = get('traits', 'personality') || get('tags');
  const traits = Array.isArray(rawTraits)
    ? rawTraits.map((trait) => toString(trait, 40)).filter(Boolean)
    : toString(rawTraits, 160).split(/[|,]/).map((trait) => trait.trim()).filter(Boolean);
  const toList = (raw, itemLimit, max) => (Array.isArray(raw)
    ? raw.map((item) => toString(item, itemLimit))
    : toString(raw, 400).split(/[|,]/).map((item) => item.trim().slice(0, itemLimit))).filter(Boolean).slice(0, max);
  const rawAccent = toString(get('accent', 'color', 'card color'), 7);
  const accent = /^#[0-9a-f]{6}$/i.test(rawAccent) ? rawAccent : '#4385e8';
  return {
    id: toString(get('id', 'uuid'), 100) || createId(),
    name,
    role: toString(get('role', 'type', 'occupation'), 60),
    pronouns: toString(get('pronouns'), 30),
    age: toString(get('age'), 24),
    species: toString(get('species', 'race'), 36),
    description: toString(get('description', 'about', 'summary', 'quote'), 360),
    traits: traits.slice(0, 20),
    avatar: toString(get('avatar', 'portrait', 'image', 'image url'), MAX_IMAGE_DATA_URL_LENGTH),
    cover: toString(get('cover', 'cover image', 'banner', 'banner image'), MAX_IMAGE_DATA_URL_LENGTH),
    avatarCrop: serializeImageCrop(normalizeImageCrop(get('avatarCrop', 'portrait crop'))),
    coverCrop: serializeImageCrop(normalizeImageCrop(get('coverCrop'))),
    accent,
    story: toString(get('story', 'backstory', 'background'), 4000),
    gallery: toString(get('gallery', 'images', 'image urls'), MAX_GALLERY_VALUE_LENGTH),
    relations: toString(get('relations', 'relationships'), 700),
    links: toString(get('links', 'url', 'website'), 700),
    worlds: toString(get('worlds', 'world', 'setting'), 700),
    stats: toString(get('stats', 'extra stats'), 700),
    groups: toList(get('groups', 'group', 'factions', 'faction'), 40, 10),
    tags: toList(get('tags'), 40, 20),
    goal: toString(get('goal', 'goals'), 200),
    fear: toString(get('fear', 'fears'), 200),
    secret: toString(get('secret', 'secrets'), 300),
    flaw: toString(get('flaw', 'flaws'), 200),
    voice: toString(get('voice', 'catchphrase'), 160),
    voiceSamples: toString(get('voiceSamples', 'voice samples', 'dialogue samples'), 1600),
    appearance: toString(get('appearance', 'looks'), 500),
    questionnaire: serializeCharacterQuestionnaire(get('questionnaire', 'personality questionnaire', 'questionnaire answers')),
    bonds: serializeBonds(parseBonds(get('bonds', 'connections'))),
    timeline: serializeTimeline(parseTimeline(get('timeline', 'events', 'life events'))),
    arcStart: toString(get('arcStart', 'arc starting belief', 'starting belief', 'arc start'), 400),
    arcTurningPoint: toString(get('arcTurningPoint', 'arc turning point', 'turning point'), 400),
    arcEnd: toString(get('arcEnd', 'arc learned truth', 'learned truth', 'end state'), 400),
    snapshots: serializeCharacterSnapshots(get('snapshots', 'character snapshots')),
    customSections: (() => {
      const raw = get('customSections', 'custom sections', 'custom');
      return serializeCustomSections(parseCustomSections(Array.isArray(raw) ? JSON.stringify(raw) : toString(raw, 40000)));
    })(),
    updatedAt: toString(get('updatedAt', 'updated at'), 40),
  };
}

function parseImportFile(text, filename) {
  const cleanText = text.replace(/^\uFEFF/, '').trim();
  const extension = filename.split('.').pop().toLowerCase();
  if (extension === 'csv' || (!['yaml', 'yml'].includes(extension) && !['{', '['].includes(cleanText[0]) && cleanText.includes(','))) {
    return parseCsv(cleanText);
  }
  if (extension === 'yaml' || extension === 'yml') {
    const parsedYaml = parseYaml(cleanText);
    if (Array.isArray(parsedYaml)) return parsedYaml;
    if (Array.isArray(parsedYaml.characters)) return parsedYaml.characters;
    if (Array.isArray(parsedYaml.data)) return parsedYaml.data;
    if (parsedYaml.character && typeof parsedYaml.character === 'object') return [parsedYaml.character];
    return [parsedYaml];
  }
  let parsed;
  try {
    parsed = JSON.parse(cleanText);
  } catch {
    throw new Error('Could not read the file. Choose a valid JSON, YAML, or CSV backup.');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('JSON must contain a character or character library.');
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.characters)) return parsed.characters;
  if (Array.isArray(parsed.data)) return parsed.data;
  if (parsed.character && typeof parsed.character === 'object') return [parsed.character];
  if (parsed.profile && typeof parsed.profile === 'object') return [parsed.profile];
  return [parsed];
}

async function importCharacters(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > MAX_IMPORT_FILE_BYTES) throw new Error('Choose an import file that is 5 MB or smaller.');
    const records = parseImportFile(await file.text(), file.name);
    const imported = records.map(normalizeCharacter).filter(Boolean);
    if (!imported.length) throw new Error('No characters with a name were found in that file.');

    const nextCharacters = [...characters];
    imported.forEach((character) => {
      const existingIndex = nextCharacters.findIndex((item) => item.id === character.id);
      if (existingIndex >= 0) nextCharacters[existingIndex] = character;
      else nextCharacters.unshift(character);
    });
    if (!writeStorage(STORAGE_KEY, nextCharacters)) {
      throw new Error('Could not import. Your browser storage may be full.');
    }
    characters = nextCharacters;
    renderCharacters();
    persistCharacterLibrary();
    const skipped = records.length - imported.length;
    showToast(`Imported ${imported.length} character${imported.length === 1 ? '' : 's'}${skipped ? `; skipped ${skipped} invalid entr${skipped === 1 ? 'y' : 'ies'}` : ''}.`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Import failed. Check that the file is valid JSON or CSV.');
  } finally {
    input.value = '';
  }
}

function normalizeImportedStory(record, forceDraft = false) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const story = {
    id: typeof record.id === 'string' && record.id.trim() ? record.id.trim().slice(0, 100) : createId(),
    title: typeof record.title === 'string' ? record.title.trim().slice(0, 100) : '',
    text: typeof record.text === 'string' ? record.text.slice(0, 30000) : '',
    titleFont: STORY_FONTS[record.titleFont] ? record.titleFont : 'playfair',
    bodyFont: STORY_FONTS[record.bodyFont] ? record.bodyFont : 'dm-sans',
    backgroundColor: normalizeStoryBackground(record.backgroundColor),
    image: typeof record.image === 'string' ? record.image.slice(0, MAX_IMAGE_DATA_URL_LENGTH) : '',
    updatedAt: typeof record.updatedAt === 'string' && record.updatedAt ? record.updatedAt : new Date().toISOString(),
    ...normalizeStoryMeta(record),
  };
  if (!story.title && !story.text.trim() && !story.image) return null;
  return { ...story, isDraft: forceDraft || record.status === 'draft' || !story.title };
}

function storyRecordsFromImport(parsed) {
  if (Array.isArray(parsed)) return parsed.map((story) => ({ story, draft: story?.status === 'draft' }));
  if (!parsed || typeof parsed !== 'object') return [];
  const records = [];
  if (Array.isArray(parsed.stories)) records.push(...parsed.stories.map((story) => ({ story, draft: false })));
  if (Array.isArray(parsed.drafts)) records.push(...parsed.drafts.map((story) => ({ story, draft: true })));
  if (!records.length && parsed.story && typeof parsed.story === 'object') records.push({ story: parsed.story, draft: false });
  if (!records.length && (typeof parsed.title === 'string' || typeof parsed.text === 'string')) {
    records.push({ story: parsed, draft: parsed.status === 'draft' });
  }
  return records;
}

async function importStories(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > MAX_IMPORT_FILE_BYTES) throw new Error('Choose an import file that is 5 MB or smaller.');
    const extension = file.name.split('.').pop().toLowerCase();
    if (!['json', 'yaml', 'yml'].includes(extension)) throw new Error('Choose a JSON or YAML story backup.');
    const contents = await file.text();
    const parsed = extension === 'yaml' || extension === 'yml'
      ? parseYaml(contents)
      : JSON.parse(contents.replace(/^\uFEFF/, ''));
    const entries = storyRecordsFromImport(parsed);
    const imported = entries.map(({ story, draft }) => normalizeImportedStory(story, draft)).filter(Boolean);
    if (!imported.length) throw new Error('No stories or unfinished drafts were found in that file.');

    const nextStories = [...savedStories];
    const nextDrafts = { ...storyDrafts };
    imported.forEach((story) => {
      if (story.isDraft) {
        const { isDraft, ...draft } = story;
        nextDrafts[draft.id] = draft;
      } else {
        const { isDraft, ...saved } = story;
        const existingIndex = nextStories.findIndex((item) => item.id === saved.id);
        if (existingIndex >= 0) nextStories[existingIndex] = saved;
        else nextStories.unshift(saved);
        delete nextDrafts[saved.id];
      }
    });

    const previousStories = snapshotStorage(STORIES_STORAGE_KEY);
    if (!writeStorage(STORIES_STORAGE_KEY, nextStories)) throw new Error('Could not import. Your browser storage may be full.');
    if (!writeStorage(STORY_DRAFTS_KEY, nextDrafts)) {
      restoreStorage(STORIES_STORAGE_KEY, previousStories);
      throw new Error('Could not import drafts. Your browser storage may be full.');
    }
    savedStories.splice(0, savedStories.length, ...nextStories);
    Object.keys(storyDrafts).forEach((id) => delete storyDrafts[id]);
    Object.assign(storyDrafts, nextDrafts);
    renderStories();
    const draftCount = imported.filter((story) => story.isDraft).length;
    const savedCount = imported.length - draftCount;
    showToast(`Imported ${savedCount} stor${savedCount === 1 ? 'y' : 'ies'} and ${draftCount} draft${draftCount === 1 ? '' : 's'}.`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Import failed. Check that the file is valid JSON or YAML.');
  } finally {
    input.value = '';
  }
}

function storiesToReadable(items, markdown) {
  return items.map((story) => {
    const names = storyCharacterNames(story);
    const title = story.title || 'Untitled story';
    const meta = [
      STORY_KINDS[story.kind], `${STORY_PROGRESS[story.progress] || 'Drafting'}${story.isDraft ? ' (unsaved draft)' : ''}`,
      story.setting && `Setting: ${story.setting}`,
      names.length && `Characters: ${names.join(', ')}`,
      story.tags?.length && `Tags: ${story.tags.join(', ')}`,
    ].filter(Boolean).join(' · ');
    return [
      markdown ? `# ${title}` : `${title}\n${'='.repeat(Math.min(title.length, 60))}`,
      meta,
      story.summary && (markdown ? `> ${story.summary}` : story.summary),
      story.text.trim(),
    ].filter(Boolean).join('\n\n');
  }).join(markdown ? '\n\n---\n\n' : '\n\n\n');
}

async function exportStories() {
  const format = document.querySelector('#story-export-format').value;
  const drafts = { ...storyDrafts };
  const dialog = document.querySelector('#story-dialog');
  if (dialog.open && !document.querySelector('#story-form').classList.contains('hidden')) {
    const currentDraft = currentStoryDraft();
    if (currentDraft.title || currentDraft.text.trim() || currentDraft.image) drafts[currentDraft.id] = currentDraft;
  }
  const data = {
    format: 'FictionTales-story-library',
    version: 1,
    stories: savedStories,
    drafts: Object.values(drafts),
  };
  if (!data.stories.length && !data.drafts.length) {
    showToast('There are no stories or drafts to export yet.');
    return;
  }
  try {
    const readable = format === 'md' || format === 'txt';
    const extension = ['md', 'txt', 'yaml', 'docx', 'epub'].includes(format) ? format : 'json';
    const content = format === 'docx' ? createDocx([...data.stories, ...data.drafts.map((draft) => ({ ...draft, isDraft: true }))])
      : format === 'epub' ? createEpub([...data.stories, ...data.drafts.map((draft) => ({ ...draft, isDraft: true }))])
        : readable
      ? storiesToReadable([...data.stories, ...data.drafts.map((draft) => ({ ...draft, isDraft: true }))], format === 'md')
      : format === 'yaml' ? toYaml(data) : JSON.stringify(data, null, 2);
    const mimeType = format === 'md' ? 'text/markdown;charset=utf-8' : format === 'txt' ? 'text/plain;charset=utf-8'
      : format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : format === 'epub' ? 'application/epub+zip' : format === 'yaml' ? 'text/yaml;charset=utf-8' : 'application/json;charset=utf-8';
    if (format === 'docx' || format === 'epub') {
      downloadFile(`FictionTales-story-library.${extension}`, content, mimeType);
      showToast(`Story collection exported as ${extension.toUpperCase()}.`);
      return;
    }
    downloadFile(`FictionTales-story-library.${extension}`, content, mimeType);
    showToast(readable
      ? `Stories exported as ${extension.toUpperCase()} for reading. Use JSON or YAML for backups you can import.`
      : `Story library and drafts exported as ${extension.toUpperCase()}.`);
  } catch {
    showToast('Story export failed. Check browser download permissions.');
  }
}

function exportProfiles(profiles, format, library = false) {
  if (!profiles.length) {
    showToast(library ? 'There are no saved characters to export.' : 'Add a character name before exporting.');
    return;
  }
  try {
    const filename = library ? 'FictionTales-character-library' : safeFilename(profiles[0].name);
    if (format === 'csv') {
      downloadFile(`${filename}.csv`, toCsv(profiles), 'text/csv;charset=utf-8');
    } else if (format === 'txt') {
      downloadFile(`${filename}.txt`, toText(profiles), 'text/plain;charset=utf-8');
    } else if (format === 'yaml') {
      const data = library
        ? { format: 'FictionTales-character-library', version: 1, characters: profiles }
        : { characters: profiles };
      downloadFile(`${filename}.yaml`, toYaml(data), 'text/yaml;charset=utf-8');
    } else {
      const data = library
        ? { format: 'FictionTales-character-library', version: 1, characters: profiles }
        : profiles[0];
      downloadFile(`${filename}.json`, JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
    }
    showToast(`${library ? 'Character library' : profiles[0].name} exported as ${format.toUpperCase()}.`);
  } catch {
    showToast('Export failed. Try another format or check browser download permissions.');
  }
}

function exportLibraryBackup() {
  flushPendingDrafts();
  flushPlaceDraft();
  const selectedFormat = document.querySelector('#settings-export-format').value;
  const format = selectedFormat === 'yaml' ? 'yaml' : 'json';
  const drafts = { ...storyDrafts };
  const storyDialog = document.querySelector('#story-dialog');
  if (storyDialog.open && !document.querySelector('#story-form').classList.contains('hidden')) {
    const currentDraft = currentStoryDraft();
    const saved = savedStories.find((story) => story.id === currentDraft.id);
    const unchanged = saved && saved.title === currentDraft.title && saved.text === currentDraft.text
      && saved.titleFont === currentDraft.titleFont && saved.bodyFont === currentDraft.bodyFont
      && saved.backgroundColor === currentDraft.backgroundColor && saved.image === currentDraft.image
      && storyMetaEqual(saved, currentDraft);
    if (unchanged) delete drafts[currentDraft.id];
    else if (currentDraft.title || currentDraft.text.trim() || currentDraft.image) drafts[currentDraft.id] = currentDraft;
  }
  const bundle = {
    format: 'FictionTales-studio-backup',
    version: 1,
    characters,
    characterDraft: [readStorage(DRAFT_KEY, null)].filter(Boolean),
    stories: savedStories,
    drafts: Object.values(drafts),
    bookSeries,
    dialogueDrafts: Object.values(dialogueDrafts),
    writingGoals,
    places,
    worldEntries,
    recentlyDeleted,
    planning: window.FictionTalesPlanning?.getData() || readStorage('FictionTales.planning.v1', {}),
    placeDrafts: Object.values(placeDrafts),
  };
  const content = format === 'yaml' ? toYaml(bundle) : JSON.stringify(bundle, null, 2);
  const extension = format;
  downloadFile(`FictionTales-studio-backup.${extension}`, content,
    format === 'yaml' ? 'text/yaml;charset=utf-8' : 'application/json;charset=utf-8');
  markBackupCreated();
  showToast(`Characters, stories, drafts, series, dialogue drafts, places, world entries, recently deleted items, planning data, and writing goals exported as ${extension.toUpperCase()}.`);
}

function mergeById(existing, imported) {
  const next = [...existing];
  imported.forEach((item) => {
    const index = next.findIndex((current) => current.id === item.id);
    if (index >= 0) next[index] = item;
    else next.unshift(item);
  });
  return next;
}

function normalizeBackupStories(parsed) {
  const entries = storyRecordsFromImport(parsed);
  const imported = entries.map(({ story, draft }) => normalizeImportedStory(story, draft)).filter(Boolean);
  return {
    stories: imported.filter((story) => !story.isDraft).map(({ isDraft, ...story }) => story),
    drafts: imported.filter((story) => story.isDraft).reduce((result, { isDraft, ...draft }) => {
      result[draft.id] = draft;
      return result;
    }, {}),
  };
}

function verifyStorage(key, expected) {
  return window.FictionTaleStorage.verify(projectStorageKey(activeProjectId, key), expected);
}

async function rollbackStorageSnapshots(snapshots) {
  let restored = true;
  for (const [key, snapshot] of [...snapshots].reverse()) {
    if (!restoreStorage(key, snapshot)) restored = false;
  }
  await window.FictionTaleStorage.flush();
  const verified = await Promise.all(snapshots.map(([key, snapshot]) => (
    verifyStorage(key, snapshot.exists ? snapshot.value : undefined)
  )));
  return restored && verified.every(Boolean);
}

async function importLibraryBackup(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > MAX_IMPORT_FILE_BYTES) throw new Error('Choose a backup file that is 5 MB or smaller.');
    const extension = file.name.split('.').pop().toLowerCase();
    if (!['json', 'yaml', 'yml', 'csv'].includes(extension)) throw new Error('Choose a JSON, YAML, or legacy CSV backup.');
    const contents = await file.text();
    const parsed = extension === 'csv' ? { characters: parseImportFile(contents, file.name) }
      : extension === 'json' ? JSON.parse(contents.replace(/^\uFEFF/, '')) : parseYaml(contents);
    if (!parsed || typeof parsed !== 'object') throw new Error('The backup must contain a Fiction Tale library or exported records.');

    const hasBundle = ['FictionTales-studio-backup', 'fable-studio-backup'].includes(parsed.format);
    const characterRecords = Array.isArray(parsed.characters) ? parsed.characters
      : hasBundle ? [] : parsed.character ? [parsed.character]
        : parsed.profile ? [parsed.profile] : typeof parsed.name === 'string' ? [parsed] : [];
    const importedCharacters = characterRecords.map(normalizeCharacter).filter(Boolean);
    const storyResult = normalizeBackupStories(hasBundle || Array.isArray(parsed.stories) || Array.isArray(parsed.drafts)
      ? parsed : (parsed.story || parsed.title || parsed.text ? parsed : {}));
    const placeRecords = Array.isArray(parsed.places) ? parsed.places
      : !hasBundle && parsed.name && !parsed.title ? [parsed] : [];
    const importedPlaces = placeRecords.map(normalizePlace).filter(Boolean);
    const worldEntryRecords = Array.isArray(parsed.worldEntries) ? parsed.worldEntries
      : !hasBundle && parsed.worldEntry && typeof parsed.worldEntry === 'object' ? [parsed.worldEntry] : [];
    const importedWorldEntries = worldEntryRecords.map(normalizeWorldEntry).filter(Boolean);
    const hasBookSeries = Array.isArray(parsed.bookSeries);
    const importedBookSeries = hasBookSeries ? normalizeBookSeries(parsed.bookSeries) : [];
    const hasPlanning = parsed.planning && typeof parsed.planning === 'object' && !Array.isArray(parsed.planning);
    const importedPlanning = hasPlanning ? window.FictionTalesPlanning.normalize(parsed.planning) : null;
    const hasWritingGoals = parsed.writingGoals && typeof parsed.writingGoals === 'object' && !Array.isArray(parsed.writingGoals);
    const importedWritingGoals = hasWritingGoals ? normalizeWritingGoals(parsed.writingGoals) : null;
    const hasRecentlyDeleted = Array.isArray(parsed.recentlyDeleted);
    const importedRecentlyDeleted = hasRecentlyDeleted ? normalizeRecentlyDeleted(parsed.recentlyDeleted) : [];
    const hasDialogueDrafts = Array.isArray(parsed.dialogueDrafts)
      || parsed.dialogueDrafts && typeof parsed.dialogueDrafts === 'object';
    const importedDialogueDrafts = hasDialogueDrafts ? normalizeDialogueDrafts(parsed.dialogueDrafts) : {};

    if (!hasBundle && !importedCharacters.length && !storyResult.stories.length
      && !Object.keys(storyResult.drafts).length && !Object.keys(importedDialogueDrafts).length
      && !importedPlaces.length && !importedWorldEntries.length && !importedBookSeries.length
      && !hasPlanning && !hasWritingGoals && !importedRecentlyDeleted.length) {
      const legacy = parseImportFile(contents, file.name);
      importedCharacters.push(...legacy.map(normalizeCharacter).filter(Boolean));
    }
    if (!importedCharacters.length && !storyResult.stories.length && !Object.keys(storyResult.drafts).length
      && !Object.keys(importedDialogueDrafts).length && !importedPlaces.length && !importedWorldEntries.length && !hasPlanning
      && !importedBookSeries.length && !hasWritingGoals && !importedRecentlyDeleted.length
      && !parsed.characterDraft && !parsed.placeDraft && !parsed.placeDrafts) {
      throw new Error('No characters, stories, drafts, series, dialogue drafts, places, world entries, planning data, or writing goals were found in that backup.');
    }

    const nextCharacters = mergeById(characters, importedCharacters);
    const nextStories = mergeById(savedStories, storyResult.stories);
    const nextDrafts = { ...storyDrafts, ...storyResult.drafts };
    const nextPlaces = mergeById(places, importedPlaces);
    const nextWorldEntries = mergeById(worldEntries, importedWorldEntries);
    const nextBookSeries = mergeById(bookSeries, importedBookSeries);
    const nextRecentlyDeleted = mergeById(recentlyDeleted, importedRecentlyDeleted);
    const nextDialogueDrafts = { ...dialogueDrafts, ...importedDialogueDrafts };
    const nextWritingGoals = importedWritingGoals ? {
      target: importedWritingGoals.target,
      days: { ...writingGoals.days },
    } : writingGoals;
    if (importedWritingGoals) {
      Object.entries(importedWritingGoals.days).forEach(([date, words]) => {
        nextWritingGoals.days[date] = Math.max(nextWritingGoals.days[date] || 0, words);
      });
    }
    const storageUpdates = [
      [STORAGE_KEY, nextCharacters],
      [STORIES_STORAGE_KEY, nextStories],
      [STORY_DRAFTS_KEY, nextDrafts],
      [PLACES_STORAGE_KEY, nextPlaces],
      [WORLD_ENTRIES_STORAGE_KEY, nextWorldEntries],
    ];
    if (hasDialogueDrafts) storageUpdates.push([DIALOGUE_DRAFTS_KEY, nextDialogueDrafts]);
    if (hasBookSeries) storageUpdates.push([SERIES_STORAGE_KEY, nextBookSeries]);
    if (hasRecentlyDeleted) storageUpdates.push([RECENTLY_DELETED_KEY, nextRecentlyDeleted]);
    if (hasWritingGoals) storageUpdates.push([WRITING_GOALS_KEY, nextWritingGoals]);
    if (hasPlanning) storageUpdates.push(['FictionTales.planning.v1', importedPlanning]);
    const rawCharacterDraft = Array.isArray(parsed.characterDraft) ? parsed.characterDraft[0] : parsed.characterDraft;
    if (rawCharacterDraft && typeof rawCharacterDraft === 'object') {
      storageUpdates.push([DRAFT_KEY, rawCharacterDraft]);
    }
    const rawPlaceDrafts = Array.isArray(parsed.placeDrafts) ? parsed.placeDrafts
      : parsed.placeDrafts && typeof parsed.placeDrafts === 'object' ? Object.values(parsed.placeDrafts) : [];
    if (parsed.placeDraft && typeof parsed.placeDraft === 'object') rawPlaceDrafts.push(parsed.placeDraft);
    const nextPlaceDrafts = { ...placeDrafts };
    rawPlaceDrafts.forEach((draft) => {
      if (!draft || typeof draft !== 'object') return;
      const normalized = normalizePlace({ ...draft, name: draft.name || 'Untitled place' });
      if (normalized) nextPlaceDrafts[normalized.id] = { ...normalized, name: typeof draft.name === 'string' ? draft.name : '' };
    });
    if (rawPlaceDrafts.length) {
      storageUpdates.push([PLACE_DRAFT_KEY, nextPlaceDrafts]);
    }
    const previous = storageUpdates.map(([key]) => [key, snapshotStorage(key)]);
    for (let index = 0; index < storageUpdates.length; index += 1) {
      const [key, value] = storageUpdates[index];
      if (writeStorage(key, value)) continue;
      const restored = await rollbackStorageSnapshots(previous.slice(0, index));
      throw new Error(restored
        ? 'Could not import the full backup. Your previous data was restored; browser storage may be full.'
        : 'Import failed and rollback could not be verified. Export any remaining data and check browser storage before continuing.');
    }

    await window.FictionTaleStorage.flush();
    const verified = await Promise.all(storageUpdates.map(([key, value]) => verifyStorage(key, value)));
    if (!verified.every(Boolean)) {
      const restored = await rollbackStorageSnapshots(previous);
      throw new Error(restored
        ? 'Backup verification failed. Your previous data was restored; try importing the backup again.'
        : 'Backup verification and rollback both failed. Export any remaining data and check browser storage before continuing.');
    }

    characters = nextCharacters;
    savedStories.splice(0, savedStories.length, ...nextStories);
    Object.keys(storyDrafts).forEach((id) => delete storyDrafts[id]);
    Object.assign(storyDrafts, nextDrafts);
    if (hasDialogueDrafts) {
      Object.keys(dialogueDrafts).forEach((id) => delete dialogueDrafts[id]);
      Object.assign(dialogueDrafts, nextDialogueDrafts);
    }
    if (hasWritingGoals) {
      writingGoals.target = nextWritingGoals.target;
      Object.keys(writingGoals.days).forEach((date) => delete writingGoals.days[date]);
      Object.assign(writingGoals.days, nextWritingGoals.days);
      renderWritingGoal();
    }
    places.splice(0, places.length, ...nextPlaces);
    worldEntries.splice(0, worldEntries.length, ...nextWorldEntries);
    if (hasBookSeries) bookSeries = nextBookSeries;
    if (hasRecentlyDeleted) recentlyDeleted = nextRecentlyDeleted;
    if (hasBundle && rawPlaceDrafts.length) {
      Object.keys(placeDrafts).forEach((id) => delete placeDrafts[id]);
      Object.assign(placeDrafts, nextPlaceDrafts);
    }
    renderCharacters();
    renderStories();
    renderSeriesLibrary();
    renderDialogueDraftList();
    renderDialogueStories(document.querySelector('#dialogue-story').value);
    renderPlaces();
    renderWorldEntries();
    renderRecentlyDeleted();
    window.FictionTalesPlanning?.reloadFromStorage();
    persistCharacterLibrary();
    showToast(`Backup imported and verified: ${importedCharacters.length} characters, ${storyResult.stories.length} stories, ${Object.keys(storyResult.drafts).length} drafts, ${importedBookSeries.length} series, ${Object.keys(importedDialogueDrafts).length} dialogue drafts, ${importedPlaces.length} places, ${importedWorldEntries.length} world entries, ${importedRecentlyDeleted.length} recently deleted items, ${hasPlanning ? 'planning data' : 'no planning data'}, and ${hasWritingGoals ? 'writing goals' : 'no writing goals'}.`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Import failed. Check that the backup is valid JSON or YAML.');
  } finally {
    input.value = '';
  }
}

document.querySelector('#export-character').addEventListener('click', () => {
  const profile = currentProfile();
  if (!profile.name) {
    showToast('Add a character name before exporting.');
    document.querySelector('#name').focus();
    return;
  }
  exportProfiles([profile], document.querySelector('#character-export-format').value);
});
document.querySelector('#settings-export').addEventListener('click', exportLibraryBackup);
document.querySelector('#settings-import').addEventListener('click', () => document.querySelector('#settings-import-file').click());
document.querySelector('#settings-import-file').addEventListener('change', importLibraryBackup);
document.querySelector('#profile-print').addEventListener('click', () => window.print());
document.querySelector('#profile-export-image').addEventListener('click', () => {
  const profile = activeProfile;
  if (!profile) {
    showToast('Open a character profile first.');
    return;
  }
  if (!profile.name) {
    showToast('Add a character name before exporting a character sheet.');
    return;
  }
  exportCharacterSheetImage(profile);
});
document.querySelector('#story-export-stories').addEventListener('click', exportStories);
document.querySelector('#story-print').addEventListener('click', () => window.print());
window.addEventListener('beforeprint', () => {
  if (!characterDialog.open || printSectionState) return;
  renderProfileGallery();
  const sections = [...document.querySelectorAll('.profile-section')];
  printSectionState = sections.map((section) => section.open);
  sections.forEach((section) => { section.open = true; });
});
window.addEventListener('afterprint', () => {
  if (!printSectionState) return;
  document.querySelectorAll('.profile-section').forEach((section, index) => {
    section.open = printSectionState[index] ?? false;
  });
  printSectionState = null;
});

function recentlyDeletedItemLabel(entry) {
  const kind = entry.kind === 'world-entry' ? 'World entry'
    : entry.kind === 'story' && entry.related.draft && !entry.related.saved ? 'Story draft'
      : entry.kind[0].toUpperCase() + entry.kind.slice(1);
  const label = entry.record.name || entry.record.title || 'Untitled';
  return `${kind} · ${label}`;
}

function renderRecentlyDeleted() {
  const list = document.querySelector('#recently-deleted-list');
  if (!list) return;
  list.replaceChildren();
  recentlyDeleted.forEach((entry) => {
    const item = document.createElement('article');
    item.className = 'recently-deleted-item';
    const info = document.createElement('div');
    info.className = 'recently-deleted-item-info';
    const title = document.createElement('strong');
    title.textContent = recentlyDeletedItemLabel(entry);
    const deletedAt = document.createElement('span');
    const timestamp = Date.parse(entry.deletedAt);
    deletedAt.textContent = Number.isFinite(timestamp) ? `Deleted ${new Date(timestamp).toLocaleString()}` : 'Recently deleted';
    info.append(title, deletedAt);
    const actions = document.createElement('div');
    actions.className = 'recently-deleted-item-actions';
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'button button-quiet';
    restore.dataset.restoreDeleted = entry.id;
    restore.textContent = 'Restore';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'button button-danger';
    remove.dataset.permanentlyDelete = entry.id;
    remove.textContent = 'Delete forever';
    actions.append(restore, remove);
    item.append(info, actions);
    list.append(item);
  });
  document.querySelector('#recently-deleted-empty').classList.toggle('hidden', recentlyDeleted.length > 0);
}

function mergeRestoredLinks(items, snapshots, property) {
  const savedById = new Map((snapshots || []).map((snapshot) => [snapshot.id, snapshot[property] || []]));
  return items.map((item) => {
    const saved = savedById.get(item.id);
    if (!saved) return item;
    const current = item[property] || [];
    const restored = [...current, ...saved.filter((id) => !current.includes(id))];
    return { ...item, [property]: restored };
  });
}

function storyLinksFromRecentlyDeleted(storyId) {
  const characterIds = recentlyDeleted.flatMap((entry) => entry.kind === 'character'
    ? [...(entry.related.stories || []), ...(entry.related.storyDrafts || [])]
      .filter((snapshot) => snapshot.id === storyId).flatMap((snapshot) => snapshot.characterIds || [])
    : []);
  const placeSnapshots = recentlyDeleted.filter((entry) => entry.kind === 'place');
  const placeIds = placeSnapshots.flatMap((entry) => [...(entry.related.stories || []), ...(entry.related.storyDrafts || [])]
    .filter((snapshot) => snapshot.id === storyId).flatMap((snapshot) => snapshot.placeIds || []));
  const chapterPlaces = placeSnapshots.flatMap((entry) => (entry.related.chapterPlaces || [])
    .filter((snapshot) => snapshot.id === storyId).flatMap((snapshot) => snapshot.chapterPlaces || []));
  return { characterIds, placeIds, chapterPlaces };
}

function addLinksToDeletedStories(trash, snapshots, property) {
  const savedById = new Map((snapshots || []).map((snapshot) => [snapshot.id, snapshot[property] || []]));
  return trash.map((entry) => {
    if (entry.kind !== 'story') return entry;
    const related = { ...entry.related };
    const restoreField = (story) => {
      if (!story || !savedById.has(story.id)) return story;
      return mergeRestoredLinks([story], [{ id: story.id, [property]: savedById.get(story.id) }], property)[0];
    };
    related.saved = restoreField(related.saved);
    related.draft = restoreField(related.draft);
    const record = restoreField(entry.record);
    return { ...entry, record, related };
  });
}

function addLinksToDeletedPlaces(trash, snapshots, property) {
  const savedById = new Map((snapshots || []).map((snapshot) => [snapshot.id, snapshot[property] || []]));
  return trash.map((entry) => {
    if (entry.kind !== 'place' || !savedById.has(entry.record.id)) return entry;
    const record = mergeRestoredLinks([entry.record], [{
      id: entry.record.id,
      [property]: savedById.get(entry.record.id),
    }], property)[0];
    return { ...entry, record };
  });
}

function placeLinksFromRecentlyDeleted(placeId) {
  return recentlyDeleted.filter((entry) => entry.kind === 'character')
    .flatMap((entry) => (entry.related.places || []).filter((snapshot) => snapshot.id === placeId)
      .flatMap((snapshot) => snapshot.characterIds || []));
}

function addChapterPlacesToDeletedStories(trash, snapshots) {
  const savedById = new Map((snapshots || []).map((snapshot) => [snapshot.id, snapshot.chapterPlaces || []]));
  return trash.map((entry) => {
    if (entry.kind !== 'story') return entry;
    const related = { ...entry.related };
    const restoreField = (story) => {
      if (!story || !savedById.has(story.id)) return story;
      return { ...story, chapterPlaces: mergeStoryChapterPlaces(story.chapterPlaces, savedById.get(story.id)) };
    };
    related.saved = restoreField(related.saved);
    related.draft = restoreField(related.draft);
    return { ...entry, record: restoreField(entry.record), related };
  });
}

function restoreRecentlyDeleted(id) {
  const entry = recentlyDeleted.find((item) => item.id === id);
  if (!entry) {
    showToast('This deleted item is no longer available.');
    renderRecentlyDeleted();
    return;
  }
  const { record, related } = entry;
  let nextTrash = recentlyDeleted.filter((item) => item.id !== id);
  let updates = [];
  const restoredLabel = recentlyDeletedItemLabel(entry);
  if (entry.kind === 'character') {
    if (characters.some((item) => item.id === record.id)) {
      showToast('A character with this ID already exists. Delete or rename that character before restoring.');
      return;
    }
    const nextCharacters = [record, ...characters.map((item) => ({ ...item }))];
    (related.characterBonds || []).forEach(({ id: characterId, bonds }) => {
      const character = nextCharacters.find((item) => item.id === characterId);
      if (!character) return;
      const currentBonds = parseBonds(character.bonds);
      const restoredBonds = bonds.filter((bond) => !currentBonds.some((item) => item.id === bond.id));
      character.bonds = serializeBonds([...currentBonds, ...restoredBonds]);
    });
    const nextStories = mergeRestoredLinks(savedStories, related.stories, 'characterIds');
    const nextDrafts = { ...storyDrafts };
    Object.assign(nextDrafts, Object.fromEntries(Object.entries(nextDrafts).map(([draftId, draft]) => [
      draftId, mergeRestoredLinks([draft], related.storyDrafts, 'characterIds')[0],
    ])));
    const nextPlaces = mergeRestoredLinks(places, related.places, 'characterIds');
    const nextSeries = mergeRestoredLinks(bookSeries, related.bookSeries, 'characterIds');
    nextTrash = addLinksToDeletedStories(nextTrash, [
      ...(related.stories || []),
      ...(related.storyDrafts || []),
    ], 'characterIds');
    nextTrash = addLinksToDeletedPlaces(nextTrash, related.places, 'characterIds');
    updates = [
      [STORAGE_KEY, nextCharacters],
      [STORIES_STORAGE_KEY, nextStories],
      [STORY_DRAFTS_KEY, nextDrafts],
      [PLACES_STORAGE_KEY, nextPlaces],
      [SERIES_STORAGE_KEY, nextSeries],
      [RECENTLY_DELETED_KEY, nextTrash],
    ];
    if (related.versions) updates.push([CHARACTER_VERSIONS_KEY, { ...characterVersions, [record.id]: related.versions }]);
    if (!commitStorageUpdates(updates)) {
      showToast('Could not restore this character. Your browser storage may be unavailable.');
      return;
    }
    characters = nextCharacters;
    savedStories.splice(0, savedStories.length, ...nextStories);
    Object.keys(storyDrafts).forEach((draftId) => delete storyDrafts[draftId]);
    Object.assign(storyDrafts, nextDrafts);
    places.splice(0, places.length, ...nextPlaces);
    bookSeries = nextSeries;
    if (related.versions) characterVersions[record.id] = related.versions;
    renderCharacters();
    renderStories();
    const dialogueDraft = currentDialogueDraft();
    renderDialogueCharacters(dialogueDraft.participantIds);
    renderDialogueStories(dialogueDraft.storyId);
    renderDialogueDraftList();
    updateDialogueSaveButton();
    renderPlaces();
    updatePreview();
  } else if (entry.kind === 'story') {
    if (savedStories.some((item) => item.id === record.id) || storyDrafts[record.id]) {
      showToast('A story with this ID already exists. Delete or rename that story before restoring.');
      return;
    }
    const savedStory = related.saved || (record.isDraft ? null : record);
    const storyDraft = related.draft || (record.isDraft ? record : null);
    const restoredLinks = storyLinksFromRecentlyDeleted(record.id);
    const restoreStoryLinks = (story) => {
      if (!story) return story;
      const withCharacters = mergeRestoredLinks([story], [{ id: story.id, characterIds: restoredLinks.characterIds }], 'characterIds')[0];
      const withPlaces = mergeRestoredLinks([withCharacters], [{ id: story.id, placeIds: restoredLinks.placeIds }], 'placeIds')[0];
      return { ...withPlaces, chapterPlaces: mergeStoryChapterPlaces(withPlaces.chapterPlaces, restoredLinks.chapterPlaces) };
    };
    const restoredSavedStory = restoreStoryLinks(savedStory);
    const restoredStoryDraft = restoreStoryLinks(storyDraft);
    const nextStories = restoredSavedStory ? [restoredSavedStory, ...savedStories] : [...savedStories];
    const nextDrafts = restoredStoryDraft ? { ...storyDrafts, [record.id]: restoredStoryDraft } : { ...storyDrafts };
    updates = [
      [STORIES_STORAGE_KEY, nextStories],
      [STORY_DRAFTS_KEY, nextDrafts],
      [RECENTLY_DELETED_KEY, nextTrash],
    ];
    if (related.versions) updates.push([STORY_VERSIONS_KEY, { ...storyVersions, [record.id]: related.versions }]);
    if (!commitStorageUpdates(updates)) {
      showToast('Could not restore this story. Your browser storage may be unavailable.');
      return;
    }
    savedStories.splice(0, savedStories.length, ...nextStories);
    Object.keys(storyDrafts).forEach((draftId) => delete storyDrafts[draftId]);
    Object.assign(storyDrafts, nextDrafts);
    if (related.versions) storyVersions[record.id] = related.versions;
    renderStories();
    renderPlaces();
  } else if (entry.kind === 'place') {
    if (places.some((item) => item.id === record.id)) {
      showToast('A place with this ID already exists. Delete or rename that place before restoring.');
      return;
    }
    const restoredPlace = {
      ...record,
      characterIds: [...new Set([...(record.characterIds || []), ...placeLinksFromRecentlyDeleted(record.id)])],
    };
    const nextPlaces = [restoredPlace, ...places];
    const nextStories = (related.stories || []).reduce((items, snapshot) => mergeRestoredLinks(items, [snapshot], 'placeIds'),
      savedStories.map((item) => ({ ...item, chapterPlaces: [...(item.chapterPlaces || [])] })));
    const nextDrafts = Object.fromEntries(Object.entries(storyDrafts)
      .map(([draftId, draft]) => [draftId, { ...draft, chapterPlaces: [...(draft.chapterPlaces || [])] }]));
    const nextSeries = mergeRestoredLinks(bookSeries, related.bookSeries, 'placeIds');
    (related.storyDrafts || []).forEach((snapshot) => {
      if (nextDrafts[snapshot.id]) nextDrafts[snapshot.id] = mergeRestoredLinks([nextDrafts[snapshot.id]], [snapshot], 'placeIds')[0];
    });
    (related.chapterPlaces || []).forEach((snapshot) => {
      const story = nextStories.find((item) => item.id === snapshot.id);
      if (story) story.chapterPlaces = mergeStoryChapterPlaces(story.chapterPlaces, snapshot.chapterPlaces);
      const draft = nextDrafts[snapshot.id];
      if (draft) draft.chapterPlaces = mergeStoryChapterPlaces(draft.chapterPlaces, snapshot.chapterPlaces);
    });
    const nextPlaceDrafts = { ...placeDrafts };
    if (related.placeDraft) nextPlaceDrafts[record.id] = related.placeDraft;
    nextTrash = addLinksToDeletedStories(nextTrash, [
      ...(related.stories || []),
      ...(related.storyDrafts || []),
    ], 'placeIds');
    nextTrash = addChapterPlacesToDeletedStories(nextTrash, related.chapterPlaces);
    updates = [
      [PLACES_STORAGE_KEY, nextPlaces],
      [STORIES_STORAGE_KEY, nextStories],
      [STORY_DRAFTS_KEY, nextDrafts],
      [PLACE_DRAFT_KEY, nextPlaceDrafts],
      [SERIES_STORAGE_KEY, nextSeries],
      [RECENTLY_DELETED_KEY, nextTrash],
    ];
    if (!commitStorageUpdates(updates)) {
      showToast('Could not restore this place. Your browser storage may be unavailable.');
      return;
    }
    places.splice(0, places.length, ...nextPlaces);
    savedStories.splice(0, savedStories.length, ...nextStories);
    Object.keys(storyDrafts).forEach((draftId) => delete storyDrafts[draftId]);
    Object.assign(storyDrafts, nextDrafts);
    Object.keys(placeDrafts).forEach((draftId) => delete placeDrafts[draftId]);
    Object.assign(placeDrafts, nextPlaceDrafts);
    bookSeries = nextSeries;
    renderStories();
    renderPlaces();
  } else {
    if (worldEntries.some((item) => item.id === record.id)) {
      showToast('A world entry with this ID already exists. Delete or rename that entry before restoring.');
      return;
    }
    const nextEntries = [record, ...worldEntries];
    updates = [[WORLD_ENTRIES_STORAGE_KEY, nextEntries], [RECENTLY_DELETED_KEY, nextTrash]];
    if (!commitStorageUpdates(updates)) {
      showToast('Could not restore this world entry. Your browser storage may be unavailable.');
      return;
    }
    worldEntries.splice(0, worldEntries.length, ...nextEntries);
    renderWorldEntries();
  }
  recentlyDeleted = nextTrash;
  renderRecentlyDeleted();
  persistCharacterLibrary();
  scheduleFolderBackup();
  syncRestoreRelatedEntities();
  showToast(`${restoredLabel} restored.`);
}

function mergeStoryChapterPlaces(current = [], restored = []) {
  const next = [...current];
  restored.forEach((entry) => {
    if (!next.some((item) => item.chapter === entry.chapter && item.placeId === entry.placeId)) next.push(entry);
  });
  return next;
}

function syncRestoreRelatedEntities() {
  renderStories();
  renderPlaces();
  renderWorldEntries();
  renderCharacters();
}

function permanentlyDeleteRecentlyDeleted(id) {
  const entry = recentlyDeleted.find((item) => item.id === id);
  if (!entry) {
    showToast('This deleted item is no longer available.');
    renderRecentlyDeleted();
    return;
  }
  pendingDeleteId = id;
  pendingDeleteKind = 'permanent-delete';
  pendingDeleteFocus = document.activeElement;
  document.querySelector('#delete-dialog-title').textContent = 'Delete forever?';
  document.querySelector('#delete-dialog-message').textContent =
    `Permanently delete ${recentlyDeletedItemLabel(entry)}? This cannot be undone.`;
  document.querySelector('#cancel-delete').textContent = 'Keep deleted item';
  document.querySelector('#confirm-delete').textContent = 'Delete forever';
  deleteDialog.showModal();
  syncModalScrollLock();
  document.querySelector('#cancel-delete').focus();
}

function requestDeleteItem(id, kind, item, returnFocus = document.activeElement) {
  pendingDeleteId = id;
  pendingDeleteKind = kind;
  pendingDeleteFocus = returnFocus;
  const isDraft = kind === 'story' && item.isDraft;
  const hasSavedVersion = kind === 'story' && savedStories.some((story) => story.id === id);
  const itemType = kind === 'character' ? 'character' : kind === 'place' ? 'place'
    : kind === 'world-entry' ? 'world entry' : isDraft && !hasSavedVersion ? 'draft' : 'story';
  document.querySelector('#delete-dialog-title').textContent =
    `Delete ${itemType}?`;
  document.querySelector('#delete-dialog-message').textContent =
    isDraft && hasSavedVersion
      ? `Delete ${item.title || 'Untitled story'}? This removes the saved story, its unsaved changes, and its version history. This cannot be undone.`
      : `Delete ${item.name || item.title || 'Untitled story'}? This cannot be undone.`;
  document.querySelector('#cancel-delete').textContent = 'Cancel';
  document.querySelector('#confirm-delete').textContent = `Delete ${itemType}`;
  deleteDialog.showModal();
  syncModalScrollLock();
  document.querySelector('#cancel-delete').focus();
}

let pendingDeleteFocus = null;

document.querySelector('#delete-character').addEventListener('click', () => {
  const profile = characters.find((character) => character.id === activeId);
  if (!profile) return;
  requestDeleteItem(profile.id, 'character', profile, document.querySelector('#delete-character'));
});
document.querySelector('#cancel-delete').addEventListener('click', () => {
  pendingDeleteId = '';
  pendingDeleteKind = '';
  deleteDialog.close();
});
deleteDialog.addEventListener('click', (event) => {
  if (event.target === deleteDialog) {
    pendingDeleteId = '';
    pendingDeleteKind = '';
    deleteDialog.close();
  }
});
deleteDialog.addEventListener('close', () => {
  pendingDeleteId = '';
  pendingDeleteKind = '';
  if (pendingDeleteFocus instanceof HTMLElement && pendingDeleteFocus.isConnected) pendingDeleteFocus.focus();
  pendingDeleteFocus = null;
});
document.querySelector('#confirm-delete').addEventListener('click', () => {
  const characterId = pendingDeleteId;
  const kind = pendingDeleteKind;
  if (!characterId || !kind) return;
  if (kind === 'discard-character') {
    pendingDeleteFocus = null;
    deleteDialog.close();
    resetForm();
    return;
  }
  if (kind === 'discard-place') {
    pendingDeleteFocus = null;
    placeHasChanges = false;
    window.clearTimeout(placeDraftTimer);
    placeDraftPending = false;
    if (placeDrafts[activePlaceId]) {
      const nextPlaceDrafts = { ...placeDrafts };
      delete nextPlaceDrafts[activePlaceId];
      if (!writeStorage(PLACE_DRAFT_KEY, nextPlaceDrafts)) {
        showToast('Could not discard this place draft. Your browser storage may be unavailable.');
        return;
      }
      delete placeDrafts[activePlaceId];
      scheduleFolderBackup();
    }
    deleteDialog.close();
    closePlaceNow();
    return;
  }
  if (kind === 'permanent-delete') {
    const deletedEntry = recentlyDeleted.find((item) => item.id === characterId);
    if (!deletedEntry) return;
    const nextTrash = recentlyDeleted.filter((entry) => entry.id !== characterId);
    const updates = [[RECENTLY_DELETED_KEY, nextTrash]];
    let nextVersions = null;
    if (deletedEntry.kind === 'character') {
      nextVersions = { ...characterVersions };
      delete nextVersions[deletedEntry.record.id];
      updates.push([CHARACTER_VERSIONS_KEY, nextVersions]);
    } else if (deletedEntry.kind === 'story') {
      nextVersions = { ...storyVersions };
      delete nextVersions[deletedEntry.record.id];
      updates.push([STORY_VERSIONS_KEY, nextVersions]);
    }
    if (!commitStorageUpdates(updates)) {
      showToast('Could not permanently delete this item. Your browser storage may be unavailable.');
      return;
    }
    recentlyDeleted = nextTrash;
    if (deletedEntry.kind === 'character') {
      Object.keys(characterVersions).forEach((versionId) => delete characterVersions[versionId]);
      Object.assign(characterVersions, nextVersions);
    } else if (deletedEntry.kind === 'story') {
      Object.keys(storyVersions).forEach((versionId) => delete storyVersions[versionId]);
      Object.assign(storyVersions, nextVersions);
    }
    renderRecentlyDeleted();
    persistCharacterLibrary();
    scheduleFolderBackup();
    deleteDialog.close();
    showToast('Item permanently deleted.');
    return;
  }
  if (kind === 'world-entry') {
    const deletedEntry = worldEntries.find((entry) => entry.id === characterId);
    if (!deletedEntry) return;
    const nextEntries = worldEntries.filter((entry) => entry.id !== characterId);
    const nextTrash = withRecentlyDeleted(createRecentlyDeletedEntry('world-entry', deletedEntry));
    if (!commitStorageUpdates([[WORLD_ENTRIES_STORAGE_KEY, nextEntries], [RECENTLY_DELETED_KEY, nextTrash]])) {
      showToast('Could not delete this world entry. Your browser storage may be unavailable.');
      return;
    }
    worldEntries.splice(0, worldEntries.length, ...nextEntries);
    recentlyDeleted = nextTrash;
    scheduleFolderBackup();
    renderWorldEntries();
    renderRecentlyDeleted();
    deleteDialog.close();
    if (activeWorldEntryId === characterId) closeWorldEntryEditor();
    showToast('World entry moved to Recently Deleted.');
    return;
  }
  if (kind === 'place') {
    const deletedPlace = places.find((place) => place.id === characterId);
    if (!deletedPlace) return;
    const nextPlaces = places.filter((place) => place.id !== characterId);
    const nextSeries = bookSeries.map((series) => (series.placeIds || []).includes(characterId)
      ? { ...series, placeIds: series.placeIds.filter((id) => id !== characterId) } : series);
    const removePlaceLink = (story) => {
      const placeIds = (story.placeIds || []).filter((id) => id !== characterId);
      const chapterPlaces = (story.chapterPlaces || []).filter((item) => item.placeId !== characterId);
      return placeIds.length === (story.placeIds || []).length && chapterPlaces.length === (story.chapterPlaces || []).length
        ? story : { ...story, placeIds, chapterPlaces };
    };
    const nextStories = savedStories.map(removePlaceLink);
    const nextStoryDrafts = { ...storyDrafts };
    Object.keys(nextStoryDrafts).forEach((id) => {
      nextStoryDrafts[id] = removePlaceLink(nextStoryDrafts[id]);
    });
    const nextPlaceDrafts = { ...placeDrafts };
    delete nextPlaceDrafts[characterId];
    const related = {
      stories: savedStories.filter((story) => (story.placeIds || []).includes(characterId))
        .map((story) => ({ id: story.id, placeIds: (story.placeIds || []).filter((id) => id === characterId) })),
      storyDrafts: Object.values(storyDrafts).filter((story) => (story.placeIds || []).includes(characterId))
        .map((story) => ({ id: story.id, placeIds: (story.placeIds || []).filter((id) => id === characterId) })),
      chapterPlaces: [
        ...savedStories,
        ...Object.values(storyDrafts),
      ].filter((story) => (story.chapterPlaces || []).some((item) => item.placeId === characterId))
        .map((story) => ({ id: story.id, chapterPlaces: (story.chapterPlaces || []).filter((item) => item.placeId === characterId) })),
      bookSeries: bookSeries.filter((series) => (series.placeIds || []).includes(characterId))
        .map((series) => ({ id: series.id, placeIds: [characterId] })),
      placeDraft: placeDrafts[characterId] || null,
    };
    const nextTrash = withRecentlyDeleted(createRecentlyDeletedEntry('place', deletedPlace, related));
    const updates = [[PLACES_STORAGE_KEY, nextPlaces]];
    if (nextStories.some((story, index) => story !== savedStories[index])) updates.push([STORIES_STORAGE_KEY, nextStories]);
    if (JSON.stringify(nextStoryDrafts) !== JSON.stringify(storyDrafts)) updates.push([STORY_DRAFTS_KEY, nextStoryDrafts]);
    if (nextSeries.some((series, index) => series !== bookSeries[index])) updates.push([SERIES_STORAGE_KEY, nextSeries]);
    if (placeDrafts[characterId]) updates.push([PLACE_DRAFT_KEY, nextPlaceDrafts]);
    updates.push([RECENTLY_DELETED_KEY, nextTrash]);
    if (!commitStorageUpdates(updates)) {
      showToast('Could not delete this place and update its links. Your browser storage may be unavailable.');
      return;
    }
    places.splice(0, places.length, ...nextPlaces);
    savedStories.splice(0, savedStories.length, ...nextStories);
    Object.keys(storyDrafts).forEach((id) => delete storyDrafts[id]);
    Object.assign(storyDrafts, nextStoryDrafts);
    bookSeries = nextSeries;
    if (placeDrafts[characterId]) {
      Object.keys(placeDrafts).forEach((id) => delete placeDrafts[id]);
      Object.assign(placeDrafts, nextPlaceDrafts);
    }
    recentlyDeleted = nextTrash;
    renderStories();
    renderPlaces();
    renderRecentlyDeleted();
    persistCharacterLibrary();
    deleteDialog.close();
    if (activePlaceId === characterId) {
      placeHasChanges = false;
      closePlaceNow();
    }
    showToast('Place moved to Recently Deleted.');
    return;
  }
  if (kind === 'story') {
    const savedStory = savedStories.find((story) => story.id === characterId) || null;
    const draft = storyDrafts[characterId] || null;
    const wasSaved = Boolean(savedStory);
    if (!savedStory && !draft) return;
    const nextStories = savedStories.filter((story) => story.id !== characterId);
    const nextDrafts = { ...storyDrafts };
    delete nextDrafts[characterId];
    const versions = storyVersions[characterId] || null;
    const nextVersions = { ...storyVersions };
    delete nextVersions[characterId];
    const nextTrash = withRecentlyDeleted(createRecentlyDeletedEntry('story', savedStory || draft, {
      saved: savedStory,
      draft,
      versions,
    }));
    if (!commitStorageUpdates([
      [STORIES_STORAGE_KEY, nextStories],
      [STORY_DRAFTS_KEY, nextDrafts],
      [STORY_VERSIONS_KEY, nextVersions],
      [RECENTLY_DELETED_KEY, nextTrash],
    ])) {
      showToast('Could not delete this story. Your browser storage may be unavailable.');
      return;
    }
    savedStories.splice(0, savedStories.length, ...nextStories);
    if (activeStoryId === characterId) cancelStoryDraftSave();
    delete storyDrafts[characterId];
    if (storyVersions[characterId]) delete storyVersions[characterId];
    if (previewStoryId === characterId) previewStoryId = '';
    recentlyDeleted = nextTrash;
    renderStories();
    renderPlaces();
    renderRecentlyDeleted();
    persistCharacterLibrary();
    deleteDialog.close();
    showToast(wasSaved ? 'Story moved to Recently Deleted.' : 'Story draft moved to Recently Deleted.');
    return;
  }
  const deletedCharacter = characters.find((character) => character.id === characterId);
  if (!deletedCharacter) return;
  const nextCharacters = characters.filter((character) => character.id !== characterId).map((character) => (
    parseBonds(character.bonds).some((bond) => bond.id === characterId)
      ? { ...character, bonds: serializeBonds(parseBonds(character.bonds).filter((bond) => bond.id !== characterId)) }
      : character
  ));
  const strip = (item) => ((item.characterIds || []).includes(characterId)
    ? { ...item, characterIds: item.characterIds.filter((id) => id !== characterId) } : item);
  const nextStories = savedStories.map(strip);
  const nextDrafts = Object.fromEntries(Object.entries(storyDrafts).map(([id, draft]) => [id, strip(draft)]));
  const nextPlaces = places.map(strip);
  const nextSeries = bookSeries.map(strip);
  const related = {
    stories: savedStories.filter((item) => (item.characterIds || []).includes(characterId))
      .map((item) => ({ id: item.id, characterIds: [characterId] })),
    storyDrafts: Object.values(storyDrafts).filter((item) => (item.characterIds || []).includes(characterId))
      .map((item) => ({ id: item.id, characterIds: [characterId] })),
    places: places.filter((item) => (item.characterIds || []).includes(characterId))
      .map((item) => ({ id: item.id, characterIds: [characterId] })),
    bookSeries: bookSeries.filter((item) => (item.characterIds || []).includes(characterId))
      .map((item) => ({ id: item.id, characterIds: [characterId] })),
    characterBonds: characters.filter((item) => item.id !== characterId)
      .map((item) => ({ id: item.id, bonds: parseBonds(item.bonds).filter((bond) => bond.id === characterId) }))
      .filter((item) => item.bonds.length),
    versions: characterVersions[characterId] || null,
  };
  const nextVersions = { ...characterVersions };
  delete nextVersions[characterId];
  const nextTrash = withRecentlyDeleted(createRecentlyDeletedEntry('character', deletedCharacter, related));
  if (!commitStorageUpdates([
    [STORAGE_KEY, nextCharacters],
    [STORIES_STORAGE_KEY, nextStories],
    [STORY_DRAFTS_KEY, nextDrafts],
    [PLACES_STORAGE_KEY, nextPlaces],
    [SERIES_STORAGE_KEY, nextSeries],
    [CHARACTER_VERSIONS_KEY, nextVersions],
    [RECENTLY_DELETED_KEY, nextTrash],
  ])) {
    showToast('Could not delete. Your browser storage may be unavailable.');
    return;
  }
  savedStories.splice(0, savedStories.length, ...nextStories);
  Object.keys(storyDrafts).forEach((id) => delete storyDrafts[id]);
  Object.assign(storyDrafts, nextDrafts);
  places.splice(0, places.length, ...nextPlaces);
  bookSeries = nextSeries;
  characters = nextCharacters;
  if (characterVersions[characterId]) delete characterVersions[characterId];
  recentlyDeleted = nextTrash;
  persistCharacterLibrary();
  renderCharacters();
  renderStories();
  renderPlaces();
  renderRecentlyDeleted();
  deleteDialog.close();
  if (activeId === characterId) resetForm();
  showToast('Character moved to Recently Deleted.');
});

document.querySelector('#search-characters').addEventListener('input', debounce(renderCharacters, 140));
['empty-create', 'character-new-button'].forEach((id) => document.getElementById(id).addEventListener('click', (event) => requestNewCharacter(event.currentTarget)));
document.querySelector('#duplicate-character').addEventListener('click', duplicateCharacter);
document.querySelector('#bond-add').addEventListener('click', addBondFromEditor);
document.querySelector('#bond-label').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addBondFromEditor();
  }
});
['#cast-sort', '#cast-group-filter'].forEach((selector) => document.querySelector(selector).addEventListener('input', renderCharacters));
document.querySelector('#gallery-url-add').addEventListener('click', addGalleryLink);
document.querySelector('#gallery-url').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addGalleryLink();
  }
});
['avatar', 'cover'].forEach((kind) => {
  document.querySelector(`#${kind}-chip .upload-chip-remove`).addEventListener('click', () => {
    const field = imageField(kind);
    field.value = '';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    syncImageChips();
    field.focus();
  });
});
document.querySelector('#story-image-url').addEventListener('change', syncStoryImageChip);
document.querySelector('#story-image-chip .upload-chip-remove').addEventListener('click', () => {
  const field = document.querySelector('#story-image-url');
  field.value = '';
  syncStoryImageChip();
  handleStoryEditorInput();
  field.focus();
});
document.querySelector('#custom-add').addEventListener('click', addBlankCustomSection);
document.querySelector('#new-place').addEventListener('click', (event) => openPlaceEditor('', event.currentTarget));
document.querySelector('#place-empty-create').addEventListener('click', (event) => openPlaceEditor('', event.currentTarget));
document.querySelector('#place-search').addEventListener('input', debounce(renderPlaces, 140));
['#place-filter-kind', '#place-sort'].forEach((selector) => document.querySelector(selector).addEventListener('input', renderPlaces));
document.querySelector('#new-world-entry').addEventListener('click', (event) => openWorldEntryEditor('', event.currentTarget));
document.querySelector('#world-entry-empty-create').addEventListener('click', (event) => openWorldEntryEditor('', event.currentTarget));
document.querySelector('#world-entry-search').addEventListener('input', debounce(renderWorldEntries, 140));
['#world-entry-filter-category', '#world-entry-sort'].forEach((selector) => {
  document.querySelector(selector).addEventListener('input', renderWorldEntries);
});
document.querySelector('#world-entry-form').addEventListener('submit', saveWorldEntry);
document.querySelector('#world-entry-close').addEventListener('click', closeWorldEntryEditor);
document.querySelector('#world-entry-cancel').addEventListener('click', closeWorldEntryEditor);
document.querySelector('#world-entry-dialog').addEventListener('click', (event) => {
  if (event.target === event.currentTarget) closeWorldEntryEditor();
});
document.querySelector('#world-entry-dialog').addEventListener('close', () => {
  activeWorldEntryId = '';
  syncModalScrollLock();
  if (worldEntryReturnFocus instanceof HTMLElement && worldEntryReturnFocus.isConnected) worldEntryReturnFocus.focus();
  worldEntryReturnFocus = null;
});
document.querySelector('#world-entry-delete').addEventListener('click', () => {
  const entry = worldEntries.find((item) => item.id === activeWorldEntryId);
  if (entry) requestDeleteItem(entry.id, 'world-entry', entry, document.querySelector('#world-entry-delete'));
});
document.querySelector('#place-form').addEventListener('input', (event) => {
  placeHasChanges = true;
  if (event.target.id === 'place-description') {
    document.querySelector('#place-description-count').textContent = String(event.target.value.length);
  }
  if (event.target.id === 'place-lore') {
    document.querySelector('#place-lore-count').textContent = `${countWords(event.target.value)} words`;
  }
  savePlaceDraft();
});
document.querySelector('#place-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (savePlaceFromForm()) closePlaceNow();
});
document.querySelector('#place-close').addEventListener('click', requestPlaceClose);
document.querySelector('#place-cancel').addEventListener('click', requestPlaceClose);
document.querySelector('#place-preview').addEventListener('click', (event) => {
  if (!document.querySelector('#place-name').value.trim()) {
    showToast('Add a place name to open its preview.');
    document.querySelector('#place-name').focus();
    return;
  }
  openEntityPreview('place', currentPlaceDraft(), event.currentTarget, true);
});
document.querySelector('#world-entry-preview').addEventListener('click', (event) => {
  const record = normalizeWorldEntry({
    id: activeWorldEntryId || createId(),
    name: document.querySelector('#world-entry-name').value,
    category: document.querySelector('#world-entry-category').value,
    summary: document.querySelector('#world-entry-summary').value,
    description: document.querySelector('#world-entry-description').value,
    details: document.querySelector('#world-entry-details').value,
    tags: document.querySelector('#world-entry-tags').value,
    updatedAt: new Date().toISOString(),
  });
  if (!record) {
    showToast('Add an entry name to open its preview.');
    document.querySelector('#world-entry-name').focus();
    return;
  }
  openEntityPreview('world', record, event.currentTarget, true);
});
document.querySelector('#entity-preview-close').addEventListener('click', closeEntityPreview);
document.querySelector('#entity-preview-print').addEventListener('click', () => window.print());
document.querySelector('#entity-preview-edit').addEventListener('click', () => {
  const current = entityPreview;
  closeEntityPreview();
  if (!current || current.fromEditor) return;
  if (current.kind === 'place') openPlaceEditor(current.id, entityPreviewReturnFocus);
  else openWorldEntryEditor(current.id, entityPreviewReturnFocus);
});
document.querySelector('#entity-preview-dialog').addEventListener('click', (event) => {
  if (event.target === event.currentTarget) closeEntityPreview();
});
document.querySelector('#entity-preview-dialog').addEventListener('close', () => {
  if (!modalDialogs.some((dialog) => dialog.open)) entityPreviewReturnFocus?.focus?.();
});
document.querySelector('#place-delete').addEventListener('click', () => {
  const place = places.find((item) => item.id === activePlaceId);
  if (place) requestDeleteItem(place.id, 'place', place, document.querySelector('#place-delete'));
});
document.querySelector('#place-image-upload-button').addEventListener('click', () => document.querySelector('#place-image-file').click());
document.querySelector('#place-image-file').addEventListener('change', handlePlaceImageUpload);
document.querySelector('#place-image-url').addEventListener('change', () => {
  syncPlaceImageChip();
  placeHasChanges = true;
  savePlaceDraft();
});
document.querySelector('#place-image-chip .upload-chip-remove').addEventListener('click', () => {
  const field = document.querySelector('#place-image-url');
  field.value = '';
  syncPlaceImageChip();
  placeHasChanges = true;
  savePlaceDraft();
  field.focus();
});
document.querySelector('#place-dialog').addEventListener('click', (event) => {
  if (event.target === event.currentTarget) requestPlaceClose();
});
document.querySelector('#place-dialog').addEventListener('cancel', (event) => {
  event.preventDefault();
  requestPlaceClose();
});
document.querySelector('#place-dialog').addEventListener('close', () => {
  if (placeCloseTimer) {
    window.clearTimeout(placeCloseTimer);
    placeCloseTimer = null;
  }
  document.querySelector('#place-dialog').classList.remove('is-closing');
  syncModalScrollLock();
  updateBackToTopVisibility();
  if (placeReturnFocus instanceof HTMLElement && placeReturnFocus.isConnected) placeReturnFocus.focus();
});
document.querySelector('#timeline-add').addEventListener('click', addTimelineEvent);
['#timeline-when', '#timeline-text'].forEach((selector) => document.querySelector(selector).addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addTimelineEvent();
  }
}));
document.querySelector('#snapshot-add').addEventListener('click', () => {
  const when = document.querySelector('#snapshot-when');
  if (!when.value.trim()) {
    showToast('Add a chapter or moment for this snapshot.');
    when.focus();
    return;
  }
  const snapshots = parseCharacterSnapshots(document.querySelector('#snapshots').value);
  if (snapshots.length >= 40) {
    showToast('A character can have up to 40 snapshots.');
    return;
  }
  snapshots.push({
    when: when.value.trim(),
    appearance: document.querySelector('#snapshot-appearance').value.trim(),
    knowledge: document.querySelector('#snapshot-knowledge').value.trim(),
    trust: document.querySelector('#snapshot-trust').value.trim(),
    location: document.querySelector('#snapshot-location').value.trim(),
    age: document.querySelector('#snapshot-age').value.trim(),
    availability: document.querySelector('#snapshot-availability').value,
  });
  when.value = '';
  document.querySelector('#snapshot-appearance').value = '';
  document.querySelector('#snapshot-knowledge').value = '';
  document.querySelector('#snapshot-trust').value = '';
  document.querySelector('#snapshot-location').value = '';
  document.querySelector('#snapshot-age').value = '';
  document.querySelector('#snapshot-availability').value = '';
  setCharacterSnapshots(snapshots, snapshots.length - 1);
});
document.querySelector('#questionnaire-add').addEventListener('click', addCharacterQuestionnaireAnswer);
document.querySelector('#questionnaire-answer').addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    addCharacterQuestionnaireAnswer();
  }
});
document.querySelector('#prompt-spark').addEventListener('click', nextCharacterPrompt);
document.querySelector('#prompt-next').addEventListener('click', nextCharacterPrompt);
document.querySelector('#prompt-use').addEventListener('click', useCharacterPrompt);

document.querySelector('#new-story').addEventListener('click', (event) => openStoryEditor('', event.currentTarget));
document.querySelector('#story-empty-create').addEventListener('click', (event) => openStoryEditor('', event.currentTarget));
document.querySelector('#story-preview-open').addEventListener('click', openStoryPreview);
document.querySelector('#story-reading-mode-open').addEventListener('click', openStoryReadingMode);
document.querySelector('#story-reader-preview').addEventListener('click', () => {
  setStoryDialogMode('preview');
  document.querySelector('#story-reading-mode-open').focus();
});
document.querySelector('#story-reader-font-down').addEventListener('click', () => {
  storyReaderFontSize = Math.max(16, storyReaderFontSize - 2);
  updateStoryReaderFontSize();
});
document.querySelector('#story-reader-font-up').addEventListener('click', () => {
  storyReaderFontSize = Math.min(32, storyReaderFontSize + 2);
  updateStoryReaderFontSize();
});
document.querySelector('#story-reading-view').addEventListener('scroll', updateStoryReaderProgress, { passive: true });
window.addEventListener('resize', updateStoryReaderProgress);
document.querySelector('#story-preview-edit').addEventListener('click', () => {
  const story = Object.values(storyDrafts).find((item) => item.id === activeStoryId)
    || savedStories.find((item) => item.id === activeStoryId);
  if (!story) return;
  openStoryEditor(story.id, storyReturnFocus || document.querySelector('#story-preview-open'));
});
document.querySelector('#story-back-to-draft').addEventListener('click', () => {
  const dialog = document.querySelector('#story-dialog');
  if (!dialog.open || !previewFromEditor) return;
  previewFromEditor = false;
  setStoryDialogMode('edit');
  updateStorySaveStatus(storyDraftPending ? 'unsaved' : 'saved');
  document.querySelector('#story-text').focus();
});
document.querySelector('#story-editor-preview').addEventListener('click', openStoryPreview);
document.querySelector('#story-form').addEventListener('input', handleStoryEditorInput);
document.querySelector('#story-chapter-summary').addEventListener('input', (event) => {
  updateStoryChapterMetadata(activeStoryChapterIndex, { summary: event.currentTarget.value });
  handleStoryEditorInput();
});
document.querySelector('#story-chapter-timeline-point').addEventListener('input', (event) => {
  updateStoryChapterMetadata(activeStoryChapterIndex, { timelinePoint: event.currentTarget.value });
  handleStoryEditorInput();
});
document.querySelector('#story-chapter-status').addEventListener('change', (event) => {
  updateStoryChapterMetadata(activeStoryChapterIndex, { status: event.currentTarget.value });
  handleStoryEditorInput();
});
document.querySelector('#story-chapter-pov').addEventListener('change', (event) => {
  updateStoryChapterMetadata(activeStoryChapterIndex, { povCharacterId: event.currentTarget.value });
  handleStoryEditorInput();
});
document.querySelector('#story-chapter-location').addEventListener('change', (event) => {
  const chapters = parseStoryChapters(document.querySelector('#story-text').value);
  const chapter = chapters[activeStoryChapterIndex];
  if (!chapter) return;
  const current = parseStoryChapterPlaces(document.querySelector('#story-chapter-places').value);
  const next = current.filter((entry) => entry.chapter.toLowerCase() !== chapter.title.toLowerCase());
  if (event.currentTarget.value) next.push({ chapter: chapter.title, placeId: event.currentTarget.value });
  document.querySelector('#story-chapter-places').value = JSON.stringify(next);
  updateStoryChapterMetadata(activeStoryChapterIndex, {});
  const linkedPlace = [...document.querySelectorAll('#story-places input')].find((input) => input.value === event.currentTarget.value);
  if (linkedPlace && event.currentTarget.value) linkedPlace.checked = true;
  handleStoryEditorInput();
});
document.querySelector('#story-daily-target').addEventListener('change', (event) => setWritingGoalTarget(Number(event.currentTarget.value)));
document.querySelector('#settings-writing-goal').addEventListener('change', (event) => setWritingGoalTarget(Number(event.currentTarget.value)));
document.querySelector('#story-focus-toggle').addEventListener('click', (event) => {
  const dialog = document.querySelector('#story-dialog');
  const active = dialog.classList.toggle('is-focus-mode');
  event.currentTarget.textContent = active ? 'Exit focus' : 'Focus mode';
  event.currentTarget.setAttribute('aria-pressed', String(active));
});
document.querySelector('#story-note-add').addEventListener('click', () => {
  const input = document.querySelector('#story-note-input');
  const noteText = input.value.trim();
  if (!noteText) {
    showToast('Write a note before adding it.');
    input.focus();
    return;
  }
  const notes = normalizeStoryNotes(document.querySelector('#story-notes-data').value);
  if (notes.length >= 100) {
    showToast('A story can have up to 100 margin notes.');
    return;
  }
  const textarea = document.querySelector('#story-text');
  const selection = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd).trim();
  const caret = textarea.selectionStart;
  const selectedChapter = document.querySelector('#story-note-chapter').value;
  const chapter = selectedChapter === '__general__' ? ''
    : selectedChapter || parseStoryChapters(textarea.value).filter((entry) => entry.start <= caret).at(-1)?.title || '';
  notes.push({ id: createId(), text: noteText, quote: selection.slice(0, 240), chapter, createdAt: new Date().toISOString() });
  document.querySelector('#story-notes-data').value = JSON.stringify(notes);
  input.value = '';
  renderStoryNotesAndTodos({ notes, todos: document.querySelector('#story-todos-data').value });
  handleStoryEditorInput();
});
document.querySelector('#story-note-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    document.querySelector('#story-note-add').click();
  }
});
document.querySelector('#story-todo-add').addEventListener('click', () => {
  const input = document.querySelector('#story-todo-input');
  const text = input.value.trim();
  if (!text) {
    showToast('Write a task before adding it.');
    input.focus();
    return;
  }
  const todos = normalizeStoryTodos(document.querySelector('#story-todos-data').value);
  if (todos.length >= 100) {
    showToast('A story can have up to 100 tasks.');
    return;
  }
  todos.push({ id: createId(), text, done: false });
  document.querySelector('#story-todos-data').value = JSON.stringify(todos);
  input.value = '';
  renderStoryNotesAndTodos({ notes: document.querySelector('#story-notes-data').value, todos });
  handleStoryEditorInput();
});
document.querySelector('#story-todo-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    document.querySelector('#story-todo-add').click();
  }
});
document.querySelector('#story-text').addEventListener('keydown', (event) => {
  const suggestions = document.querySelector('#story-mention-suggestions');
  if (suggestions.classList.contains('hidden') || !storyMentionMatches.length) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    storyMentionActiveIndex = (storyMentionActiveIndex + direction + storyMentionMatches.length) % storyMentionMatches.length;
    [...suggestions.querySelectorAll('.story-mention-option')].forEach((option, index) => {
      option.setAttribute('aria-selected', String(index === storyMentionActiveIndex));
    });
  } else if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault();
    insertStoryMention(storyMentionMatches[storyMentionActiveIndex]);
  } else if (event.key === 'Escape') {
    suggestions.classList.add('hidden');
  }
});
document.querySelector('#story-text').addEventListener('keyup', (event) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
    syncStoryChapterFromCaret();
    renderStoryMentionSuggestions();
  }
});
document.querySelector('#story-text').addEventListener('click', syncStoryChapterFromCaret);
document.querySelector('#story-peek-toggle').addEventListener('click', (event) => {
  const content = document.querySelector('#story-peek-content');
  const open = content.classList.toggle('hidden') === false;
  const panel = document.querySelector('#story-peek-panel');
  panel.classList.toggle('is-expanded', open);
  if (!open) panel.style.height = '';
  event.currentTarget.textContent = open ? 'Close' : 'Open';
  event.currentTarget.setAttribute('aria-expanded', String(open));
});
document.querySelector('.story-peek-tabs').addEventListener('click', (event) => {
  const button = event.target.closest('[data-peek-kind]');
  if (!button) return;
  storyPeekKind = button.dataset.peekKind;
  document.querySelectorAll('[data-peek-kind]').forEach((tab) => tab.classList.toggle('active', tab === button));
  renderStoryPeekList();
  document.querySelector('#story-peek-detail').textContent = `Choose a ${storyPeekKind} to see a quick reference.`;
  if (storyPeekKind === 'world-entry') document.querySelector('#story-peek-detail').textContent = 'Choose a world entry to see a quick reference.';
});
document.querySelector('#story-reading-text').addEventListener('click', (event) => {
  const mention = event.target.closest('.story-character-mention');
  if (mention) showStoryPeek('character', mention.dataset.characterId);
});
document.querySelector('#story-background-hex').addEventListener('input', (event) => {
  const color = event.currentTarget.value.trim();
  if (/^#[0-9a-f]{6}$/i.test(color)) document.querySelector('#story-background').value = color;
});
document.querySelector('#story-background').addEventListener('input', (event) => {
  document.querySelector('#story-background-hex').value = event.currentTarget.value;
});
document.querySelector('#story-image-upload-button').addEventListener('click', () => document.querySelector('#story-image-file').click());
document.querySelector('#story-image-file').addEventListener('change', handleStoryImageUpload);
document.querySelector('#story-form').addEventListener('submit', (event) => {
  event.preventDefault();
  saveCurrentStory();
});
document.querySelector('#story-close').addEventListener('click', () => document.querySelector('#story-dialog').close());
document.querySelector('#story-save-close').addEventListener('click', () => {
  if (saveCurrentStory()) document.querySelector('#story-dialog').close();
});
document.querySelector('#story-discard').addEventListener('click', discardStoryChanges);
document.querySelector('#story-format-bar').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-format]');
  if (button) applyStoryFormat(button.dataset.format);
});
document.querySelector('#story-starters').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-starter]');
  if (button) insertStoryStarter(button.dataset.starter);
});
document.querySelector('#story-template-select').addEventListener('change', (event) => {
  renderStoryTemplatePreview(event.currentTarget.value);
});
document.querySelector('#story-template-apply').addEventListener('click', applyStoryTemplate);
document.querySelector('#dialogue-new').addEventListener('click', () => startNewDialogue());
document.querySelector('#dialogue-workshop-form').addEventListener('submit', (event) => event.preventDefault());
document.querySelector('#dialogue-workshop-form').addEventListener('input', scheduleDialogueDraftSave);
document.querySelector('#dialogue-workshop-form').addEventListener('change', scheduleDialogueDraftSave);
document.querySelector('#dialogue-save-draft').addEventListener('click', () => {
  const draft = currentDialogueDraft();
  if (!draft.title) {
    showToast('Add a title to this conversation first.');
    document.querySelector('#dialogue-title').focus();
    return;
  }
  if (!draft.text.trim()) {
    showToast('Write some dialogue before saving this draft.');
    document.querySelector('#dialogue-text').focus();
    return;
  }
  saveDialogueDraft(true);
});
document.querySelector('#dialogue-add-to-story').addEventListener('click', saveDialogueToStory);
document.querySelector('#dialogue-create-story').addEventListener('click', () => document.querySelector('#new-story').click());
document.querySelector('#dialogue-draft-list').addEventListener('click', (event) => {
  const load = event.target.closest('[data-load-dialogue]');
  if (load) {
    loadDialogueDraft(load.dataset.loadDialogue);
    return;
  }
  const remove = event.target.closest('[data-delete-dialogue]');
  if (remove) deleteDialogueDraft(remove.dataset.deleteDialogue);
});
document.querySelector('#story-search').addEventListener('input', debounce(renderStories, 140));
['#story-filter-kind', '#story-filter-progress', '#story-sort'].forEach((selector) => {
  document.querySelector(selector).addEventListener('input', renderStories);
});
document.querySelector('#story-dialog').addEventListener('click', (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});
document.querySelector('#story-dialog').addEventListener('close', () => {
  document.querySelector('#story-dialog').classList.remove('is-focus-mode');
  document.querySelector('#story-focus-toggle').textContent = 'Focus mode';
  document.querySelector('#story-focus-toggle').setAttribute('aria-pressed', 'false');
  flushStoryDraft();
  renderStories();
  renderDialogueStories(document.querySelector('#dialogue-story').value);
  updateDialogueSaveButton();
  updateBackToTopVisibility();
  if (storyReturnFocus instanceof HTMLElement && storyReturnFocus.isConnected) storyReturnFocus.focus();
});
window.addEventListener('FictionTales:open-outline-scene', (event) => {
  const { storyId, chapterTitle, returnFocus } = event.detail || {};
  const title = String(chapterTitle || '').replace(/[\r\n]+/g, ' ').replace(/^\s*#+\s*/, '').trim().slice(0, 100);
  if (!storyId || !title) return;
  const story = storyDrafts[storyId] || savedStories.find((item) => item.id === storyId);
  if (!story) {
    showToast('This story is no longer available.');
    return;
  }
  openStoryEditor(storyId, returnFocus instanceof HTMLElement ? returnFocus : document.querySelector('#new-story'));
  const textarea = document.querySelector('#story-text');
  let chapter = parseStoryChapters(textarea.value).find((item) => item.title.toLowerCase() === title.toLowerCase());
  if (!chapter) {
    const separator = textarea.value.trim() ? '\n\n' : '';
    const start = textarea.value.length + separator.length;
    textarea.value += `${separator}## ${title}\n\n`;
    handleStoryEditorInput();
    chapter = parseStoryChapters(textarea.value).find((item) => item.title.toLowerCase() === title.toLowerCase());
  }
  document.querySelector('#story-chapters-panel').open = true;
  if (chapter) jumpToStoryPosition(chapter.start, chapter.headingLength);
});

function saveProjectList(nextProjects) {
  const normalized = normalizeProjects(nextProjects);
  if (!writeUnscopedStorage(PROJECTS_STORAGE_KEY, normalized)) {
    showToast('Project changes could not be saved. Check your browser storage space.');
    return false;
  }
  projects = normalized;
  renderProjectLibrary();
  return true;
}

function projectDateLabel(value, fallback = 'Not opened yet') {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

function projectStats(projectId) {
  const readProject = (key, fallback) => readUnscopedStorage(projectStorageKey(projectId, key), fallback);
  const characters = readProject(STORAGE_KEY, []);
  const stories = readProject(STORIES_STORAGE_KEY, []);
  const drafts = readProject(STORY_DRAFTS_KEY, {});
  const places = readProject(PLACES_STORAGE_KEY, []);
  const worldEntries = readProject(WORLD_ENTRIES_STORAGE_KEY, []);
  const savedIds = new Set(Array.isArray(stories) ? stories.map((story) => story.id) : []);
  const draftCount = drafts && typeof drafts === 'object'
    ? Object.values(drafts).filter((draft) => draft && !savedIds.has(draft.id)).length
    : 0;
  return {
    stories: (Array.isArray(stories) ? stories.length : 0) + draftCount,
    characters: Array.isArray(characters) ? characters.length : 0,
    places: Array.isArray(places) ? places.length : 0,
    worldEntries: Array.isArray(worldEntries) ? worldEntries.length : 0,
    coverImage: readProject(PROJECT_COVER_STORAGE_KEY, ''),
  };
}

function createProjectCard(project, archived = false) {
  const card = document.createElement('article');
  card.className = `project-card${project.id === activeProjectId ? ' is-current-project' : ''}`;
  const top = document.createElement('div');
  top.className = 'project-card-top';
  const label = document.createElement('span');
  label.className = 'project-card-type';
  label.textContent = project.id === activeProjectId ? 'CURRENT PROJECT' : 'WRITING PROJECT';
  const date = document.createElement('time');
  date.textContent = archived
    ? `Archived ${projectDateLabel(project.archivedAt)}`
    : `Opened ${projectDateLabel(project.lastOpenedAt, 'Not yet opened')}`;
  date.dateTime = archived ? project.archivedAt : project.lastOpenedAt;
  top.append(label, date);
  const title = document.createElement('h3');
  title.textContent = project.name;
  const description = document.createElement('p');
  description.className = 'project-card-description';
  description.textContent = project.description || 'A new world begins here.';
  const stats = document.createElement('p');
  stats.className = 'project-card-stats';
  const projectSummary = projectStats(project.id);
  stats.textContent = [
    `${projectSummary.stories} stories`,
    `${projectSummary.characters} characters`,
    `${projectSummary.places} places`,
    `${projectSummary.worldEntries} world entries`,
  ].join(' · ');
  const genre = document.createElement('p');
  genre.className = 'project-card-genre';
  genre.textContent = project.genre ? `Genre · ${project.genre}` : '';
  const tags = document.createElement('div');
  tags.className = 'project-card-tags';
  project.tags.forEach((value) => {
    const tag = document.createElement('span');
    tag.textContent = value;
    tags.append(tag);
  });
  const actions = document.createElement('div');
  actions.className = 'project-card-actions';
  const openButton = document.createElement('button');
  openButton.className = 'button project-card-open';
  openButton.type = 'button';
  openButton.dataset.projectAction = 'open';
  openButton.dataset.projectId = project.id;
  openButton.textContent = 'Open workspace';
  openButton.setAttribute('aria-label', `Open ${project.name} workspace`);
  const archiveButton = document.createElement('button');
  archiveButton.className = 'project-card-archive';
  archiveButton.type = 'button';
  archiveButton.dataset.projectAction = archived ? 'restore' : 'archive';
  archiveButton.dataset.projectId = project.id;
  archiveButton.textContent = archived ? 'Restore' : 'Archive';
  archiveButton.setAttribute('aria-label', `${archived ? 'Restore' : 'Archive'} ${project.name}`);
  if (archived) {
    const deleteButton = document.createElement('button');
    deleteButton.className = 'project-card-delete';
    deleteButton.type = 'button';
    deleteButton.dataset.projectAction = 'delete';
    deleteButton.dataset.projectId = project.id;
    deleteButton.textContent = 'Delete permanently';
    deleteButton.setAttribute('aria-label', `Permanently delete ${project.name}`);
    actions.append(archiveButton, deleteButton);
  } else {
    actions.append(openButton, archiveButton);
  }
  if (projectSummary.coverImage && validImageSource(projectSummary.coverImage)) {
    const cover = document.createElement('img');
    cover.className = 'project-card-cover';
    cover.alt = '';
    setImageSource(cover, projectSummary.coverImage, () => cover.classList.add('hidden'));
    card.append(cover);
  }
  card.append(top, title, description);
  if (project.genre) card.append(genre);
  card.append(stats);
  if (project.tags.length) card.append(tags);
  card.append(actions);
  return card;
}

function renderProjectCards(container, entries, archived = false) {
  container.replaceChildren(...entries.map((project) => createProjectCard(project, archived)));
}

function renderProjectLibrary() {
  const activeGrid = document.querySelector('#project-active-grid');
  if (!activeGrid) return;
  const search = document.querySelector('#project-search').value.trim().toLowerCase();
  const sortBy = document.querySelector('#project-sort').value;
  const matchesSearch = (project) => !search
    || [project.name, project.description, project.genre, ...project.tags].join(' ').toLowerCase().includes(search);
  const active = projects.filter((project) => !project.archivedAt && matchesSearch(project));
  const archived = projects.filter((project) => project.archivedAt && matchesSearch(project));
  const sortProjects = (entries) => [...entries].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    if (sortBy === 'created') return (b.createdAt || '').localeCompare(a.createdAt || '');
    if (sortBy === 'updated') return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    return (b.lastOpenedAt || '').localeCompare(a.lastOpenedAt || '');
  });
  const sortedActive = sortProjects(active);
  const recent = [...active].filter((project) => project.lastOpenedAt)
    .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt)).slice(0, 3);
  const recentGrid = document.querySelector('#project-recent-grid');
  renderProjectCards(recentGrid, recent);
  document.querySelector('#project-recent-empty').classList.toggle('hidden', recent.length > 0);
  renderProjectCards(activeGrid, sortedActive);
  document.querySelector('#project-active-count').textContent = `(${active.length})`;
  const empty = document.querySelector('#project-empty');
  empty.classList.toggle('hidden', active.length > 0);
  if (!active.length) {
    const title = empty.querySelector('h3');
    const description = empty.querySelector('p');
    title.textContent = search ? 'No matching projects.' : 'Your next story starts here.';
    description.textContent = search
      ? 'Try another search or clear the search field.'
      : 'Create a project to bring its stories, characters, places, and planning together.';
    empty.querySelector('[data-open-project-form]').classList.toggle('hidden', Boolean(search));
  }
  const archivedGrid = document.querySelector('#project-archived-grid');
  renderProjectCards(archivedGrid, sortProjects(archived), true);
  document.querySelector('#project-archived-count').textContent = String(archived.length);
  document.querySelector('#project-archive-empty').classList.toggle('hidden', archived.length > 0);
  const warning = document.querySelector('#project-library-warning');
  warning.textContent = projectInitializationError;
  warning.classList.toggle('hidden', !projectInitializationError);
  const currentProject = projects.find((project) => project.id === activeProjectId);
  document.querySelector('#active-project-label').textContent = currentProject?.name || 'YOUR PROJECT';
  document.querySelector('#project-breadcrumb-name').textContent = currentProject?.name || 'YOUR PROJECT';
  document.querySelector('#workspace-project-title').textContent = currentProject?.name || 'Your project';
  document.querySelector('#workspace-project-meta').textContent = currentProject
    ? [currentProject.genre, ...currentProject.tags].filter(Boolean).join(' · ') || 'No genre or tags set yet'
    : '';
}

function toggleProjectCreateForm(isOpen) {
  const panel = document.querySelector('#project-create-panel');
  panel.classList.toggle('hidden', !isOpen);
  document.querySelector('#project-create-open').setAttribute('aria-expanded', String(isOpen));
  if (isOpen) document.querySelector('#project-name').focus();
}

function openProjectLibrary() {
  flushPendingDrafts();
  if (location.hash !== '#projects') window.history.pushState(null, '', '#projects');
  document.body.classList.remove('workspace-active');
  document.body.classList.add('project-library-active');
  document.querySelector('.project-library-page').scrollTo({ top: 0 });
  window.scrollTo({ top: 0, behavior: getMotionScrollBehavior() });
  setMobileNavigationOpen(false);
  renderProjectLibrary();
}

function openLandingPage() {
  flushPendingDrafts();
  if (location.hash !== '#landing-page') window.history.pushState(null, '', '#landing-page');
  document.body.classList.remove('workspace-active', 'project-library-active');
  window.scrollTo({ top: 0, behavior: getMotionScrollBehavior() });
}

function openProjectOverviewOnEntry() {
  if (location.hash !== '#studio') return;
  requestAnimationFrame(() => {
    const overview = document.querySelector('#project-dashboard');
    const previousScrollBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    overview.scrollIntoView({ behavior: 'auto', block: 'start' });
    document.documentElement.style.scrollBehavior = previousScrollBehavior;
    setActiveNavigation(overview.id);
  });
}

function openProject(projectId) {
  const project = projects.find((entry) => entry.id === projectId && !entry.archivedAt);
  if (!project) {
    showToast('This project is unavailable. Restore it from Archived projects to continue.');
    return;
  }
  const now = new Date().toISOString();
  const nextProjects = projects.map((entry) => entry.id === project.id
    ? { ...entry, lastOpenedAt: now }
    : entry);
  if (!writeUnscopedStorage(PROJECTS_STORAGE_KEY, nextProjects)) {
    showToast('This project could not be opened because its activity could not be saved.');
    return;
  }
  if (!writeUnscopedStorage(ACTIVE_PROJECT_STORAGE_KEY, project.id)) {
    showToast('This project could not be opened. Check your browser storage space.');
    return;
  }
  projects = nextProjects;
  activeProjectId = project.id;
  projectNavigationPending = true;
  window.history.pushState(null, '', '#studio');
  window.location.reload();
}

function updateProjectArchive(projectId, archived) {
  const now = new Date().toISOString();
  const nextProjects = projects.map((project) => project.id === projectId
    ? { ...project, archivedAt: archived ? now : '', updatedAt: now }
    : project);
  if (!saveProjectList(nextProjects)) return;
  showToast(archived ? 'Project moved to Archived projects.' : 'Project restored to your library.');
}

function requestProjectDelete(projectId, returnFocus = document.activeElement) {
  const project = projects.find((entry) => entry.id === projectId && entry.archivedAt);
  if (!project) {
    showToast('Only archived projects can be permanently deleted.');
    return;
  }
  pendingProjectDeleteId = project.id;
  pendingProjectDeleteFocus = returnFocus;
  document.querySelector('#project-delete-title').textContent = `Delete "${project.name}" permanently?`;
  document.querySelector('#project-delete-message').textContent =
    'This permanently removes the project and all of its stories, characters, places, plans, and saved history from this browser. This cannot be undone.';
  document.querySelector('#project-delete-name').textContent = project.name;
  const nameInput = document.querySelector('#project-delete-name-input');
  nameInput.value = '';
  nameInput.dataset.projectName = project.name;
  document.querySelector('#confirm-project-delete').disabled = true;
  projectDeleteDialog.showModal();
  syncModalScrollLock();
  nameInput.focus();
}

async function restoreArchivedProjectData(snapshots) {
  for (const [key, value] of snapshots) {
    if (value !== undefined && !writeUnscopedStorage(key, value)) {
      throw new Error(`Could not restore project data for "${key}" after a failed deletion.`);
    }
  }
  await projectStorage.flush();
  for (const [key, value] of snapshots) {
    if (!await projectStorage.verify(key, value)) {
      throw new Error(`Could not verify restored project data for "${key}".`);
    }
  }
}

async function removeArchivedProjectData(projectId) {
  const projectKeys = [...PROJECT_DATA_STORAGE_KEYS].map((key) => projectStorageKey(projectId, key));
  await projectStorage.flush();
  const snapshots = projectKeys.map((key) => [key, readUnscopedStorage(key, undefined)]);
  let removed = true;
  for (const key of projectKeys) {
    if (!removeUnscopedStorage(key)) {
      removed = false;
      break;
    }
  }
  await projectStorage.flush();
  for (const key of projectKeys) {
    if (!await projectStorage.verify(key, undefined)) removed = false;
  }
  if (!removed) {
    await restoreArchivedProjectData(snapshots);
    return null;
  }
  return snapshots;
}

document.querySelector('#project-delete-name-input').addEventListener('input', (event) => {
  const input = event.currentTarget;
  document.querySelector('#confirm-project-delete').disabled =
    input.value.trim() !== input.dataset.projectName;
});
document.querySelector('#cancel-project-delete').addEventListener('click', () => projectDeleteDialog.close());
projectDeleteDialog.addEventListener('click', (event) => {
  if (event.target === projectDeleteDialog) projectDeleteDialog.close();
});
projectDeleteDialog.addEventListener('close', () => {
  pendingProjectDeleteId = '';
  if (pendingProjectDeleteFocus instanceof HTMLElement && pendingProjectDeleteFocus.isConnected) {
    pendingProjectDeleteFocus.focus();
  }
  pendingProjectDeleteFocus = null;
});
document.querySelector('#confirm-project-delete').addEventListener('click', async (event) => {
  const projectId = pendingProjectDeleteId;
  const project = projects.find((entry) => entry.id === projectId && entry.archivedAt);
  if (!project) {
    showToast('This archived project is no longer available.');
    projectDeleteDialog.close();
    return;
  }
  const confirmButton = event.currentTarget;
  confirmButton.disabled = true;
  confirmButton.textContent = 'Deleting…';
  try {
    const projectDataSnapshots = await removeArchivedProjectData(projectId);
    if (!projectDataSnapshots) {
      showToast('Some project data could not be removed. The archived project remains listed; check browser storage and try again.');
      return;
    }
    if (!saveProjectList(projects.filter((entry) => entry.id !== projectId))) {
      await restoreArchivedProjectData(projectDataSnapshots);
      return;
    }
    if (activeProjectId === projectId) {
      activeProjectId = '';
      if (!writeUnscopedStorage(ACTIVE_PROJECT_STORAGE_KEY, '')) {
        console.error('The archived project was deleted, but its active-project marker could not be cleared.');
      }
      renderProjectLibrary();
    }
    pendingProjectDeleteFocus = null;
    projectDeleteDialog.close();
    showToast('Project permanently deleted.');
  } catch (error) {
    console.error('Fiction Tale could not permanently delete the archived project.', error);
    showToast('The project could not be permanently deleted. Check browser storage and try again.');
  } finally {
    confirmButton.textContent = 'Delete permanently';
    confirmButton.disabled = document.querySelector('#project-delete-name-input').value.trim()
      !== document.querySelector('#project-delete-name-input').dataset.projectName;
  }
});

function syncEntryRoute() {
  const route = location.hash.slice(1);
  if (route === 'studio' && activeProjectId
    && projects.some((project) => project.id === activeProjectId && !project.archivedAt)) {
    document.body.classList.add('workspace-active');
    document.body.classList.remove('project-library-active');
  } else if (route === 'projects' || route === 'studio') {
    document.body.classList.remove('workspace-active');
    document.body.classList.add('project-library-active');
    if (route === 'studio') window.history.replaceState(null, '', '#projects');
    renderProjectLibrary();
  } else {
    document.body.classList.remove('workspace-active', 'project-library-active');
  }
}

const navLinks = [...document.querySelectorAll('.nav-link[href], .nav-sublink[href], .project-navigation-link[href]')];
const mainContent = document.querySelector('.main-content');
let sectionInsertionPoint = document.querySelector('.project-workspace-header');
const navSections = [...document.querySelectorAll('#main-navigation a[href]')]
  .map((link) => document.querySelector(link.getAttribute('href')))
  .filter((section) => section?.parentElement === mainContent);
navSections.forEach((section) => {
  sectionInsertionPoint.after(section);
  sectionInsertionPoint = section;
});
const sidebar = document.querySelector('.sidebar');
const mobileNavigationToggle = document.querySelector('#mobile-nav-toggle');
const settingsDialog = document.querySelector('#settings-dialog');
let scrollSpyFrame = 0;
let pendingNavigationTarget = '';
let navigationFallbackTimer = 0;

document.querySelectorAll('[data-open-workspace]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    openProjectLibrary();
  });
});

document.querySelectorAll('.workspace-home-link, .landing-footer-brand, [data-go-home]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    openLandingPage();
  });
});

document.querySelectorAll('[data-open-project-library]').forEach((button) => {
  button.addEventListener('click', openProjectLibrary);
});

document.querySelector('#project-create-open').addEventListener('click', () => toggleProjectCreateForm(true));
document.querySelector('#project-create-close').addEventListener('click', () => toggleProjectCreateForm(false));
document.querySelector('#project-create-cancel').addEventListener('click', () => toggleProjectCreateForm(false));
document.querySelector('[data-open-project-form]').addEventListener('click', () => toggleProjectCreateForm(true));
document.querySelector('#project-search').addEventListener('input', renderProjectLibrary);
document.querySelector('#project-sort').addEventListener('change', renderProjectLibrary);
document.querySelector('#project-create-panel').addEventListener('submit', (event) => {
  event.preventDefault();
  const nameInput = document.querySelector('#project-name');
  const name = nameInput.value.trim();
  if (!name) {
    showToast('Add a project name first.');
    nameInput.focus();
    return;
  }
  if (projects.some((project) => project.name.toLowerCase() === name.toLowerCase())) {
    showToast('A project with that name already exists. Choose a different name.');
    nameInput.focus();
    return;
  }
  const now = new Date().toISOString();
  const tags = [...new Set(document.querySelector('#project-tags').value.split(',')
    .map((tag) => tag.trim().slice(0, 24)).filter(Boolean))].slice(0, 12);
  const project = {
    id: globalThis.crypto?.randomUUID?.() || `project-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    description: document.querySelector('#project-description').value.trim(),
    genre: document.querySelector('#project-genre').value.trim().slice(0, 60),
    tags,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    archivedAt: '',
  };
  if (!saveProjectList([...projects, project])) return;
  if (!writeUnscopedStorage(ACTIVE_PROJECT_STORAGE_KEY, project.id)) {
    showToast('The project was created but could not be opened. You can try opening it from the library.');
    return;
  }
  activeProjectId = project.id;
  projectNavigationPending = true;
  window.history.pushState(null, '', '#studio');
  window.location.reload();
});
document.querySelector('.project-library-main').addEventListener('click', (event) => {
  const button = event.target.closest('[data-project-action]');
  if (!button) return;
  if (button.dataset.projectAction === 'open') openProject(button.dataset.projectId);
  else if (button.dataset.projectAction === 'archive') updateProjectArchive(button.dataset.projectId, true);
  else if (button.dataset.projectAction === 'restore') updateProjectArchive(button.dataset.projectId, false);
  else if (button.dataset.projectAction === 'delete') requestProjectDelete(button.dataset.projectId, button);
});
window.addEventListener('popstate', syncEntryRoute);
renderProjectLibrary();
renderProjectDashboard();

function setMobileNavigationOpen(isOpen) {
  sidebar.classList.toggle('is-open', isOpen);
  mobileNavigationToggle.setAttribute('aria-expanded', String(isOpen));
}

mobileNavigationToggle.addEventListener('click', () => {
  setMobileNavigationOpen(mobileNavigationToggle.getAttribute('aria-expanded') !== 'true');
});

function openSettings(focusStorage = false) {
  setMobileNavigationOpen(false);
  document.querySelector('#settings-writing-goal').value = String(writingGoals.target);
  renderRecentlyDeleted();
  updateStorageMeter();
  renderBackupInformation();
  settingsDialog.showModal();
  if (focusStorage) {
    requestAnimationFrame(() => document.querySelector('#settings-data-heading').scrollIntoView({ block: 'start' }));
  }
}

document.querySelector('#settings-open').addEventListener('click', () => openSettings());
document.querySelector('#workspace-storage-status').addEventListener('click', () => openSettings(true));
document.querySelector('#project-dashboard-story').addEventListener('change', renderProjectDashboard);
document.querySelector('#project-dashboard-word-goal').addEventListener('change', saveProjectWordGoal);
document.querySelector('#project-overview-edit').addEventListener('click', openProjectOverviewForm);
document.querySelector('#project-overview-cancel').addEventListener('click', () => {
  document.querySelector('#project-overview-form').classList.add('hidden');
  document.querySelector('#project-overview-edit').classList.remove('hidden');
});
document.querySelector('#project-overview-cover-input').addEventListener('input', previewProjectOverviewCover);
document.querySelector('#project-overview-upload').addEventListener('click', () => {
  document.querySelector('#project-overview-cover-file').click();
});
document.querySelector('#project-overview-cover-file').addEventListener('change', async (event) => {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/') || file.size > MAX_IMAGE_UPLOAD_BYTES) {
    showToast('Choose a valid image that is 5 MB or smaller.');
    input.value = '';
    return;
  }
  try {
    document.querySelector('#project-overview-cover-input').value = await resizeStoryImage(file, 1200, 0.78);
    previewProjectOverviewCover();
  } catch (error) {
    console.error('Fiction Tale could not read the project cover image.', error);
    showToast('Could not read that image. Try another file or paste an image link.');
  } finally {
    input.value = '';
  }
});
document.querySelector('#project-overview-remove-cover').addEventListener('click', () => {
  document.querySelector('#project-overview-cover-input').value = '';
  previewProjectOverviewCover();
});
document.querySelector('#project-overview-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const currentProject = projects.find((project) => project.id === activeProjectId);
  const nameInput = document.querySelector('#project-overview-name-input');
  const name = nameInput.value.trim();
  if (!currentProject || !name) {
    showToast('Add a project title before saving.');
    nameInput.focus();
    return;
  }
  if (projects.some((project) => project.id !== activeProjectId && project.name.toLowerCase() === name.toLowerCase())) {
    showToast('A project with that title already exists. Choose a different title.');
    nameInput.focus();
    return;
  }
  const coverImage = document.querySelector('#project-overview-cover-input').value.trim();
  if (coverImage && (coverImage.length > MAX_IMAGE_DATA_URL_LENGTH || !validImageSource(coverImage))) {
    showToast('Use a direct http(s) image link or upload a valid cover image.');
    document.querySelector('#project-overview-cover-input').focus();
    return;
  }
  const previousCover = projectStorage.read(PROJECT_COVER_STORAGE_KEY, '');
  if (coverImage !== previousCover) {
    const coverSaved = coverImage
      ? writeStorage(PROJECT_COVER_STORAGE_KEY, coverImage)
      : !previousCover || removeStorage(PROJECT_COVER_STORAGE_KEY);
    if (!coverSaved) {
      showToast('The project cover could not be saved. Check your browser storage space.');
      return;
    }
  }
  const now = new Date().toISOString();
  const tags = [...new Set(document.querySelector('#project-overview-tags-input').value.split(',')
    .map((tag) => tag.trim().slice(0, 24)).filter(Boolean))].slice(0, 12);
  const nextProjects = projects.map((project) => project.id === activeProjectId ? {
    ...project,
    name,
    description: document.querySelector('#project-overview-description-input').value.trim(),
    genre: document.querySelector('#project-overview-genre-input').value.trim().slice(0, 60),
    tags,
    updatedAt: now,
  } : project);
  if (!saveProjectList(nextProjects)) {
    if (coverImage !== previousCover) {
      const restored = previousCover
        ? writeStorage(PROJECT_COVER_STORAGE_KEY, previousCover)
        : removeStorage(PROJECT_COVER_STORAGE_KEY);
      if (!restored) showToast('Project details were not saved, and the previous cover could not be restored.');
      renderProjectLibrary();
    }
    return;
  }
  document.querySelector('#project-overview-form').classList.add('hidden');
  document.querySelector('#project-overview-edit').classList.remove('hidden');
  renderProjectOverview();
  renderProjectLibrary();
  showToast('Project overview saved.');
});
document.querySelector('#project-dashboard-open-story').addEventListener('click', (event) => {
  const storyId = document.querySelector('#project-dashboard-story').value;
  if (storyId) openStoryEditor(storyId, event.currentTarget);
});
document.querySelector('#project-dashboard-create-story').addEventListener('click', (event) => {
  openStoryEditor('', event.currentTarget);
});
document.querySelector('#project-workflow-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-story-workflow-step]');
  if (!button) return;
  const storyId = document.querySelector('#project-dashboard-story').value;
  const story = getProjectDashboardStories().find((item) => item.id === storyId);
  if (story) openStoryWorkflowStep(story, button.dataset.storyWorkflowStep, button);
});
document.querySelector('#project-dashboard-tasks').addEventListener('click', (event) => {
  const button = event.target.closest('[data-project-story-id]');
  if (button) openStoryEditor(button.dataset.projectStoryId, button);
});
window.addEventListener('FictionTales:story-draft-updated', () => {
  renderSeriesLibrary();
  renderProjectDashboard();
});
document.querySelector('#series-create').addEventListener('click', () => openSeriesEditor());
document.querySelector('#series-empty-create').addEventListener('click', () => openSeriesEditor());
document.querySelector('#series-editor').addEventListener('submit', saveBookSeries);
document.querySelector('#series-editor-close').addEventListener('click', () => document.querySelector('#series-editor').classList.add('hidden'));
document.querySelector('#series-cancel').addEventListener('click', () => document.querySelector('#series-editor').classList.add('hidden'));
document.querySelector('#series-record-select').addEventListener('change', (event) => {
  document.querySelector('#series-edit-selected').disabled = !event.currentTarget.value;
});
document.querySelector('#series-edit-selected').addEventListener('click', () => {
  openSeriesEditor(document.querySelector('#series-record-select').value);
});
document.querySelector('#series-library').addEventListener('click', (event) => {
  const edit = event.target.closest('[data-edit-series]');
  if (edit) {
    document.querySelector('#series-record-select').value = edit.dataset.editSeries;
    document.querySelector('#series-edit-selected').disabled = false;
    openSeriesEditor(edit.dataset.editSeries);
    return;
  }
  const openBook = event.target.closest('[data-open-series-book]');
  if (openBook) openStoryEditor(openBook.dataset.openSeriesBook, openBook);
});
document.querySelector('#series-event-add').addEventListener('click', () => {
  const titleInput = document.querySelector('#series-event-title');
  const title = titleInput.value.trim();
  if (!title) {
    showToast('Add an event name first.');
    titleInput.focus();
    return;
  }
  editingSeriesEvents.push({
    id: createId(),
    title,
    bookId: document.querySelector('#series-event-book').value,
    chapter: document.querySelector('#series-event-chapter').value.trim(),
    description: document.querySelector('#series-event-description').value.trim(),
  });
  titleInput.value = '';
  document.querySelector('#series-event-chapter').value = '';
  document.querySelector('#series-event-description').value = '';
  renderSeriesEventEditor();
  titleInput.focus();
});
document.querySelector('#series-events-list').addEventListener('click', (event) => {
  const remove = event.target.closest('[data-remove-series-event]');
  if (!remove) return;
  editingSeriesEvents = editingSeriesEvents.filter((item) => item.id !== remove.dataset.removeSeriesEvent);
  renderSeriesEventEditor();
});
document.querySelector('#series-delete').addEventListener('click', deleteBookSeries);
document.querySelector('#story-series').addEventListener('change', (event) => {
  const seriesId = event.currentTarget.value;
  document.querySelector('#story-series-order').disabled = !seriesId;
  if (seriesId) document.querySelector('#story-series-order').value = String(getNextSeriesBookOrder(seriesId, activeStoryId));
  handleStoryEditorInput();
});
document.querySelector('#story-series-order').addEventListener('change', (event) => {
  const seriesId = document.querySelector('#story-series').value;
  const order = Number(event.currentTarget.value);
  const duplicate = seriesId && getSeriesBooks(seriesId).some((book) =>
    book.id !== activeStoryId && book.seriesOrder === order);
  if (duplicate) {
    const nextOrder = getNextSeriesBookOrder(seriesId, activeStoryId);
    event.currentTarget.value = String(nextOrder);
    showToast(`Book ${order} is already in this series. The next open number is ${nextOrder}.`);
  }
  handleStoryEditorInput();
});
document.querySelector('#recently-deleted-list').addEventListener('click', (event) => {
  const restore = event.target.closest('[data-restore-deleted]');
  if (restore) {
    restoreRecentlyDeleted(restore.dataset.restoreDeleted);
    return;
  }
  const remove = event.target.closest('[data-permanently-delete]');
  if (remove) permanentlyDeleteRecentlyDeleted(remove.dataset.permanentlyDelete);
});
document.querySelector('.settings-about-options').addEventListener('click', (event) => {
  const selected = event.target.closest('[data-about-placeholder]');
  if (!selected) return;
  const isExpanded = selected.getAttribute('aria-expanded') === 'true';
  document.querySelectorAll('.settings-about-options [data-about-placeholder]').forEach((button) => {
    button.setAttribute('aria-expanded', String(button === selected && !isExpanded));
  });
  document.querySelectorAll('.settings-about-content > p').forEach((content) => {
    content.classList.toggle('hidden', isExpanded || content.id !== selected.getAttribute('aria-controls'));
  });
});
document.querySelector('#settings-close').addEventListener('click', () => settingsDialog.close());
settingsDialog.addEventListener('click', (event) => {
  if (event.target === settingsDialog) settingsDialog.close();
});
settingsDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  settingsDialog.close();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && settingsDialog.open) {
    settingsDialog.close();
    return;
  }
  if (event.key === 'Escape' && mobileNavigationToggle.getAttribute('aria-expanded') === 'true') {
    setMobileNavigationOpen(false);
    mobileNavigationToggle.focus();
  }
});

document.addEventListener('click', (event) => {
  if (mobileNavigationToggle.getAttribute('aria-expanded') === 'true' && !sidebar.contains(event.target)) {
    setMobileNavigationOpen(false);
  }
});

function setActiveNavigation(sectionId) {
  const mainNavigationSectionId = sectionId === 'cast' ? 'characters' : sectionId;
  navLinks.forEach((link) => {
    const isActive = link.getAttribute('href') === `#${sectionId}`
      || (link.getAttribute('href') === `#${mainNavigationSectionId}`
        && !(sectionId === 'cast' && link.classList.contains('nav-sublink')));
    link.classList.toggle('active', isActive);
    if (isActive) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
  document.querySelectorAll('.nav-group').forEach((group) => {
    const hasActiveLink = Boolean(group.querySelector('.nav-sublink.active'));
    group.open = hasActiveLink;
    group.querySelector('summary').classList.toggle('active', hasActiveLink);
  });
}

function syncNavigationToScroll() {
  scrollSpyFrame = 0;
  const isBottomNavigation = window.matchMedia('(max-width: 780px)').matches;
  if (!isBottomNavigation && pendingNavigationTarget) return;
  const navigation = document.querySelector('.sidebar');
  const navigationTop = navigation?.getBoundingClientRect().top || 0;
  const topbarBottom = document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0;
  const sectionThreshold = isBottomNavigation
    ? Math.min(window.innerHeight * 0.45, navigationTop - 24)
    : Math.max(topbarBottom + Math.min(120, window.innerHeight * 0.2), window.innerHeight * 0.4);
  const activeSection = navSections.filter((section) => section.getBoundingClientRect().top <= sectionThreshold).at(-1);
  setActiveNavigation(activeSection?.id || 'project-dashboard');
}

function scheduleNavigationSync() {
  if (scrollSpyFrame) return;
  scrollSpyFrame = window.requestAnimationFrame(syncNavigationToScroll);
}

function finishNavigationScroll() {
  if (!pendingNavigationTarget) return;
  pendingNavigationTarget = '';
  window.clearTimeout(navigationFallbackTimer);
  navigationFallbackTimer = 0;
  scheduleNavigationSync();
}

navLinks.forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault();
  const target = document.querySelector(link.getAttribute('href'));
  if (!target) return;
  if (target.id === 'dialogue-workshop') {
    flushDialogueDraft();
    const current = currentDialogueDraft();
    renderDialogueCharacters(current.participantIds);
    renderDialogueStories(current.storyId);
    renderDialogueDraftList();
    updateDialogueSaveButton();
  } else if (target.id === 'project-dashboard') {
    renderProjectDashboard();
  }
  setMobileNavigationOpen(false);
  pendingNavigationTarget = window.matchMedia('(min-width: 781px)').matches ? target.id : '';
  window.clearTimeout(navigationFallbackTimer);
  if (pendingNavigationTarget) {
    navigationFallbackTimer = window.setTimeout(finishNavigationScroll, getMotionDelay(1400));
  }
  setActiveNavigation(target.id);
  target.scrollIntoView({ behavior: getMotionScrollBehavior(), block: 'start' });
}));
window.addEventListener('scroll', scheduleNavigationSync, { passive: true });
window.addEventListener('scrollend', finishNavigationScroll);
window.addEventListener('wheel', () => {
  if (pendingNavigationTarget) finishNavigationScroll();
}, { passive: true });
window.addEventListener('resize', () => {
  if (!window.matchMedia('(min-width: 781px)').matches) finishNavigationScroll();
  scheduleNavigationSync();
});
syncNavigationToScroll();

const savedDraft = readStorage(DRAFT_KEY, null);
if (savedDraft) {
  characterFormHasChanges = true;
  Object.entries({
    name: savedDraft.name, role: savedDraft.role, pronouns: savedDraft.pronouns, age: savedDraft.age,
    species: savedDraft.species, description: savedDraft.description, traits: traitsValue(savedDraft.traits),
    avatar: savedDraft.avatar, cover: savedDraft.cover, accent: savedDraft.accent, story: savedDraft.story,
    gallery: savedDraft.gallery, relations: savedDraft.relations, links: savedDraft.links,
    worlds: savedDraft.worlds, stats: savedDraft.stats, groups: traitsValue(savedDraft.groups), 'character-tags': traitsValue(savedDraft.tags),
    goal: savedDraft.goal, fear: savedDraft.fear, secret: savedDraft.secret, flaw: savedDraft.flaw,
    voice: savedDraft.voice, 'voice-samples': savedDraft.voiceSamples, appearance: savedDraft.appearance,
    questionnaire: savedDraft.questionnaire, bonds: savedDraft.bonds, timeline: savedDraft.timeline, customSections: savedDraft.customSections,
    'arc-start': savedDraft.arcStart, 'arc-turning-point': savedDraft.arcTurningPoint, 'arc-end': savedDraft.arcEnd, snapshots: savedDraft.snapshots,
  }).forEach(([id, value]) => { document.getElementById(id).value = value || ''; });
  imageCropState = {
    avatar: normalizeImageCrop(savedDraft.avatarCrop),
    cover: normalizeImageCrop(savedDraft.coverCrop),
  };
  document.querySelector('#accent-hex').value = document.querySelector('#accent').value;
  document.querySelector('#autosave-status').textContent = 'Draft restored';
  if (savedDraft.id && characters.some((character) => character.id === savedDraft.id)) {
    activeId = savedDraft.id;
    document.querySelector('#character-id').value = savedDraft.id;
    document.querySelector('#save-label').textContent = 'Update character';
    syncCharacterActions(true);
  }
}
renderTimelineEditor();
renderCharacterSnapshotsEditor();
renderCharacterQuestionnaireEditor();
rememberImageSources();
initUiPrefs();
initGlobalSearch();
initPwa();
renderCharacters();
renderStories();
renderDialogueCharacters();
renderDialogueStories();
renderDialogueDraftList();
updateDialogueSaveButton();
renderPlaces();
renderWorldEntries();
renderRecentlyDeleted();
renderBackupInformation();
updateStorageMeter();
openProjectOverviewOnEntry();
window.addEventListener('fictiontale-storage-updated', updateStorageMeterSoon);
window.addEventListener('storage', updateStorageMeterSoon);
updatePreview();
initializeDataFolder();
if (!window.FictionTaleStorage.isAvailable()) {
  showToast('IndexedDB is unavailable. Large saves may be limited by browser storage.');
}
