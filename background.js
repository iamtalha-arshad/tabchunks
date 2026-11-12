'use strict';

// All tab-mutating work happens here, not in the popup: the popup can close
// mid-operation (e.g. when a new window takes focus) and would abort the job.

const SELF_URL = chrome.runtime.getURL('');
const DEFAULT_SETTINGS = { restoreAsGroup: true, deleteAfterRestore: false };

const getChunks = async () => (await chrome.storage.local.get('chunks')).chunks || [];
const setChunks = (chunks) => chrome.storage.local.set({ chunks });
const getSettings = async () => ({ ...DEFAULT_SETTINGS, ...(await chrome.storage.local.get('settings')).settings });

function defaultName() {
  const when = new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `Chunk · ${when}`;
}

async function saveTabs({ tabIds, name, color = 'blue', close }) {
  const tabs = (await Promise.all(tabIds.map((id) => chrome.tabs.get(id).catch(() => null))))
    .filter(Boolean)
    .sort((a, b) => a.windowId - b.windowId || a.index - b.index);
  if (!tabs.length) throw new Error('No tabs to save');

  // Remember each tab's Chrome group so restore can rebuild exactly those groups.
  const groupIds = [...new Set(tabs.map((t) => t.groupId).filter((id) => id !== -1))];
  const groups = (await Promise.all(groupIds.map((id) => chrome.tabGroups.get(id).catch(() => null))))
    .filter(Boolean)
    .map((g) => ({ id: g.id, title: g.title || '', color: g.color, collapsed: g.collapsed }));
  const groupIndex = new Map(groups.map((g, i) => [g.id, i]));

  const chunk = {
    id: crypto.randomUUID(),
    name: (name || '').trim() || defaultName(),
    color,
    createdAt: Date.now(),
    groups: groups.map(({ id, ...g }) => g),
    tabs: tabs.map((t) => ({
      url: t.url || t.pendingUrl,
      title: t.title || t.url,
      pinned: t.pinned,
      group: groupIndex.has(t.groupId) ? groupIndex.get(t.groupId) : null,
    })),
  };
  await setChunks([chunk, ...(await getChunks())]);
  if (close) await closeTabs(tabs);
  return { chunk };
}

async function closeTabs(tabs) {
  const ids = new Set(tabs.map((t) => t.id));
  // Closing every tab in a window would close the window itself; leave a fresh tab behind.
  for (const windowId of new Set(tabs.map((t) => t.windowId))) {
    const all = await chrome.tabs.query({ windowId });
    if (all.every((t) => ids.has(t.id))) await chrome.tabs.create({ windowId, active: true });
  }
  await chrome.tabs.remove([...ids]);
}

async function restoreChunk({ id, newWindow }) {
  const chunks = await getChunks();
  const chunk = chunks.find((c) => c.id === id);
  if (!chunk) throw new Error('Chunk not found');
  const settings = await getSettings();

  let windowId;
  let created;
  if (newWindow) {
    const win = await chrome.windows.create({ url: chunk.tabs.map((t) => t.url), focused: true });
    windowId = win.id;
    created = win.tabs;
    await Promise.all(chunk.tabs.map((t, i) => t.pinned && chrome.tabs.update(created[i].id, { pinned: true })));
  } else {
    windowId = (await chrome.windows.getLastFocused({ windowTypes: ['normal'] })).id;
    created = [];
    for (const t of chunk.tabs) {
      created.push(await chrome.tabs.create({ windowId, url: t.url, pinned: !!t.pinned, active: false }));
    }
  }

  // Rebuild only the groups the tabs were in when saved; ungrouped tabs stay loose.
  if (settings.restoreAsGroup) {
    const groups = chunk.groups || [];
    for (const [index, group] of groups.entries()) {
      const tabIds = created.filter((_, i) => chunk.tabs[i].group === index && !chunk.tabs[i].pinned).map((t) => t.id);
      if (!tabIds.length) continue;
      const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
      await chrome.tabGroups.update(groupId, { title: group.title, color: group.color || 'grey', collapsed: !!group.collapsed });
    }
  }

  if (settings.deleteAfterRestore) await setChunks(chunks.filter((c) => c.id !== id));
  if (!newWindow && created.length) await chrome.tabs.update(created[0].id, { active: true });
  return { removed: settings.deleteAfterRestore };
}

const handlers = { save: saveTabs, restore: restoreChunk };

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  handler(msg).then(
    (result) => sendResponse({ ok: true, ...result }),
    (err) => sendResponse({ ok: false, error: err?.message || String(err) }),
  );
  return true;
});

async function flashBadge(text) {
  await chrome.action.setBadgeBackgroundColor({ color: '#5b5bd6' });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2000);
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'save-window') return;
  const tabs = (await chrome.tabs.query({ currentWindow: true, pinned: false }))
    .filter((t) => !(t.url || '').startsWith(SELF_URL));
  if (!tabs.length) return;
  await saveTabs({ tabIds: tabs.map((t) => t.id), close: true });
  flashBadge(String(tabs.length));
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'open-full', title: 'Open TabChunks full view', contexts: ['action'] });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'open-full') chrome.tabs.create({ url: 'popup.html?full' });
});
