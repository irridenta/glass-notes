/* App shell: data, sidebar tree, views (home / page / trash / templates / settings), search, sharing. */
(function () {
  const { h, ICONS } = UI;
  const $ = (id) => document.getElementById(id);
  const plat = (window.desk && window.desk.platform) || 'win32';
  document.body.classList.add(plat === 'darwin' ? 'mac' : plat === 'win32' ? 'win' : 'linux');

  const SEARCH_ICON = '<svg viewBox="0 0 20 20"><circle cx="9" cy="9" r="5.5"/><path d="m13.2 13.2 3.3 3.3"/></svg>';
  let db = null;
  let view = { name: 'home' };
  let editor = null;
  let saveTimer = null;
  let dirty = false;

  /* ---------- data ---------- */
  const pages = () => db.pages;
  const get = (id) => db.pages[id];
  const childrenOf = (id) => (id ? get(id)?.children || [] : db.root);
  const isAlive = (p) => { while (p) { if (p.trashed) return false; p = p.parentId ? get(p.parentId) : null; } return true; };
  const pathOf = (p) => { const out = []; let c = p; while (c) { out.unshift(c); c = c.parentId ? get(c.parentId) : null; } return out; };
  const descendants = (id) => { const out = []; const walk = (x) => (get(x)?.children || []).forEach((c) => { out.push(c); walk(c); }); walk(id); return out; };
  const titleOf = (p) => p.title || 'Untitled';
  const plain = (html) => { const d = document.createElement('div'); d.innerHTML = html || ''; return d.textContent; };
  const snippet = (p) => (p.blocks || []).filter((b) => b.type !== 'code').map((b) => plain(b.html)).filter(Boolean).join(' · ').slice(0, 160);
  const words = (p) => (p.blocks || []).map((b) => plain(b.html)).join(' ').split(/\s+/).filter(Boolean).length;

  function ago(t) {
    const s = (Date.now() - t) / 1000;
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    if (s < 86400 * 7) return Math.round(s / 86400) + 'd ago';
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  }

  async function load() {
    let data = null;
    try { data = await window.desk.load(); } catch {}
    if (!data || !data.pages) {
      const seed = GN.welcome();
      data = { version: 1, pages: {}, root: [seed[0].id], recent: [seed[0].id], settings: { sidebar: true, motion: true, expanded: { [seed[0].id]: true } } };
      seed.forEach((p) => (data.pages[p.id] = p));
      db = data;
      save(true);
    }
    db = data;
    db.settings = { sidebar: true, motion: true, expanded: {}, ...(db.settings || {}) };
    db.recent = (db.recent || []).filter((id) => db.pages[id]);
    db.root = (db.root || []).filter((id) => db.pages[id]);
    // Repair: any page whose parent vanished goes to the top level.
    Object.values(db.pages).forEach((p) => {
      p.children = (p.children || []).filter((c) => db.pages[c]);
      if (p.parentId && !db.pages[p.parentId]) p.parentId = null;
      if (!p.parentId && !db.root.includes(p.id)) db.root.push(p.id);
    });
  }

  function save(now = false) {
    dirty = true;
    clearTimeout(saveTimer);
    $('saveState').textContent = 'Saving…';
    const run = async () => {
      if (!dirty) return;
      dirty = false;
      try {
        await window.desk.save(JSON.stringify(db));
        $('saveState').textContent = 'Saved';
      } catch (err) {
        $('saveState').textContent = 'Not saved';
        UI.toast('Could not save your notes: ' + (err.message || err));
      }
    };
    if (now) return run();
    saveTimer = setTimeout(run, 450);
  }
  async function flush() { if (dirty) { clearTimeout(saveTimer); dirty = true; await save(true); } }
  window.desk.onFlush && window.desk.onFlush(async () => { await flush(); window.desk.flushed(); });

  function touch(p) { p.updatedAt = Date.now(); save(); }

  /* ---------- page operations ---------- */
  function createPage({ parentId = null, template = 'blank', open = true, index } = {}) {
    const t = GN.TEMPLATES.find((x) => x.key === template) || GN.TEMPLATES[0];
    const made = t.make();
    const now = Date.now();
    const p = { id: GN.uid(), parentId, children: [], favorite: false, trashed: false, createdAt: now, updatedAt: now, font: 'sans', wide: false, ...made };
    db.pages[p.id] = p;
    const list = childrenOf(parentId);
    if (index == null) list.push(p.id); else list.splice(index, 0, p.id);
    if (parentId) db.settings.expanded[parentId] = true;
    save();
    renderSidebar();
    if (open) openPage(p.id, { focusTitle: !p.title });
    return p;
  }

  function trashPage(id) {
    const p = get(id);
    if (!p) return;
    p.trashed = true;
    p.trashedAt = Date.now();
    save();
    const cur = view.name === 'page' ? get(view.id) : null;
    if (cur && !isAlive(cur)) p.parentId && isAlive(get(p.parentId)) ? openPage(p.parentId) : showHome();
    renderSidebar();
    if (view.name === 'trash') showTrash();
    UI.toast(`Moved “${titleOf(p)}” to Trash`, { action: 'Undo', onAction: () => restorePage(id, true) });
  }

  function restorePage(id, quiet) {
    const p = get(id);
    if (!p) return;
    p.trashed = false;
    delete p.trashedAt;
    if (p.parentId && !isAlive(get(p.parentId))) {
      get(p.parentId).children = get(p.parentId).children.filter((c) => c !== id);
      p.parentId = null;
      db.root.push(id);
    }
    save();
    renderSidebar();
    if (view.name === 'trash') showTrash();
    if (!quiet) UI.toast(`Restored “${titleOf(p)}”`);
  }

  function deleteForever(id) {
    const p = get(id);
    if (!p) return;
    [id, ...descendants(id)].forEach((x) => delete db.pages[x]);
    if (p.parentId && get(p.parentId)) get(p.parentId).children = get(p.parentId).children.filter((c) => c !== id);
    db.root = db.root.filter((c) => c !== id);
    db.recent = db.recent.filter((c) => db.pages[c]);
    save();
    renderSidebar();
  }

  function duplicatePage(id) {
    const src = get(id);
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = GN.uid();
    copy.title = (src.title || 'Untitled') + ' (copy)';
    copy.children = [];
    copy.favorite = false;
    copy.createdAt = copy.updatedAt = Date.now();
    copy.blocks = (copy.blocks || []).map((b) => ({ ...b, id: GN.uid() }));
    db.pages[copy.id] = copy;
    const list = childrenOf(src.parentId);
    list.splice(list.indexOf(id) + 1, 0, copy.id);
    save();
    renderSidebar();
    openPage(copy.id);
  }

  function movePage(id, parentId, index) {
    const p = get(id);
    if (!p || id === parentId || (parentId && descendants(id).includes(parentId))) return;
    const from = childrenOf(p.parentId);
    const oldIndex = from.indexOf(id);
    from.splice(oldIndex, 1);
    const to = childrenOf(parentId);
    if (p.parentId === parentId && index > oldIndex) index--;
    to.splice(index == null ? to.length : Math.max(0, Math.min(index, to.length)), 0, id);
    p.parentId = parentId;
    if (parentId) db.settings.expanded[parentId] = true;
    save();
    renderSidebar();
    if (view.name === 'page') renderCrumbs();
  }

  function toggleFavorite(id) {
    const p = get(id);
    p.favorite = !p.favorite;
    save();
    renderSidebar();
    updateTopbar();
    UI.toast(p.favorite ? 'Added to Favorites' : 'Removed from Favorites');
  }

  /* ---------- sidebar ---------- */
  function pageIcon(p, size) {
    return p.icon ? h('span', { class: 'tree-icon', text: p.icon }) : h('span', { class: 'tree-icon', html: ICONS.page, style: { color: 'var(--text-3)', display: 'grid', placeItems: 'center' } });
  }

  function renderSidebar() {
    const tree = $('pageTree');
    const fav = $('favTree');
    tree.innerHTML = '';
    fav.innerHTML = '';
    const draw = (ids, depth, into, allowNest) => {
      ids.forEach((id) => {
        const p = get(id);
        if (!p || p.trashed) return;
        const kids = (p.children || []).filter((c) => get(c) && !get(c).trashed);
        const expanded = allowNest && db.settings.expanded[id];
        into.append(treeRow(p, depth, kids.length > 0 && allowNest, expanded));
        if (expanded && kids.length) draw(kids, depth + 1, into, true);
      });
    };
    draw(db.root, 0, tree, true);
    if (!tree.children.length) tree.append(h('div', { class: 'tree-empty', text: 'No pages yet' }));
    const favs = Object.values(db.pages).filter((p) => p.favorite && isAlive(p));
    $('favSection').style.display = favs.length ? '' : 'none';
    draw(favs.map((p) => p.id), 0, fav, false);
    const nTrash = Object.values(db.pages).filter((p) => p.trashed).length;
    $('trashCount').textContent = nTrash || '';
  }

  function treeRow(p, depth, hasKids, expanded) {
    const active = view.name === 'page' && view.id === p.id;
    const twisty = h('button', { class: 'twisty' + (expanded ? ' open' : '') + (hasKids ? '' : ' empty'), html: ICONS.chev,
      onclick: (e) => { e.stopPropagation(); db.settings.expanded[p.id] = !expanded; save(); renderSidebar(); } });
    const row = h('div', { class: 'tree-row' + (active ? ' active' : ''), style: { paddingLeft: 4 + depth * 14 + 'px' }, draggable: 'true', 'data-id': p.id },
      twisty, pageIcon(p),
      h('span', { class: 'tree-title' + (p.title ? '' : ' untitled'), text: titleOf(p) }),
      h('span', { class: 'row-tools' },
        h('button', { title: 'More', html: ICONS.more, onclick: (e) => { e.stopPropagation(); pageMenu(p, e.currentTarget.getBoundingClientRect()); } }),
        h('button', { title: 'Add a page inside', html: ICONS.plus, onclick: (e) => { e.stopPropagation(); createPage({ parentId: p.id }); } })));
    row.addEventListener('click', () => openPage(p.id));
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); pageMenu(p, { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 }); });
    // drag & drop to reorganise
    row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-gn-page', p.id); e.dataTransfer.effectAllowed = 'move'; dragPage = p.id; });
    row.addEventListener('dragend', () => { dragPage = null; clearTreeDrop(); });
    row.addEventListener('dragover', (e) => {
      if (!dragPage || dragPage === p.id) return;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      clearTreeDrop();
      row.classList.add(y < 0.28 ? 'drop-before' : y > 0.72 ? 'drop-after' : 'drop-in');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after', 'drop-in'));
    row.addEventListener('drop', (e) => {
      if (!dragPage) return;
      e.preventDefault();
      const mode = row.classList.contains('drop-before') ? 'before' : row.classList.contains('drop-after') ? 'after' : 'in';
      clearTreeDrop();
      if (mode === 'in') movePage(dragPage, p.id, null);
      else {
        const list = childrenOf(p.parentId);
        movePage(dragPage, p.parentId, list.indexOf(p.id) + (mode === 'after' ? 1 : 0));
      }
    });
    return row;
  }
  let dragPage = null;
  const clearTreeDrop = () => document.querySelectorAll('.tree-row').forEach((r) => r.classList.remove('drop-before', 'drop-after', 'drop-in'));

  function pageMenu(p, rect) {
    UI.menu([
      { label: 'Open', icon: 'page', action: () => openPage(p.id) },
      { label: 'Add page inside', icon: 'plus', action: () => createPage({ parentId: p.id }) },
      { label: p.favorite ? 'Remove from Favorites' : 'Add to Favorites', icon: 'star', action: () => toggleFavorite(p.id) },
      { label: 'Duplicate', icon: 'copy', action: () => duplicatePage(p.id) },
      { label: 'Export…', icon: 'globe', action: () => { openPage(p.id); setTimeout(() => shareMenu(), 50); } },
      p.parentId ? { label: 'Move to top level', icon: 'up', action: () => movePage(p.id, null) } : null,
      'sep',
      { label: 'Move to Trash', icon: 'trash', danger: true, action: () => trashPage(p.id) },
    ].filter(Boolean), rect, { compact: true });
  }

  /* ---------- top bar ---------- */
  function renderCrumbs() {
    const c = $('crumbs');
    c.innerHTML = '';
    if (view.name !== 'page') {
      const names = { home: 'Home', trash: 'Trash', settings: 'Settings', templates: 'Templates' };
      c.append(h('span', { class: 'crumb', text: names[view.name] || '' }));
      return;
    }
    const path = pathOf(get(view.id));
    const shown = path.length > 3 ? [path[0], null, ...path.slice(-2)] : path;
    shown.forEach((p, i) => {
      if (i) c.append(h('span', { class: 'crumb-sep', text: '/' }));
      if (!p) { c.append(h('span', { class: 'crumb', text: '…' })); return; }
      c.append(h('button', { class: 'crumb', onclick: () => openPage(p.id) }, p.icon ? p.icon + ' ' : '', titleOf(p)));
    });
  }

  function updateTopbar() {
    const isPage = view.name === 'page';
    $('shareBtn').style.display = isPage ? '' : 'none';
    $('favBtn').style.display = isPage ? '' : 'none';
    $('moreBtn').style.display = isPage ? '' : 'none';
    if (isPage) {
      const p = get(view.id);
      $('favBtn').classList.toggle('on', !!p.favorite);
      $('favBtn').title = p.favorite ? 'Remove from favorites' : 'Add to favorites';
    }
    renderCrumbs();
  }

  /* ---------- views ---------- */
  function setView(v) {
    if (editor) { editor.destroy(); editor = null; }
    UI.closeAll();
    view = v;
    $('view').innerHTML = '';
    $('scroller').scrollTop = 0;
    updateTopbar();
    renderSidebar();
  }

  function showHome() {
    setView({ name: 'home' });
    document.title = 'Glass Notes';
    const hr = new Date().getHours();
    const part = hr < 5 ? 'night' : hr < 12 ? 'morning' : hr < 18 ? 'afternoon' : 'evening';
    const alive = Object.values(db.pages).filter(isAlive);
    const recent = [...new Set([...db.recent, ...alive.sort((a, b) => b.updatedAt - a.updatedAt).map((p) => p.id)])]
      .map(get).filter((p) => p && isAlive(p)).slice(0, 8);
    const v = h('div', { class: 'home-view' },
      h('h1', { class: 'hello', html: `Good <em>${part}</em>` }),
      h('p', { class: 'hello-sub', text: `${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · ${alive.length} ${alive.length === 1 ? 'page' : 'pages'}` }),
      h('div', { class: 'home-actions' },
        h('button', { class: 'primary-btn', onclick: () => createPage() }, h('span', { html: ICONS.plus }), 'New page'),
        h('button', { class: 'ghost-btn', style: { height: '36px' }, onclick: () => palette() }, h('span', { html: SEARCH_ICON, style: { display: 'grid' } }), 'Search', h('kbd', { text: 'Ctrl K' }))),
      h('section', { class: 'home-section' }, h('h3', { text: 'Jump back in' }),
        recent.length ? h('div', { class: 'cards' }, ...recent.map(pageCard)) : h('div', { class: 'empty-state', text: 'Your pages will show up here.' })),
      h('section', { class: 'home-section' }, h('h3', { text: 'Start from a template' }), templateCards()));
    $('view').append(v);
  }

  function pageCard(p) {
    const cover = p.cover && GN.COVERS[p.cover] ? GN.COVERS[p.cover].css : 'linear-gradient(120deg, rgba(255,255,255,.06), rgba(255,255,255,.02))';
    return h('button', { class: 'card', onclick: () => openPage(p.id) },
      h('div', { class: 'card-cover', style: { background: cover } }),
      h('div', { class: 'card-icon', text: p.icon || '📄' }),
      h('div', { class: 'card-body' },
        h('div', { class: 'card-title', text: titleOf(p) }),
        h('div', { class: 'card-snip', text: snippet(p) || 'Empty page' }),
        h('div', { class: 'card-time', text: 'Edited ' + ago(p.updatedAt) })));
  }

  function templateCards(onPick) {
    return h('div', { class: 'cards' }, ...GN.TEMPLATES.map((t) => h('button', { class: 'card tpl-card', onclick: () => (onPick ? onPick(t.key) : createPage({ template: t.key })) },
      h('div', { class: 'tpl-icon', text: t.icon }), h('div', { class: 'card-title', text: t.name }), h('div', { class: 'card-snip', text: t.desc }))));
  }

  function showTemplates() {
    setView({ name: 'templates' });
    document.title = 'Templates — Glass Notes';
    $('view').append(h('div', { class: 'list-view', style: { maxWidth: '1040px' } },
      h('h1', { text: 'Templates' }), h('p', { class: 'lead', text: 'Pick a starting point. Everything in it can be changed.' }), templateCards()));
  }

  function openPage(id, { focusTitle = false } = {}) {
    const p = get(id);
    if (!p || !isAlive(p)) return showHome();
    setView({ name: 'page', id });
    db.recent = [id, ...db.recent.filter((x) => x !== id)].slice(0, 16);
    save();
    document.title = titleOf(p) + ' — Glass Notes';

    const v = h('div', { class: 'page-view' });
    const applyClasses = () => {
      v.className = 'page-view' + (p.cover ? ' has-cover' : '') + (p.wide ? ' wide' : '') + (p.small ? ' small' : '') + (p.font && p.font !== 'sans' ? ' font-' + p.font : '');
    };
    applyClasses();

    // cover
    const coverEl = h('div', { class: 'cover' });
    const drawCover = () => {
      coverEl.style.display = p.cover ? '' : 'none';
      if (p.cover && GN.COVERS[p.cover]) coverEl.style.background = GN.COVERS[p.cover].css;
    };
    coverEl.append(h('div', { class: 'cover-tools' },
      h('button', { class: 'chip', onclick: (e) => UI.coverPicker(e.currentTarget.getBoundingClientRect(), setCover) }, 'Change cover'),
      h('button', { class: 'chip', onclick: () => setCover(null) }, 'Remove')));
    const setCover = (key) => { p.cover = key; drawCover(); applyClasses(); drawTools(); touch(p); };
    drawCover();

    // icon + tools + title
    const iconEl = h('div', { class: 'page-icon', title: 'Change icon' });
    const drawIcon = () => { iconEl.textContent = p.icon || ''; iconEl.style.display = p.icon ? '' : 'none'; };
    const pickIcon = (rect) => UI.emojiPicker(rect, (e) => { p.icon = e; drawIcon(); drawTools(); renderSidebar(); renderCrumbs(); touch(p); });
    iconEl.addEventListener('click', () => pickIcon(iconEl.getBoundingClientRect()));
    drawIcon();

    const tools = h('div', { class: 'head-tools' });
    const drawTools = () => {
      tools.innerHTML = '';
      if (!p.icon) tools.append(h('button', { class: 'tool', onclick: (e) => pickIcon(e.currentTarget.getBoundingClientRect()) }, h('span', { html: ICONS.smile }), 'Add icon'));
      if (!p.cover) tools.append(h('button', { class: 'tool', onclick: () => setCover(Object.keys(GN.COVERS)[Math.floor(Math.random() * 8)]) }, h('span', { html: ICONS.image }), 'Add cover'));
    };
    drawTools();

    const title = h('h1', { class: 'page-title', contenteditable: 'plaintext-only', spellcheck: 'true' });
    title.textContent = p.title || '';
    title.addEventListener('input', () => {
      p.title = title.textContent.replace(/\n/g, ' ');
      if (!title.textContent) title.innerHTML = '';
      document.title = titleOf(p) + ' — Glass Notes';
      const row = document.querySelector(`.tree-row[data-id="${p.id}"] .tree-title`);
      if (row) { row.textContent = titleOf(p); row.classList.toggle('untitled', !p.title); }
      renderCrumbs();
      touch(p);
      hideStarter();
    });
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || (e.key === 'ArrowDown')) { e.preventDefault(); editor.focusStart(); }
    });
    title.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\s*\n\s*/g, ' ')); });

    const meta = h('div', { class: 'page-meta' });
    const drawMeta = () => { meta.textContent = `Edited ${ago(p.updatedAt)} · ${words(p)} words`; };
    drawMeta();

    const inner = h('div', { class: 'page-inner' });
    const head = h('div', { class: 'page-head' }, iconEl, tools, title, meta);
    const body = h('div', { class: 'page-body' });
    inner.append(head, body);
    v.append(coverEl, inner);
    $('view').append(v);

    let metaTimer;
    editor = new Editor(body, p, {
      onChange: () => { touch(p); hideStarter(); clearTimeout(metaTimer); metaTimer = setTimeout(drawMeta, 600); },
      onFocusTitle: () => { title.focus(); const r = document.createRange(); r.selectNodeContents(title); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); },
    });

    // Fresh, empty page: offer templates right in the page.
    let starter = null;
    const hideStarter = () => { if (starter) { starter.remove(); starter = null; } };
    const blank = !p.title && p.blocks.length === 1 && !p.blocks[0].html && p.blocks[0].type === 'p';
    if (blank) {
      starter = h('div', { class: 'starter' },
        h('div', { class: 'side-label', style: { padding: '0', marginBottom: '10px' }, text: 'Or start with a template' }),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } },
          ...GN.TEMPLATES.slice(1).map((t) => h('button', { class: 'ghost-btn', onclick: () => applyTemplate(p, t.key) }, t.icon + ' ' + t.name))));
      starter.style.marginTop = '8px';
      inner.append(starter);
    }

    // Subpages
    const kids = (p.children || []).map(get).filter((c) => c && !c.trashed);
    if (kids.length) {
      inner.append(h('div', { class: 'subpages' }, h('h4', { text: 'Pages inside' }),
        ...kids.map((c) => h('div', { class: 'subpage-link', onclick: () => openPage(c.id) }, h('span', { text: c.icon || '📄' }), h('span', { text: titleOf(c) })))));
    }

    if (focusTitle) setTimeout(() => title.focus());
  }

  function applyTemplate(p, key) {
    const t = GN.TEMPLATES.find((x) => x.key === key);
    Object.assign(p, t.make());
    touch(p);
    renderSidebar();
    openPage(p.id);
  }

  function showTrash() {
    setView({ name: 'trash' });
    document.title = 'Trash — Glass Notes';
    const items = Object.values(db.pages).filter((p) => p.trashed).sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0));
    const list = h('div', { class: 'list' });
    items.forEach((p) => {
      const n = descendants(p.id).length;
      list.append(h('div', { class: 'list-row' },
        h('span', { style: { fontSize: '20px' }, text: p.icon || '📄' }),
        h('div', { class: 'grow' }, h('div', { class: 't', text: titleOf(p) }),
          h('div', { class: 's', text: `Deleted ${ago(p.trashedAt || p.updatedAt)}${n ? ` · with ${n} page${n > 1 ? 's' : ''} inside` : ''}` })),
        h('button', { class: 'ghost-btn', onclick: () => restorePage(p.id) }, h('span', { html: ICONS.restore }), 'Restore'),
        h('button', { class: 'icon-btn danger-btn', title: 'Delete forever', html: ICONS.trash, onclick: async () => {
          if (await UI.confirm({ title: 'Delete forever?', text: `“${titleOf(p)}”${n ? ` and the ${n} page${n > 1 ? 's' : ''} inside it` : ''} will be permanently deleted. This can't be undone.`, ok: 'Delete forever', danger: true })) {
            deleteForever(p.id); showTrash();
          }
        } })));
    });
    $('view').append(h('div', { class: 'list-view' },
      h('h1', { text: 'Trash' }),
      h('p', { class: 'lead', text: items.length ? 'Deleted pages wait here until you restore them or remove them for good.' : 'Nothing in the trash.' }),
      list,
      items.length > 1 ? h('div', { style: { marginTop: '18px', textAlign: 'right' } }, h('button', { class: 'ghost-btn danger-btn', onclick: async () => {
        if (await UI.confirm({ title: 'Empty trash?', text: `All ${items.length} pages in the trash will be permanently deleted.`, ok: 'Empty trash', danger: true })) {
          items.forEach((p) => deleteForever(p.id)); showTrash();
        }
      } }, 'Empty trash')) : null));
  }

  async function showSettings() {
    setView({ name: 'settings' });
    document.title = 'Settings — Glass Notes';
    const loc = await window.desk.dataLocation();
    const seg = (opts, cur, onPick) => {
      const el = h('div', { class: 'seg' });
      opts.forEach(([k, label]) => el.append(h('button', { class: k === cur ? 'on' : '', onclick: (ev) => { onPick(k); el.querySelectorAll('button').forEach((b) => b.classList.remove('on')); ev.currentTarget.classList.add('on'); } }, label)));
      return el;
    };
    const all = Object.values(db.pages);
    $('view').append(h('div', { class: 'list-view' },
      h('h1', { text: 'Settings' }), h('p', { class: 'lead', text: 'Glass Notes keeps everything on this computer. No account, no cloud.' }),
      h('div', { class: 'setting' },
        h('div', {}, h('div', { class: 't', text: 'Background motion' }), h('div', { class: 's', text: 'Slowly drifting colour behind the glass. Turn off to save battery.' })),
        seg([['on', 'On'], ['off', 'Off']], db.settings.motion ? 'on' : 'off', (k) => { db.settings.motion = k === 'on'; applyMotion(); save(); })),
      h('div', { class: 'setting' },
        h('div', { style: { minWidth: 0 } }, h('div', { class: 't', text: 'Where your notes are stored' }), h('div', { class: 's', text: loc })),
        h('button', { class: 'ghost-btn', onclick: () => window.desk.revealData() }, h('span', { html: ICONS.folder }), 'Show')),
      h('div', { class: 'setting' },
        h('div', {}, h('div', { class: 't', text: 'Backups' }), h('div', { class: 's', text: 'A copy of the previous version is kept next to your notes (notes.backup.json). To back up everything, copy notes.json somewhere safe.' }))),
      h('div', { class: 'setting' },
        h('div', {}, h('div', { class: 't', text: 'Your library' }), h('div', { class: 's', text: `${all.filter(isAlive).length} pages · ${all.reduce((n, p) => n + words(p), 0).toLocaleString()} words` })),
        h('span', { class: 's', style: { color: 'var(--text-3)', fontSize: '12.5px' }, text: 'Glass Notes 1.0' }))));
  }

  function applyMotion() { document.querySelectorAll('.orb').forEach((o) => (o.style.animationPlayState = db.settings.motion ? 'running' : 'paused')); }

  /* ---------- share / export ---------- */
  function shareMenu() {
    if (view.name !== 'page') return;
    const p = get(view.id);
    const rect = $('shareBtn').getBoundingClientRect();
    const head = h('div', { class: 'share-head' }, h('div', { class: 't', text: 'Share this page' }),
      h('div', { class: 's', text: 'Save a copy you can send to anyone. Your original stays private on this computer.' }));
    const m = UI.menu([
      { label: 'Web page', sub: 'Single .html file · opens in any browser', icon: 'globe', action: () => doExport(p, 'html') },
      { label: 'PDF document', sub: 'Light, print-ready A4', icon: 'pdf', action: () => doExport(p, 'pdf') },
    ], rect, { align: 'end', className: 'share-pop' });
    m.el.prepend(head);
    UI.place(m.el, rect, { align: 'end' });
  }

  async function doExport(p, kind) {
    await flush();
    const html = GNExport.exportDoc(p, { theme: kind === 'pdf' ? 'light' : 'dark' });
    try {
      const out = kind === 'pdf' ? await window.desk.exportPdf(titleOf(p), html) : await window.desk.exportHtml(titleOf(p), html);
      if (out) UI.toast(`Exported ${kind === 'pdf' ? 'PDF' : 'web page'}`, { action: 'Show file', onAction: () => window.desk.showFile(out), timeout: 6000 });
    } catch (err) {
      UI.toast('Export failed: ' + (err.message || err));
    }
  }

  function moreMenu() {
    const p = get(view.id);
    const set = (k, v) => () => { p[k] = v; touch(p); openPage(p.id); };
    UI.menu([
      { section: 'Style' },
      { label: 'Sans', icon: '<span style="font-family:var(--sans);font-weight:600">Ag</span>', on: !p.font || p.font === 'sans', action: set('font', 'sans') },
      { label: 'Serif', icon: '<span style="font-family:var(--serif);font-size:17px">Ag</span>', on: p.font === 'serif', action: set('font', 'serif') },
      { label: 'Mono', icon: '<span style="font-family:var(--mono);font-size:12px">Ag</span>', on: p.font === 'mono', action: set('font', 'mono') },
      'sep',
      { label: 'Small text', icon: 'font', on: !!p.small, action: set('small', !p.small) },
      { label: 'Full width', icon: 'width', on: !!p.wide, action: set('wide', !p.wide) },
      'sep',
      { label: p.favorite ? 'Remove from Favorites' : 'Add to Favorites', icon: 'star', action: () => toggleFavorite(p.id) },
      { label: 'Duplicate page', icon: 'copy', action: () => duplicatePage(p.id) },
      { label: 'Move to Trash', icon: 'trash', danger: true, action: () => trashPage(p.id) },
      { section: `${words(p)} words · created ${new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` },
    ], $('moreBtn').getBoundingClientRect(), { align: 'end', compact: true });
  }

  /* ---------- search palette ---------- */
  function palette() {
    UI.closeAll();
    if (document.querySelector('.modal-back')) return;
    const input = h('input', { placeholder: 'Search pages or type a command…', spellcheck: 'false' });
    const list = h('div', { class: 'palette-list' });
    const box = h('div', { class: 'pop palette' }, input, list,
      h('div', { class: 'palette-foot' }, h('span', {}, '↑↓ to move'), h('span', {}, 'Enter to open'), h('span', {}, 'Esc to close')));
    const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) close(); } }, box);
    let rows = [], hot = 0;
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
    const commands = [
      { label: 'New page', icon: 'plus', hint: 'Ctrl N', run: () => createPage() },
      { label: 'Go home', icon: 'home', run: showHome },
      { label: 'Templates', icon: 'tpl', run: showTemplates },
      { label: 'Toggle sidebar', icon: 'side', hint: 'Ctrl \\', run: toggleSidebar },
      { label: 'Export page as web page', icon: 'globe', when: () => view.name === 'page', run: () => doExport(get(view.id), 'html') },
      { label: 'Export page as PDF', icon: 'pdf', when: () => view.name === 'page', run: () => doExport(get(view.id), 'pdf') },
      { label: 'Open trash', icon: 'trash', run: showTrash },
      { label: 'Settings', icon: 'gear', run: showSettings },
    ].filter((c) => !c.when || c.when());
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      list.innerHTML = '';
      rows = [];
      const alive = Object.values(db.pages).filter(isAlive);
      let found;
      if (!q) {
        found = db.recent.map(get).filter((p) => p && isAlive(p)).slice(0, 6);
      } else {
        found = alive.map((p) => {
          const t = titleOf(p).toLowerCase();
          let score = t === q ? 100 : t.startsWith(q) ? 60 : t.includes(q) ? 40 : 0;
          let hit = '';
          if (!score) {
            const body = (p.blocks || []).map((b) => plain(b.html)).join(' ');
            const at = body.toLowerCase().indexOf(q);
            if (at >= 0) { score = 10; hit = (at > 30 ? '…' : '') + body.slice(Math.max(0, at - 30), at + 60); }
          }
          return { p, score, hit };
        }).filter((x) => x.score).sort((a, b) => b.score - a.score || b.p.updatedAt - a.p.updatedAt).slice(0, 12).map((x) => Object.assign(x.p, { _hit: x.hit }));
      }
      if (found.length) list.append(h('div', { class: 'pop-label', text: q ? 'Pages' : 'Recent' }));
      found.forEach((p) => {
        const path = pathOf(p).slice(0, -1).map(titleOf).join(' / ');
        addRow(h('span', { class: 'ico', text: p.icon || '📄' }),
          h('span', { class: 'lbl' }, titleOf(p), (p._hit || path) ? h('span', { class: 'sub', text: p._hit || path }) : null),
          () => openPage(p.id));
        delete p._hit;
      });
      const cmds = commands.filter((c) => !q || c.label.toLowerCase().includes(q));
      if (cmds.length) list.append(h('div', { class: 'pop-label', text: 'Commands' }));
      cmds.forEach((c) => addRow(h('span', { class: 'ico', html: ICONS[c.icon] }), h('span', { class: 'lbl', text: c.label }), c.run, c.hint));
      if (q && !found.length) {
        addRow(h('span', { class: 'ico', html: ICONS.plus }), h('span', { class: 'lbl' }, `Create page “${input.value.trim()}”`), () => {
          const p = createPage({ open: false }); p.title = input.value.trim(); save(); renderSidebar(); openPage(p.id);
        });
      }
      setHot(0);
    };
    const addRow = (ico, lbl, run, hint) => {
      const i = rows.length;
      const row = h('button', { class: 'pop-item', onmousemove: () => setHot(i), onclick: () => { close(); run(); } }, ico, lbl, hint ? h('span', { class: 'hint', text: hint }) : null);
      rows.push({ row, run });
      list.append(row);
    };
    const setHot = (i) => {
      if (!rows.length) return;
      hot = (i + rows.length) % rows.length;
      rows.forEach((r, k) => r.row.classList.toggle('hot', k === hot));
      rows[hot].row.scrollIntoView({ block: 'nearest' });
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setHot(hot + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setHot(hot - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); const r = rows[hot]; if (r) { close(); r.run(); } }
    };
    input.addEventListener('input', draw);
    document.addEventListener('keydown', onKey, true);
    $('layer').append(back);
    draw();
    input.focus();
  }

  /* ---------- sidebar toggle & shortcuts ---------- */
  function toggleSidebar() {
    db.settings.sidebar = !db.settings.sidebar;
    $('app').classList.toggle('side-hidden', !db.settings.sidebar);
    save();
  }

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if ((k === 'k' && !e.shiftKey) || k === 'p') { e.preventDefault(); palette(); }
    else if (k === 'n' && !e.shiftKey) { e.preventDefault(); createPage(); }
    else if (k === '\\') { e.preventDefault(); toggleSidebar(); }
    else if (k === 'e' && e.shiftKey) { e.preventDefault(); shareMenu(); }
    else if (k === 's') { e.preventDefault(); flush(); UI.toast('All changes are saved automatically'); }
  });

  // Never let a dropped file navigate the window away.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  $('collapseSide').onclick = toggleSidebar;
  $('expandSide').onclick = toggleSidebar;
  $('openSearch').onclick = () => palette();
  $('goHome').onclick = showHome;
  $('newPage').onclick = () => createPage();
  $('addRootPage').onclick = () => createPage();
  $('openTemplates').onclick = showTemplates;
  $('openTrash').onclick = showTrash;
  $('openSettings').onclick = showSettings;
  $('shareBtn').onclick = shareMenu;
  $('favBtn').onclick = () => toggleFavorite(view.id);
  $('moreBtn').onclick = moreMenu;

  // Keep "Edited 3m ago" style labels fresh.
  setInterval(() => {
    if (view.name === 'page') { const m = document.querySelector('.page-meta'); const p = get(view.id); if (m && p) m.textContent = `Edited ${ago(p.updatedAt)} · ${words(p)} words`; }
  }, 30000);

  (async () => {
    await load();
    $('app').classList.toggle('side-hidden', !db.settings.sidebar);
    applyMotion();
    renderSidebar();
    const first = db.recent[0] && get(db.recent[0]);
    if (first && isAlive(first)) openPage(first.id); else showHome();
    $('saveState').textContent = '';
  })();

  window.__gn = { get db() { return db; }, openPage, showHome, createPage, palette, showTrash, showSettings, showTemplates, shareMenu, doExport };
})();
