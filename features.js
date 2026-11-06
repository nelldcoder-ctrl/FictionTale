(() => {
  const STORAGE_KEY = 'FictionTales.planning.v1';
  const maxRecords = 500;
  const state = { data: loadData(), prompt: '' };
  const conflictPrompts = [
    'A long-buried secret surfaces just before an important promise is made.',
    'Someone arrives with a warning that sounds impossible—but knows too much.',
    'An unexpected ally asks for help with a problem that should not exist.',
    'A small misunderstanding puts two people on opposite sides of a bigger choice.',
    'Something precious disappears, and the only clue points to the wrong person.',
    'A familiar place changes overnight, revealing a path no one remembers.',
    'A celebration is interrupted by news that changes what everyone thought they knew.',
    'One character must choose between keeping a promise and protecting a friend.',
  ];

  function makeId() {
    return globalThis.crypto?.randomUUID?.() || `planning-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function text(value, maxLength) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
  }

  function normalizeList(value, normalizeItem) {
    return Array.isArray(value) ? value.slice(0, maxRecords).map(normalizeItem).filter(Boolean) : [];
  }

  function normalizeData(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
      events: normalizeList(source.events, (item) => {
        if (!item || typeof item !== 'object') return null;
        const title = text(item.title, 180);
        if (!title) return null;
        return {
          id: text(item.id, 100) || makeId(),
          title,
          date: text(item.date, 40),
          characterId: text(item.characterId, 100),
          storyId: text(item.storyId, 100),
          knowledge: text(item.knowledge, 600),
          createdAt: text(item.createdAt, 40) || new Date().toISOString(),
        };
      }),
      moodboards: normalizeList(source.moodboards, (item) => {
        if (!item || typeof item !== 'object') return null;
        const scope = ['character', 'story', 'place'].includes(item.scope) ? item.scope : '';
        const entityId = text(item.entityId, 100);
        if (!scope || !entityId) return null;
        const color = /^#[\da-f]{6}$/i.test(item.color) ? item.color : '#7193ad';
        return {
          id: text(item.id, 100) || makeId(),
          scope,
          entityId,
          image: text(item.image, 1000),
          tags: text(item.tags, 120),
          quote: text(item.quote, 400),
          color,
          createdAt: text(item.createdAt, 40) || new Date().toISOString(),
        };
      }),
      outline: normalizeList(source.outline, (item) => {
        if (!item || typeof item !== 'object') return null;
        const title = text(item.title, 100);
        if (!title) return null;
        return {
          id: text(item.id, 100) || makeId(),
          storyId: text(item.storyId, 100),
          act: [1, 2, 3].includes(Number(item.act)) ? Number(item.act) : 1,
          title,
          summary: text(item.summary, 300),
          chapter: text(item.chapter, 100),
          createdAt: text(item.createdAt, 40) || new Date().toISOString(),
        };
      }),
    };
  }

  function loadData() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return normalizeData(stored);
    } catch (error) {
      console.error('Could not read story planning data.', error);
      return normalizeData(null);
    }
  }

  function saveData(next) {
    const normalized = normalizeData(next);
    if (!window.FictionTalesData.writeStorage(STORAGE_KEY, normalized)) {
      window.FictionTalesData.showToast('Planning changes could not be saved. Export a backup or free browser storage space.');
      return false;
    }
    state.data = normalized;
    window.FictionTalesData.scheduleFolderBackup();
    renderAll();
    return true;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
  }

  function safeImageUrl(value) {
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function getEntity(scope, id) {
    if (scope === 'character') return window.FictionTalesData.characters.find((item) => item.id === id);
    if (scope === 'story') return window.FictionTalesData.savedStories.find((item) => item.id === id);
    if (scope === 'place') return window.FictionTalesData.places.find((item) => item.id === id);
    return null;
  }

  function entityName(scope, id) {
    const entity = getEntity(scope, id);
    return entity ? (scope === 'story' ? entity.title || 'Untitled story' : entity.name) : '';
  }

  function populateSelect(select, items, placeholder, selectedValue = '') {
    if (!select) return;
    const options = [`<option value="">${escapeHtml(placeholder)}</option>`];
    items.forEach((item) => {
      options.push(`<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`);
    });
    select.innerHTML = options.join('');
    if (items.some((item) => item.id === selectedValue)) select.value = selectedValue;
  }

  function renderRelationshipMap() {
    const graph = document.querySelector('#relationship-graph');
    const matrix = document.querySelector('#relationship-matrix');
    const empty = document.querySelector('#relationship-empty');
    const details = document.querySelector('#relationship-details');
    const cast = window.FictionTalesData.characters;
    empty.classList.toggle('hidden', cast.length > 0);
    graph.classList.toggle('hidden', cast.length === 0 || matrix.classList.contains('matrix-active'));
    matrix.classList.toggle('hidden', cast.length === 0 || !matrix.classList.contains('matrix-active'));
    if (!cast.length) {
      graph.innerHTML = '';
      matrix.innerHTML = '';
      details.textContent = 'Choose a character or relationship to see its details.';
      return;
    }

    const centerX = 500;
    const centerY = 205;
    const radiusX = Math.min(390, 85 + cast.length * 22);
    const radiusY = Math.min(145, 50 + cast.length * 8);
    const positions = cast.map((character, index) => {
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / cast.length;
      return { x: centerX + Math.cos(angle) * radiusX, y: centerY + Math.sin(angle) * radiusY };
    });
    const typeColors = {
      ally: '#438b69',
      rival: '#c05a5a',
      family: '#5681b5',
      'secret-crush': '#bb6c9a',
      betrayed: '#c17a3d',
      other: '#88b8c5',
    };
    const edges = [];
    const seen = new Set();
    cast.forEach((character) => {
      window.FictionTalesData.parseBonds(character.bonds).forEach((bond) => {
        const targetIndex = cast.findIndex((item) => item.id === bond.id);
        if (targetIndex < 0 || targetIndex === cast.indexOf(character)) return;
        const edgeKey = [character.id, bond.id].sort().join(':');
        if (seen.has(edgeKey)) return;
        seen.add(edgeKey);
        const sourceIndex = cast.indexOf(character);
        const reverse = window.FictionTalesData.parseBonds(cast[targetIndex].bonds).find((item) => item.id === character.id);
        const relation = bond || reverse;
        edges.push({
          x1: positions[sourceIndex].x,
          y1: positions[sourceIndex].y,
          x2: positions[targetIndex].x,
          y2: positions[targetIndex].y,
          type: relation.type,
          status: relation.status,
          label: bond.label || reverse?.label,
          history: relation.history,
          statusHistory: relation.statusHistory,
          color: typeColors[relation.type] || typeColors.other,
        });
      });
    });
    const lines = edges.map((edge) => `<line class="relationship-edge status-${escapeHtml(edge.status)}" style="--relationship-color:${edge.color}" x1="${edge.x1}" y1="${edge.y1}" x2="${edge.x2}" y2="${edge.y2}"><title>${escapeHtml(`${edge.type}: ${edge.status}${edge.label ? ` · ${edge.label}` : ''}`)}</title></line>`).join('');
    const nodes = cast.map((character, index) => {
      const position = positions[index];
      return `<button type="button" class="relationship-node" data-relationship-character="${escapeHtml(character.id)}" style="--node-x:${position.x / 10}%;--node-y:${position.y / 4.1}%" title="${escapeHtml(character.name)}">${escapeHtml(character.name)}</button>`;
    }).join('');
    graph.innerHTML = `<svg class="relationship-edges" viewBox="0 0 1000 410" role="img" aria-label="${edges.length} character connections">${lines}</svg><div class="relationship-nodes">${nodes}</div>`;

    const rows = cast.map((character) => {
      const bonds = window.FictionTalesData.parseBonds(character.bonds);
      const cells = cast.map((other) => {
        if (character.id === other.id) return '<td class="matrix-self" aria-label="Same character">·</td>';
        const bond = bonds.find((item) => item.id === other.id);
        const reverse = window.FictionTalesData.parseBonds(other.bonds).find((item) => item.id === character.id);
        const relation = bond || reverse;
        const label = relation ? `${relation.type}: ${relation.status}` : '';
        return `<td><button type="button" class="matrix-cell${relation ? ' has-relationship' : ''}" data-relationship-cell="${escapeHtml(character.id)}" data-relationship-target="${escapeHtml(other.id)}">${escapeHtml(label || '—')}</button></td>`;
      }).join('');
      return `<tr><th scope="row">${escapeHtml(character.name)}</th>${cells}</tr>`;
    }).join('');
    const headings = cast.map((character) => `<th scope="col">${escapeHtml(character.name)}</th>`).join('');
    matrix.innerHTML = `<div class="matrix-scroll"><table><thead><tr><th scope="col">Character</th>${headings}</tr></thead><tbody>${rows}</tbody></table></div>`;

    graph.querySelectorAll('[data-relationship-character]').forEach((button) => {
      button.addEventListener('click', () => {
        const character = cast.find((item) => item.id === button.dataset.relationshipCharacter);
        const bonds = window.FictionTalesData.parseBonds(character.bonds);
        const linked = bonds.map((bond) => {
          const target = cast.find((item) => item.id === bond.id);
          const history = bond.statusHistory.map((entry) => `${entry.when || 'Undated'}: ${entry.status}${entry.note ? ` (${entry.note})` : ''}`).join('; ');
          return target ? `${target.name} — ${bond.type} (${bond.status})${bond.label ? `, ${bond.label}` : ''}${bond.history ? `. History: ${bond.history}` : ''}${history ? `. Changes: ${history}` : ''}` : '';
        }).filter(Boolean);
        details.textContent = linked.length
          ? `${character.name} is connected to ${linked.join('; ')}.`
          : `${character.name} has no saved connections yet.`;
      });
    });
    matrix.querySelectorAll('[data-relationship-cell]').forEach((button) => {
      button.addEventListener('click', () => {
        const character = cast.find((item) => item.id === button.dataset.relationshipCell);
        const other = cast.find((item) => item.id === button.dataset.relationshipTarget);
        const relation = window.FictionTalesData.parseBonds(character.bonds).find((bond) => bond.id === other.id)
          || window.FictionTalesData.parseBonds(other.bonds).find((bond) => bond.id === character.id);
        const history = relation?.statusHistory.map((entry) => `${entry.when || 'Undated'}: ${entry.status}${entry.note ? ` (${entry.note})` : ''}`).join('; ');
        details.textContent = relation
          ? `${character.name} and ${other.name}: ${relation.type} (${relation.status})${relation.label ? `, ${relation.label}` : ''}.${relation.history ? ` History: ${relation.history}` : ''}${history ? ` Status changes: ${history}` : ''}`
          : `${character.name} and ${other.name} do not have a saved connection.`;
      });
    });
  }

  function dateRank(value) {
    const date = text(value, 40);
    if (/^\d{4}-\d{2}-\d{2}/.test(date)) return Date.parse(date);
    const year = date.match(/^(?:year\s+)?(-?\d{1,6})$/i);
    if (year) {
      const startOfYear = new Date(0);
      startOfYear.setUTCFullYear(Number(year[1]), 0, 1);
      return startOfYear.getTime();
    }
    const parsed = Date.parse(date);
    return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
  }

  function renderTimeline() {
    const order = document.querySelector('#master-timeline-order').value;
    const events = [];
    state.data.events.forEach((event) => {
      events.push({ ...event, kind: 'world', source: 'World event', sort: order === 'writing' ? Date.parse(event.createdAt) : dateRank(event.date) });
    });
    window.FictionTalesData.characters.forEach((character) => {
      window.FictionTalesData.parseTimeline(character.timeline).forEach((event) => {
        events.push({
          id: `${character.id}:${event.when}:${event.text}`,
          title: event.text,
          date: event.when,
          knowledge: event.knowledge,
          characterId: character.id,
          source: 'Character life event',
          kind: 'character',
          sort: order === 'writing' ? Date.parse(character.updatedAt || '') : dateRank(event.when),
        });
      });
    });
    window.FictionTalesData.savedStories.forEach((story) => {
      events.push({
        id: story.id,
        title: story.title || 'Untitled story',
        date: story.updatedAt || '',
        storyId: story.id,
        source: 'Story',
        kind: 'story',
        sort: order === 'writing' ? Date.parse(story.updatedAt || '') : Number.POSITIVE_INFINITY,
      });
    });
    events.sort((a, b) => {
      const aRank = Number.isFinite(a.sort) ? a.sort : Number.POSITIVE_INFINITY;
      const bRank = Number.isFinite(b.sort) ? b.sort : Number.POSITIVE_INFINITY;
      return aRank - bRank || String(a.date || '').localeCompare(String(b.date || ''));
    });
    const list = document.querySelector('#master-timeline-list');
    list.innerHTML = events.map((event) => {
      const links = [event.characterId && entityName('character', event.characterId), event.storyId && entityName('story', event.storyId)].filter(Boolean);
      const removeButton = event.kind === 'world'
        ? `<button type="button" class="planning-remove" data-remove-event="${escapeHtml(event.id)}" aria-label="Remove event">×</button>` : '';
      return `<li class="master-timeline-item timeline-${event.kind}"><span class="timeline-date">${escapeHtml(event.date || 'Date not set')}</span><div><span class="timeline-source">${escapeHtml(event.source)}</span><h4>${escapeHtml(event.title)}</h4>${links.length ? `<p>${escapeHtml(links.join(' · '))}</p>` : ''}${event.knowledge ? `<p class="timeline-knowledge"><strong>Knows:</strong> ${escapeHtml(event.knowledge)}</p>` : ''}</div>${removeButton}</li>`;
    }).join('');
    const hasEvents = events.length > 0;
    document.querySelector('#master-timeline-empty').classList.toggle('hidden', hasEvents);
    list.classList.toggle('hidden', !hasEvents);
    list.querySelectorAll('[data-remove-event]').forEach((button) => {
      button.addEventListener('click', () => saveData({
        ...state.data,
        events: state.data.events.filter((event) => event.id !== button.dataset.removeEvent),
      }));
    });
  }

  function availableEntities(scope) {
    const items = scope === 'character' ? window.FictionTalesData.characters
      : scope === 'story' ? window.FictionTalesData.savedStories
        : scope === 'place' ? window.FictionTalesData.places : [];
    return items.map((item) => ({ id: item.id, name: scope === 'story' ? item.title || 'Untitled story' : item.name }));
  }

  function renderMoodboardOptions() {
    const scope = document.querySelector('#moodboard-scope').value;
    const scopeLabel = { character: 'Character', story: 'Story', place: 'Place' }[scope];
    document.querySelector('#moodboard-entity-label').firstChild.textContent = `${scopeLabel} `;
    populateSelect(document.querySelector('#moodboard-entity'), availableEntities(scope), `Choose a ${scopeLabel.toLowerCase()}`);

    const filterScope = document.querySelector('#moodboard-filter-scope').value;
    const filterSelect = document.querySelector('#moodboard-filter-entity');
    const priorValue = filterSelect.value;
    const entries = state.data.moodboards.filter((entry) => filterScope === 'all' || entry.scope === filterScope);
    const options = ['<option value="all">All items</option>'];
    const ids = [...new Set(entries.map((entry) => `${entry.scope}:${entry.entityId}`))];
    ids.forEach((key) => {
      const [entityScope, id] = key.split(':');
      const name = entityName(entityScope, id);
      if (name) options.push(`<option value="${escapeHtml(key)}">${escapeHtml(name)}</option>`);
    });
    filterSelect.innerHTML = options.join('');
    if ([...filterSelect.options].some((option) => option.value === priorValue)) filterSelect.value = priorValue;
  }

  function renderMoodboards() {
    renderMoodboardOptions();
    const filterScope = document.querySelector('#moodboard-filter-scope').value;
    const filterEntity = document.querySelector('#moodboard-filter-entity').value;
    const entries = state.data.moodboards.filter((entry) => {
      if (filterScope !== 'all' && entry.scope !== filterScope) return false;
      return filterEntity === 'all' || `${entry.scope}:${entry.entityId}` === filterEntity;
    });
    const grid = document.querySelector('#moodboard-grid');
    grid.innerHTML = entries.map((entry) => {
      const image = safeImageUrl(entry.image);
      const imageBlock = image
        ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">`
        : `<div class="moodboard-placeholder" style="--board-accent:${escapeHtml(entry.color)}"><span>✦</span></div>`;
      const tags = entry.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
      return `<article class="moodboard-card" style="--board-accent:${escapeHtml(entry.color)}">${imageBlock}<div class="moodboard-card-content"><span class="moodboard-entity">${escapeHtml(entry.scope)} · ${escapeHtml(entityName(entry.scope, entry.entityId) || 'Removed item')}</span>${tags.length ? `<div class="moodboard-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>` : ''}${entry.quote ? `<blockquote>${escapeHtml(entry.quote)}</blockquote>` : ''}<button type="button" class="planning-remove" data-remove-moodboard="${escapeHtml(entry.id)}" aria-label="Remove inspiration card">Remove</button></div></article>`;
    }).join('');
    document.querySelector('#moodboard-empty').classList.toggle('hidden', entries.length > 0);
    grid.classList.toggle('hidden', entries.length === 0);
    grid.querySelectorAll('[data-remove-moodboard]').forEach((button) => {
      button.addEventListener('click', () => saveData({
        ...state.data,
        moodboards: state.data.moodboards.filter((entry) => entry.id !== button.dataset.removeMoodboard),
      }));
    });
  }

  function renderPromptOptions() {
    const characterSelect = document.querySelector('#prompt-character');
    const placeSelect = document.querySelector('#prompt-place');
    const selectedCharacter = characterSelect.value;
    const selectedPlace = placeSelect.value;
    characterSelect.innerHTML = '<option value="random">Surprise me</option>' + availableEntities('character')
      .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
    placeSelect.innerHTML = '<option value="random">Surprise me</option>' + availableEntities('place')
      .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
    if ([...characterSelect.options].some((option) => option.value === selectedCharacter)) characterSelect.value = selectedCharacter;
    if ([...placeSelect.options].some((option) => option.value === selectedPlace)) placeSelect.value = selectedPlace;
  }

  function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)];
  }

  function generatePrompt() {
    const chosenCharacter = document.querySelector('#prompt-character').value;
    const chosenPlace = document.querySelector('#prompt-place').value;
    const character = chosenCharacter === 'random'
      ? randomItem(window.FictionTalesData.characters)
      : window.FictionTalesData.characters.find((item) => item.id === chosenCharacter);
    const place = chosenPlace === 'random'
      ? randomItem(window.FictionTalesData.places)
      : window.FictionTalesData.places.find((item) => item.id === chosenPlace);
    const conflict = randomItem(conflictPrompts);
    if (!character && !place) {
      state.prompt = '';
      window.FictionTalesData.showToast('Create at least one character or place to generate a universe prompt.');
      document.querySelector('#universe-prompt-result').innerHTML = '<span>YOUR NEXT SPARK</span><p>Add a character or place first, then come back for a prompt made for your world.</p>';
      document.querySelector('#prompt-to-outline').disabled = true;
      return;
    }
    const opening = character && place
      ? `What if ${character.name} found themselves in ${place.name}?`
      : character ? `What if ${character.name} faced a choice they cannot avoid?`
        : `What if something changed forever at ${place.name}?`;
    state.prompt = `${opening} ${conflict}`;
    document.querySelector('#universe-prompt-result').innerHTML = `<span>YOUR NEXT SPARK</span><p>${escapeHtml(state.prompt)}</p>`;
    document.querySelector('#prompt-to-outline').disabled = false;
  }

  function renderOutlineOptions() {
    const select = document.querySelector('#outline-story');
    const selected = select.value;
    select.innerHTML = '<option value="">General outline</option>' + window.FictionTalesData.allStories
      .map((story) => {
        const draft = !window.FictionTalesData.savedStories.some((saved) => saved.id === story.id);
        return `<option value="${escapeHtml(story.id)}">${escapeHtml(story.title || 'Untitled story')}${draft ? ' · Draft' : ''}</option>`;
      }).join('');
    if ([...select.options].some((option) => option.value === selected)) select.value = selected;
  }

  function storyChapterTitles(story) {
    return String(story?.text || '').split(/\r?\n/)
      .map((line) => line.match(/^#{1,2}[ \t]+(.+?)\s*$/)?.[1]?.trim())
      .filter(Boolean);
  }

  function renderOutline() {
    renderOutlineOptions();
    const storyId = document.querySelector('#outline-story').value;
    const cards = state.data.outline
      .map((card, index) => ({ ...card, index }))
      .filter((card) => card.storyId === storyId)
      .sort((a, b) => a.act - b.act || a.index - b.index);
    const board = document.querySelector('#outline-board');
    board.innerHTML = [1, 2, 3].map((act) => {
      const actCards = cards.filter((card) => card.act === act);
      const label = { 1: 'Act I · Setup', 2: 'Act II · Confrontation', 3: 'Act III · Resolution' }[act];
      const content = actCards.map((card, index) => {
        const story = window.FictionTalesData.allStories.find((item) => item.id === card.storyId);
        const chapterTitles = storyChapterTitles(story);
        const linkSelect = story ? `<label class="outline-act-select">Chapter link<select data-outline-chapter="${escapeHtml(card.id)}"><option value="">Not linked</option>${chapterTitles.map((title) => `<option value="${escapeHtml(title)}" ${card.chapter === title ? 'selected' : ''}>${escapeHtml(title)}</option>`).join('')}${card.chapter && !chapterTitles.includes(card.chapter) ? `<option value="${escapeHtml(card.chapter)}" selected>Create/open: ${escapeHtml(card.chapter)}</option>` : ''}<option value="__scene__">Create from scene title</option></select></label><button type="button" class="outline-open-chapter" data-open-outline-scene="${escapeHtml(card.id)}">${card.chapter ? 'Open linked chapter' : 'Create chapter in draft'}</button>` : '';
        return `<article class="outline-card"><div class="outline-card-tools"><span>SCENE ${String(index + 1).padStart(2, '0')}</span><div><button type="button" data-move-outline="${escapeHtml(card.id)}" data-direction="-1" aria-label="Move scene earlier" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-move-outline="${escapeHtml(card.id)}" data-direction="1" aria-label="Move scene later" ${index === actCards.length - 1 ? 'disabled' : ''}>↓</button><button type="button" class="outline-delete" data-remove-outline="${escapeHtml(card.id)}" aria-label="Delete scene">×</button></div></div><h4>${escapeHtml(card.title)}</h4>${card.summary ? `<p>${escapeHtml(card.summary)}</p>` : ''}<label class="outline-act-select">Move to<select data-outline-act="${escapeHtml(card.id)}"><option value="1" ${card.act === 1 ? 'selected' : ''}>Act I</option><option value="2" ${card.act === 2 ? 'selected' : ''}>Act II</option><option value="3" ${card.act === 3 ? 'selected' : ''}>Act III</option></select></label>${linkSelect}</article>`;
      }).join('');
      return `<section class="outline-act"><h4>${label}<span>${actCards.length}</span></h4><div class="outline-act-cards">${content || '<p class="outline-act-empty">No scenes in this act yet.</p>'}</div></section>`;
    }).join('');
    document.querySelector('#outline-empty').classList.toggle('hidden', cards.length > 0);
    board.classList.toggle('hidden', cards.length === 0);
    board.querySelectorAll('[data-remove-outline]').forEach((button) => {
      button.addEventListener('click', () => saveData({
        ...state.data,
        outline: state.data.outline.filter((card) => card.id !== button.dataset.removeOutline),
      }));
    });
    board.querySelectorAll('[data-outline-act]').forEach((select) => {
      select.addEventListener('change', () => {
        const card = state.data.outline.find((item) => item.id === select.dataset.outlineAct);
        if (!card) return;
        saveData({ ...state.data, outline: state.data.outline.map((item) => item.id === card.id ? { ...item, act: Number(select.value) } : item) });
      });
    });
    board.querySelectorAll('[data-move-outline]').forEach((button) => {
      button.addEventListener('click', () => {
        const target = state.data.outline.find((item) => item.id === button.dataset.moveOutline);
        if (!target) return;
        const groupIndexes = state.data.outline.reduce((indexes, card, index) => {
          if (card.storyId === target.storyId && card.act === target.act) indexes.push(index);
          return indexes;
        }, []);
        const currentPosition = groupIndexes.indexOf(state.data.outline.indexOf(target));
        const nextPosition = currentPosition + Number(button.dataset.direction);
        if (nextPosition < 0 || nextPosition >= groupIndexes.length) return;
        const next = [...state.data.outline];
        [next[groupIndexes[currentPosition]], next[groupIndexes[nextPosition]]] = [next[groupIndexes[nextPosition]], next[groupIndexes[currentPosition]]];
        saveData({ ...state.data, outline: next });
      });
    });
    board.querySelectorAll('[data-outline-chapter]').forEach((select) => {
      select.addEventListener('change', () => {
        const card = state.data.outline.find((item) => item.id === select.dataset.outlineChapter);
        if (!card) return;
        const chapter = select.value === '__scene__' ? card.title : select.value;
        saveData({ ...state.data, outline: state.data.outline.map((item) => item.id === card.id ? { ...item, chapter } : item) });
      });
    });
    board.querySelectorAll('[data-open-outline-scene]').forEach((button) => {
      button.addEventListener('click', () => {
        const card = state.data.outline.find((item) => item.id === button.dataset.openOutlineScene);
        if (!card?.storyId) return;
        const chapter = card.chapter || card.title;
        if (!card.chapter && !saveData({
          ...state.data,
          outline: state.data.outline.map((item) => item.id === card.id ? { ...item, chapter } : item),
        })) return;
        window.dispatchEvent(new CustomEvent('FictionTales:open-outline-scene', {
          detail: { storyId: card.storyId, chapterTitle: chapter, returnFocus: document.querySelector('#outline-board') },
        }));
      });
    });
  }

  function renderTimelineSelectors() {
    populateSelect(document.querySelector('#world-event-character'), availableEntities('character'), 'No character');
    populateSelect(document.querySelector('#world-event-story'), availableEntities('story'), 'No story');
  }

  function renderAll() {
    renderRelationshipMap();
    renderTimelineSelectors();
    renderTimeline();
    renderMoodboards();
    renderPromptOptions();
    renderOutline();
  }

  function addOutlineCard(title, summary = '', storyId = '') {
    const card = { id: makeId(), storyId, act: 1, title: text(title, 100), summary: text(summary, 300), chapter: '', createdAt: new Date().toISOString() };
    if (!card.title) return;
    saveData({ ...state.data, outline: [...state.data.outline, card] });
  }

  document.querySelectorAll('[data-planning-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-planning-tab]').forEach((tab) => {
        const active = tab === button;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
      });
      document.querySelectorAll('[data-planning-panel]').forEach((panel) => {
        panel.classList.toggle('hidden', panel.dataset.planningPanel !== button.dataset.planningTab);
      });
      renderAll();
    });
  });

  document.querySelectorAll('[data-open-planning]').forEach((button) => {
    button.addEventListener('click', () => {
      const tab = document.querySelector(`[data-planning-tab="${button.dataset.openPlanning}"]`);
      tab?.click();
      const panel = document.querySelector(`[data-planning-panel="${button.dataset.openPlanning}"]`);
      const firstField = panel?.querySelector('#prompt-character, #outline-form input, #world-event-form input, #moodboard-scope, [data-relationship-view]');
      if (firstField) {
        window.setTimeout(() => firstField.focus({ preventScroll: true }), 0);
      }
    });
  });

  document.querySelectorAll('[data-relationship-view]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-relationship-view]').forEach((view) => view.classList.toggle('active', view === button));
      const matrix = document.querySelector('#relationship-matrix');
      matrix.classList.toggle('matrix-active', button.dataset.relationshipView === 'matrix');
      renderRelationshipMap();
    });
  });

  document.querySelector('#master-timeline-order').addEventListener('change', renderTimeline);
  document.querySelector('#world-event-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const item = {
      id: makeId(),
      date: text(values.get('date'), 40),
      title: text(values.get('title'), 180),
      characterId: text(values.get('characterId'), 100),
      storyId: text(values.get('storyId'), 100),
      knowledge: text(values.get('knowledge'), 600),
      createdAt: new Date().toISOString(),
    };
    if (!item.title || !item.date) return;
    if (saveData({ ...state.data, events: [...state.data.events, item] })) form.reset();
  });

  document.querySelector('#moodboard-scope').addEventListener('change', renderMoodboardOptions);
  document.querySelector('#moodboard-filter-scope').addEventListener('change', renderMoodboards);
  document.querySelector('#moodboard-filter-entity').addEventListener('change', renderMoodboards);
  document.querySelector('#moodboard-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const image = text(values.get('image'), 1000);
    if (image && !safeImageUrl(image)) {
      window.FictionTalesData.showToast('Use an HTTP or HTTPS link for the inspiration image.');
      form.elements.image.focus();
      return;
    }
    const item = {
      id: makeId(),
      scope: text(values.get('scope'), 20),
      entityId: text(values.get('entityId'), 100),
      image,
      tags: text(values.get('tags'), 120),
      quote: text(values.get('quote'), 400),
      color: text(values.get('color'), 7),
      createdAt: new Date().toISOString(),
    };
    if (!item.entityId) {
      window.FictionTalesData.showToast('Create an item in the selected category before pinning inspiration.');
      return;
    }
    if (!image && !item.tags && !item.quote) {
      window.FictionTalesData.showToast('Add an image, aesthetic tag, or note before pinning.');
      return;
    }
    if (saveData({ ...state.data, moodboards: [...state.data.moodboards, item] })) {
      form.reset();
      document.querySelector('#moodboard-scope').dispatchEvent(new Event('change'));
    }
  });

  document.querySelector('#generate-universe-prompt').addEventListener('click', generatePrompt);
  document.querySelector('#prompt-to-outline').addEventListener('click', () => {
    if (!state.prompt) return;
    const storyId = document.querySelector('#outline-story').value;
    addOutlineCard(state.prompt.slice(0, 100), state.prompt, storyId);
    document.querySelector('[data-planning-tab="outline"]').click();
  });

  document.querySelector('#outline-story').addEventListener('change', renderOutline);
  document.querySelector('#outline-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const item = {
      id: makeId(),
      storyId: document.querySelector('#outline-story').value,
      act: Number(values.get('act')),
      title: text(values.get('title'), 100),
      summary: text(values.get('summary'), 300),
      chapter: '',
      createdAt: new Date().toISOString(),
    };
    if (item.title && saveData({ ...state.data, outline: [...state.data.outline, item] })) form.reset();
  });

  document.querySelectorAll('.nav-link[href="#planning"]').forEach((link) => {
    link.addEventListener('click', renderAll);
  });
  window.addEventListener('FictionTales:data-imported', renderAll);
  window.addEventListener('FictionTales:story-draft-updated', renderOutline);
  const observedLibraries = ['#character-grid', '#story-library', '#place-library']
    .map((selector) => document.querySelector(selector))
    .filter(Boolean);
  if (observedLibraries.length) {
    const observer = new MutationObserver(() => window.requestAnimationFrame(renderAll));
    observedLibraries.forEach((library) => observer.observe(library, { childList: true, subtree: true }));
  }

  window.FictionTalesPlanning = {
    getData: () => state.data,
    normalize: normalizeData,
    reloadFromStorage() {
      state.data = loadData();
      renderAll();
    },
  };
  renderAll();
})();
