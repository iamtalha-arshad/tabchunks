'use strict';

// Chrome's tab group palette; chunk colors map 1:1 so restored groups match.
const COLORS = {
  blue: '#1a73e8', red: '#d93025', yellow: '#f9ab00', green: '#188038', pink: '#d01884',
  purple: '#a142f4', cyan: '#007b83', orange: '#fa903e', grey: '#5f6368',
};

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS = {
  expand: svg('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>'),
  menu: svg('<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>'),
  window: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  chevron: svg('<path d="m6 9 6 6 6-6"/>'),
  box: svg('<path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
};

const isFull = new URLSearchParams(location.search).has('full');
const SELF_URL = chrome.runtime.getURL('');

const state = {
  windowId: null,
  tabs: [],
  groups: new Map(),
  selected: new Set(),
  filter: '',
  color: 'blue',
  nameTouched: false,
  chunks: [],
  settings: { restoreAsGroup: true, deleteAfterRestore: false },
  query: '',
  expanded: new Set(),
  editing: null,
  highlight: null,
};

// ---------- helpers ----------

const $ = (sel) => document.querySelector(sel);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'style') node.style.cssText = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (['checked', 'value', 'disabled', 'title'].includes(key)) node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

const iconBtn = (icon, title, onclick, extra = '') =>
  el('button', { class: `icon-btn ${extra}`, title, 'aria-label': title, html: ICONS[icon], onclick });

const favicon = (url) => chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const send = (msg) => chrome.runtime.sendMessage(msg);
const persistChunks = () => chrome.storage.local.set({ chunks: state.chunks });

function host(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') || url; } catch { return url; }
}

function ago(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function defaultName() {
  const when = new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `Chunk · ${when}`;
}

let toastTimer;
function toast(message, { error = false, action, onAction } = {}) {
  const box = $('#toast');
  clearTimeout(toastTimer);
  box.className = `toast${error ? ' error' : ''}`;
  box.replaceChildren(
    el('span', {}, message),
    action && el('button', { onclick: () => { box.hidden = true; onAction(); } }, action),
  );
  box.hidden = false;
  toastTimer = setTimeout(() => { box.hidden = true; }, action ? 5000 : 2800);
}

// ---------- view switching ----------

function setView(view) {
  for (const btn of document.querySelectorAll('#seg button')) {
    btn.classList.toggle('active', btn.dataset.view === view);
    btn.setAttribute('aria-selected', btn.dataset.view === view);
  }
  $('#savePane').hidden = view !== 'save';
  $('#savedPane').hidden = view !== 'saved';
  if (view === 'save' && !isFull) $('#chunkName').focus();
  chrome.storage.local.set({ lastView: view });
}

// ---------- save pane ----------

async function loadTabs(initial = false) {
  const tabs = (await chrome.tabs.query({ windowId: state.windowId }))
    .filter((t) => !(t.url || '').startsWith(SELF_URL));
  const groupIds = [...new Set(tabs.map((t) => t.groupId).filter((id) => id !== -1))];
  const groups = await Promise.all(groupIds.map((id) => chrome.tabGroups.get(id).catch(() => null)));

  state.tabs = tabs;
  state.groups = new Map(groups.filter(Boolean).map((g) => [g.id, g]));

  if (initial) {
    // Respect a multi-tab highlight (Ctrl/Shift-click); otherwise preselect every unpinned tab.
    const highlighted = tabs.filter((t) => t.highlighted);
    const pick = highlighted.length > 1 ? highlighted : tabs.filter((t) => !t.pinned);
    state.selected = new Set(pick.map((t) => t.id));
  } else {
    const ids = new Set(tabs.map((t) => t.id));
    state.selected = new Set([...state.selected].filter((id) => ids.has(id)));
  }
  renderTabs();
}

function visibleTabs() {
  const f = state.filter.trim().toLowerCase();
  if (!f) return state.tabs;
  return state.tabs.filter((t) => (t.title || '').toLowerCase().includes(f) || (t.url || '').toLowerCase().includes(f));
}

function setSelected(tabs, on) {
  for (const t of tabs) on ? state.selected.add(t.id) : state.selected.delete(t.id);
  renderTabs();
}

function suggestFromGroup(group) {
  if (!group || state.nameTouched) return;
  $('#chunkName').value = group.title || '';
  state.color = group.color;
  renderColors();
}

function renderTabs() {
  const list = $('#tabList');
  const visible = visibleTabs();
  list.replaceChildren();

  let lastGroup = -1;
  for (const tab of visible) {
    if (tab.groupId !== -1 && tab.groupId !== lastGroup) {
      const group = state.groups.get(tab.groupId);
      const members = visible.filter((t) => t.groupId === tab.groupId);
      const allOn = members.every((t) => state.selected.has(t.id));
      list.append(el('li', { class: 'group-row', style: `--c:${COLORS[group?.color] || COLORS.grey}` },
        el('label', { class: 'check', title: 'Select this whole group' },
          el('input', {
            type: 'checkbox',
            checked: allOn,
            onchange: (e) => {
              if (e.target.checked) suggestFromGroup(group);
              setSelected(members, e.target.checked);
            },
          }),
          el('span', { class: 'group-chip' }, group?.title || 'Unnamed group')),
        el('span', { class: 'muted' }, plural(members.length, 'tab'))));
    }
    lastGroup = tab.groupId;
    list.append(tabRow(tab));
  }

  if (!visible.length) {
    list.append(el('li', { class: 'empty small' }, state.filter ? 'No tabs match your filter' : 'No tabs in this window'));
  }
  updateSelectionUI(visible);
}

function tabRow(tab) {
  const group = state.groups.get(tab.groupId);
  const on = state.selected.has(tab.id);
  return el('li', {
    class: `tab-row${group ? ' in-group' : ''}${on ? ' selected' : ''}`,
    style: group ? `--c:${COLORS[group.color]}` : null,
  },
  el('label', { class: 'check' },
    el('input', { type: 'checkbox', checked: on, onchange: (e) => setSelected([tab], e.target.checked) }),
    el('img', { class: 'fav', src: favicon(tab.url || ''), alt: '' }),
    el('span', { class: 'tab-text' },
      el('span', { class: 'tab-title' }, tab.title || tab.url),
      el('span', { class: 'tab-url' }, host(tab.url || ''))),
    tab.pinned && el('span', { class: 'tag' }, 'Pinned'),
    tab.active && el('span', { class: 'tag' }, 'Current')));
}

function updateSelectionUI(visible) {
  const count = state.tabs.filter((t) => state.selected.has(t.id)).length;
  const visibleOn = visible.filter((t) => state.selected.has(t.id)).length;
  const all = $('#selectAll');
  all.checked = visible.length > 0 && visibleOn === visible.length;
  all.indeterminate = visibleOn > 0 && visibleOn < visible.length;
  $('#selCount').textContent = `${count} of ${plural(state.tabs.length, 'tab')} selected`;
  $('#saveKeep').disabled = $('#saveClose').disabled = count === 0;
  $('#saveClose').textContent = count ? `Save & close ${plural(count, 'tab')}` : 'Save & close';
}

function renderColors() {
  $('#colorRow').replaceChildren(...Object.entries(COLORS).map(([name, hex]) =>
    el('button', {
      class: `swatch${state.color === name ? ' active' : ''}`,
      style: `--c:${hex}`,
      title: name,
      role: 'radio',
      'aria-checked': String(state.color === name),
      onclick: () => { state.color = name; renderColors(); },
    })));
}

async function save(close) {
  const tabIds = state.tabs.filter((t) => state.selected.has(t.id)).map((t) => t.id);
  if (!tabIds.length) return;
  const res = await send({ type: 'save', tabIds, name: $('#chunkName').value, color: state.color, close });
  if (!res?.ok) return toast(res?.error || 'Could not save', { error: true });

  $('#chunkName').value = '';
  $('#chunkName').placeholder = defaultName();
  state.nameTouched = false;
  state.highlight = res.chunk.id;
  toast(`Saved “${res.chunk.name}” · ${plural(res.chunk.tabs.length, 'tab')}`);
  if (!isFull) setView('saved');
}

// ---------- saved pane ----------

function renderChunks() {
  $('#savedCount').textContent = state.chunks.length;
  const list = $('#chunkList');
  const q = state.query.trim().toLowerCase();
  list.replaceChildren();

  for (const chunk of state.chunks) {
    const nameHit = !q || chunk.name.toLowerCase().includes(q);
    const tabHits = q
      ? chunk.tabs.filter((t) => (t.title || '').toLowerCase().includes(q) || t.url.toLowerCase().includes(q))
      : chunk.tabs;
    if (!nameHit && !tabHits.length) continue;
    // A search that only matched tabs opens the card and shows just those tabs.
    list.append(chunkCard(chunk, nameHit ? chunk.tabs : tabHits, !nameHit));
  }

  if (!list.children.length) {
    list.append(q
      ? el('div', { class: 'empty' }, el('div', { html: ICONS.search }), el('strong', {}, 'Nothing found'), `No chunk or tab matches “${state.query}”.`)
      : el('div', { class: 'empty' }, el('div', { html: ICONS.box }), el('strong', {}, 'No saved chunks yet'), 'Select some tabs, give them a name, and hit Save & close.'));
  }
  state.highlight = null;
}

function chunkCard(chunk, tabs, forceOpen) {
  const open = forceOpen || state.expanded.has(chunk.id);
  const MAX_FAVS = isFull ? 12 : 10;

  const title = state.editing === chunk.id
    ? renameInput(chunk)
    : el('h3', { class: 'name', title: 'Double-click to rename', ondblclick: () => startRename(chunk) }, chunk.name);

  return el('article', {
    class: `card${state.highlight === chunk.id ? ' flash' : ''}`,
    style: `--c:${COLORS[chunk.color] || COLORS.blue}`,
  },
  el('div', { class: 'card-head' },
    el('button', { class: 'dot', title: 'Change color', 'aria-label': 'Change color', onclick: () => cycleColor(chunk) }),
    el('div', { class: 'title-wrap' }, title, el('div', { class: 'meta' }, `${plural(chunk.tabs.length, 'tab')} · ${ago(chunk.createdAt)}`)),
    el('div', { class: 'card-actions' },
      el('button', { class: 'btn small primary', title: 'Restore into this window', onclick: () => restore(chunk, false) }, 'Restore'),
      iconBtn('window', 'Restore in a new window', () => restore(chunk, true)),
      iconBtn('edit', 'Rename', () => startRename(chunk)),
      iconBtn('trash', 'Delete', () => removeChunk(chunk), 'danger'))),
  el('button', { class: 'favs', 'aria-expanded': String(open), title: open ? 'Hide tabs' : 'Show tabs', onclick: () => toggleExpand(chunk.id) },
    chunk.tabs.slice(0, MAX_FAVS).map((t) => el('img', { class: 'fav', src: favicon(t.url), alt: '' })),
    chunk.tabs.length > MAX_FAVS && el('span', { class: 'more' }, `+${chunk.tabs.length - MAX_FAVS}`),
    el('span', { class: 'chev', html: ICONS.chevron })),
  open && el('ul', { class: 'chunk-tabs' }, chunkTabRows(chunk, tabs)));
}

function chunkTabRows(chunk, tabs) {
  const rows = [];
  let lastGroup = null;
  for (const t of tabs) {
    const group = t.group != null ? chunk.groups?.[t.group] : null;
    if (group && t.group !== lastGroup) {
      rows.push(el('li', { class: 'saved-group', style: `--c:${COLORS[group.color] || COLORS.grey}` },
        el('span', { class: 'group-chip' }, group.title || 'Unnamed group')));
    }
    lastGroup = t.group ?? null;
    rows.push(el('li', { class: group ? 'in-group' : null, style: group ? `--c:${COLORS[group.color] || COLORS.grey}` : null },
      el('img', { class: 'fav', src: favicon(t.url), alt: '' }),
      el('a', {
        href: t.url,
        title: `${t.title}\n${t.url}`,
        onclick: (e) => { e.preventDefault(); chrome.tabs.create({ url: t.url, active: !(e.metaKey || e.ctrlKey) }); },
      }, t.title || t.url),
      el('span', { class: 'tab-url' }, host(t.url)),
      iconBtn('x', 'Remove from chunk', () => removeTab(chunk, t))));
  }
  return rows;
}

function toggleExpand(id) {
  state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
  renderChunks();
}

function startRename(chunk) {
  state.editing = chunk.id;
  renderChunks();
  const input = document.querySelector('.rename');
  input?.focus();
  input?.select();
}

function renameInput(chunk) {
  const commit = (value) => {
    if (state.editing !== chunk.id) return;
    state.editing = null;
    const name = value.trim();
    if (name && name !== chunk.name) {
      chunk.name = name;
      persistChunks();
    }
    renderChunks();
  };
  return el('input', {
    class: 'rename',
    value: chunk.name,
    maxlength: '80',
    onkeydown: (e) => {
      if (e.key === 'Enter') commit(e.target.value);
      if (e.key === 'Escape') { e.preventDefault(); commit(chunk.name); }
    },
    onblur: (e) => commit(e.target.value),
  });
}

function cycleColor(chunk) {
  const names = Object.keys(COLORS);
  chunk.color = names[(names.indexOf(chunk.color) + 1) % names.length];
  persistChunks();
  renderChunks();
}

async function restore(chunk, newWindow) {
  const res = await send({ type: 'restore', id: chunk.id, newWindow });
  if (!res?.ok) return toast(res?.error || 'Could not restore', { error: true });
  toast(res.removed ? `Restored and removed “${chunk.name}”` : `Restored “${chunk.name}”`);
}

function removeChunk(chunk) {
  const index = state.chunks.indexOf(chunk);
  state.chunks.splice(index, 1);
  persistChunks();
  renderChunks();
  toast(`Deleted “${chunk.name}”`, {
    action: 'Undo',
    onAction: () => {
      state.chunks.splice(Math.min(index, state.chunks.length), 0, chunk);
      persistChunks();
      renderChunks();
    },
  });
}

function removeTab(chunk, tab) {
  if (chunk.tabs.length === 1) return removeChunk(chunk);
  chunk.tabs.splice(chunk.tabs.indexOf(tab), 1);
  persistChunks();
  renderChunks();
}

// ---------- import / export ----------

function exportChunks() {
  const data = { app: 'TabChunks', version: 1, exportedAt: new Date().toISOString(), chunks: state.chunks };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  el('a', { href: url, download: `tabchunks-${new Date().toISOString().slice(0, 10)}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importChunks(file) {
  try {
    const data = JSON.parse(await file.text());
    const incoming = (Array.isArray(data) ? data : data.chunks || [])
      .filter((c) => c && Array.isArray(c.tabs) && c.tabs.some((t) => t?.url));
    const known = new Set(state.chunks.map((c) => c.id));
    const fresh = incoming
      .filter((c) => !known.has(c.id))
      .map((c) => ({
        id: c.id || crypto.randomUUID(),
        name: String(c.name || defaultName()),
        color: COLORS[c.color] ? c.color : 'blue',
        createdAt: Number(c.createdAt) || Date.now(),
        groups: (Array.isArray(c.groups) ? c.groups : []).map((g) => ({
          title: String(g?.title || ''),
          color: COLORS[g?.color] ? g.color : 'grey',
          collapsed: !!g?.collapsed,
        })),
        tabs: c.tabs.filter((t) => t?.url).map((t) => ({
          url: String(t.url),
          title: String(t.title || t.url),
          pinned: !!t.pinned,
          group: Number.isInteger(t.group) && t.group >= 0 && t.group < (c.groups?.length || 0) ? t.group : null,
        })),
      }));
    state.chunks.push(...fresh);
    await persistChunks();
    renderChunks();
    toast(fresh.length ? `Imported ${plural(fresh.length, 'chunk')}` : 'Nothing new to import');
  } catch {
    toast('That file is not a valid TabChunks export', { error: true });
  }
}

// ---------- wiring ----------

function bind() {
  for (const btn of document.querySelectorAll('#seg button')) btn.onclick = () => setView(btn.dataset.view);

  $('#openFull').innerHTML = ICONS.expand;
  $('#menuBtn').innerHTML = ICONS.menu;
  $('#openFull').onclick = () => { chrome.tabs.create({ url: 'popup.html?full' }); window.close(); };

  const menu = $('#menu');
  $('#menuBtn').onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.hidden = true; });

  $('#optGroup').checked = state.settings.restoreAsGroup;
  $('#optDelete').checked = state.settings.deleteAfterRestore;
  const saveSettings = () => {
    state.settings = { restoreAsGroup: $('#optGroup').checked, deleteAfterRestore: $('#optDelete').checked };
    chrome.storage.local.set({ settings: state.settings });
  };
  $('#optGroup').onchange = saveSettings;
  $('#optDelete').onchange = saveSettings;

  $('#exportBtn').onclick = () => { menu.hidden = true; exportChunks(); };
  // A file picker steals focus and kills the popup, so importing happens in the full view.
  if (!isFull) $('#importBtn').textContent = 'Import chunks… (opens full view)';
  $('#importBtn').onclick = () => {
    if (!isFull) { chrome.tabs.create({ url: 'popup.html?full' }); window.close(); return; }
    menu.hidden = true;
    $('#importFile').click();
  };
  $('#importFile').onchange = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) importChunks(file);
  };

  const name = $('#chunkName');
  name.placeholder = defaultName();
  name.oninput = () => { state.nameTouched = name.value.length > 0; };
  name.onkeydown = (e) => { if (e.key === 'Enter') save(true); };

  $('#selectAll').onchange = (e) => setSelected(visibleTabs(), e.target.checked);
  $('#tabFilter').oninput = (e) => { state.filter = e.target.value; renderTabs(); };
  $('#saveKeep').onclick = () => save(false);
  $('#saveClose').onclick = () => save(true);

  $('#search').oninput = (e) => { state.query = e.target.value; renderChunks(); };

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);
    if (e.key === '/' && !typing) {
      e.preventDefault();
      setView('saved');
      $('#search').focus();
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.chunks) return;
    state.chunks = changes.chunks.newValue || [];
    if (state.editing) return; // don't yank the rename box away mid-edit
    renderChunks();
  });

  let refresh;
  const scheduleRefresh = () => { clearTimeout(refresh); refresh = setTimeout(() => loadTabs(), 150); };
  chrome.tabs.onCreated.addListener(scheduleRefresh);
  chrome.tabs.onRemoved.addListener(scheduleRefresh);
  chrome.tabs.onMoved.addListener(scheduleRefresh);
  chrome.tabs.onAttached.addListener(scheduleRefresh);
  chrome.tabs.onDetached.addListener(scheduleRefresh);
  chrome.tabs.onUpdated.addListener((_id, info) => {
    if (info.title || info.url || info.groupId !== undefined || info.pinned !== undefined) scheduleRefresh();
  });
  chrome.tabGroups.onUpdated.addListener(scheduleRefresh);
}

async function init() {
  document.body.classList.toggle('full', isFull);
  state.windowId = (await chrome.windows.getCurrent()).id;

  const data = await chrome.storage.local.get(['chunks', 'settings', 'lastView']);
  state.chunks = data.chunks || [];
  Object.assign(state.settings, data.settings);

  bind();
  renderColors();
  await loadTabs(true);
  renderChunks();
  setView(data.lastView === 'saved' && state.chunks.length ? 'saved' : 'save');
  if (!$('#savePane').hidden) $('#chunkName').focus();
}

init();
