/* Small UI kit: popovers, keyboard menus, emoji/cover pickers, input popover, confirm dialog, toasts. */
(function () {
  const layer = () => document.getElementById('layer');
  const open = new Set();

  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  };

  const ICONS = {
    text: '<svg viewBox="0 0 20 20"><path d="M5 5.5h10M10 5.5v10"/></svg>',
    todo: '<svg viewBox="0 0 20 20"><rect x="3.5" y="3.5" width="13" height="13" rx="3.5"/><path d="m7 10.2 2.2 2.2L13.3 8"/></svg>',
    bullet: '<svg viewBox="0 0 20 20"><circle cx="5" cy="6" r="1.2" class="fill"/><circle cx="5" cy="14" r="1.2" class="fill"/><path d="M8.5 6h8M8.5 14h8"/></svg>',
    number: '<svg viewBox="0 0 20 20"><path d="M4 4.5h1.5v4M3.8 8.5h3.2M3.8 12.5c0-.8.6-1.3 1.4-1.3s1.4.5 1.4 1.2c0 1.2-2.8 1.8-2.8 3.1h2.9M9.5 6.5h7M9.5 14h7"/></svg>',
    quote: '<svg viewBox="0 0 20 20"><path d="M4.5 4.5v11M8.5 7h7.5M8.5 10h7.5M8.5 13h5"/></svg>',
    callout: '<svg viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="12" rx="3"/><path d="M6.5 8.5h7M6.5 11.5h4.5"/></svg>',
    code: '<svg viewBox="0 0 20 20"><path d="m7 6.5-3.5 3.5L7 13.5M13 6.5l3.5 3.5-3.5 3.5M11 5l-2 10"/></svg>',
    divider: '<svg viewBox="0 0 20 20"><path d="M3 10h14"/><path d="M6 6h8M6 14h8" opacity=".35"/></svg>',
    image: '<svg viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="12" rx="2.5"/><circle cx="7.5" cy="8.5" r="1.4"/><path d="m3.5 14 4-3.5 3 2.5 2.5-2 3.5 3"/></svg>',
    trash: '<svg viewBox="0 0 20 20"><path d="M4 6h12M8 6V4.5h4V6M5.5 6l.8 10h7.4l.8-10"/></svg>',
    copy: '<svg viewBox="0 0 20 20"><rect x="7" y="7" width="9.5" height="9.5" rx="2"/><path d="M13 7V5a1.5 1.5 0 0 0-1.5-1.5h-6.5A1.5 1.5 0 0 0 3.5 5v6.5A1.5 1.5 0 0 0 5 13h2"/></svg>',
    up: '<svg viewBox="0 0 20 20"><path d="M10 15.5v-11M5.5 9 10 4.5 14.5 9"/></svg>',
    down: '<svg viewBox="0 0 20 20"><path d="M10 4.5v11M5.5 11l4.5 4.5 4.5-4.5"/></svg>',
    star: '<svg viewBox="0 0 20 20"><path d="m10 3.3 2 4.2 4.6.6-3.4 3.2.9 4.6L10 13.6l-4.1 2.3.9-4.6-3.4-3.2 4.6-.6z"/></svg>',
    plus: '<svg viewBox="0 0 20 20"><path d="M10 4.5v11M4.5 10h11"/></svg>',
    page: '<svg viewBox="0 0 20 20"><path d="M5.5 3.5h6l3 3v10h-9z"/><path d="M11.5 3.5v3h3"/></svg>',
    globe: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.5"/><path d="M3.5 10h13M10 3.5c2 2 2.8 4.2 2.8 6.5S12 14.5 10 16.5C8 14.5 7.2 12.3 7.2 10S8 5.5 10 3.5z"/></svg>',
    pdf: '<svg viewBox="0 0 20 20"><path d="M5.5 3.5h6l3 3v10h-9z"/><path d="M11.5 3.5v3h3M7.5 11h5M7.5 13.5h3.5"/></svg>',
    eye: '<svg viewBox="0 0 20 20"><path d="M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5z"/><circle cx="10" cy="10" r="2.2"/></svg>',
    restore: '<svg viewBox="0 0 20 20"><path d="M4 9a6 6 0 1 1 1.5 4.5M4 4.5V9h4.5"/></svg>',
    edit: '<svg viewBox="0 0 20 20"><path d="M12.5 4.5 15.5 7.5 7.5 15.5H4.5v-3z"/></svg>',
    width: '<svg viewBox="0 0 20 20"><path d="M3.5 10h13M6.5 7 3.5 10l3 3M13.5 7l3 3-3 3"/></svg>',
    font: '<svg viewBox="0 0 20 20"><path d="M4 15.5 8.5 4.5h1L14 15.5M5.7 11.5h6.6"/></svg>',
    home: '<svg viewBox="0 0 20 20"><path d="M3.5 9 10 3.5 16.5 9v7a1 1 0 0 1-1 1h-3.5v-4.5h-4V17H4.5a1 1 0 0 1-1-1z"/></svg>',
    side: '<svg viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="12" rx="2.5"/><path d="M8 4v12"/></svg>',
    gear: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="2.5"/><path d="M10 2.8v2M10 15.2v2M2.8 10h2M15.2 10h2M4.9 4.9l1.4 1.4M13.7 13.7l1.4 1.4M4.9 15.1l1.4-1.4M13.7 6.3l1.4-1.4"/></svg>',
    tpl: '<svg viewBox="0 0 20 20"><rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1.2"/><rect x="11" y="3.5" width="5.5" height="5.5" rx="1.2"/><rect x="3.5" y="11" width="5.5" height="5.5" rx="1.2"/><rect x="11" y="11" width="5.5" height="5.5" rx="1.2"/></svg>',
    chev: '<svg viewBox="0 0 20 20"><path d="m8 5 5 5-5 5"/></svg>',
    more: '<svg viewBox="0 0 20 20"><circle cx="5" cy="10" r="1.2" class="fill"/><circle cx="10" cy="10" r="1.2" class="fill"/><circle cx="15" cy="10" r="1.2" class="fill"/></svg>',
    grip: '<svg viewBox="0 0 20 20"><circle cx="7.5" cy="5.5" r="1.1" class="fill"/><circle cx="12.5" cy="5.5" r="1.1" class="fill"/><circle cx="7.5" cy="10" r="1.1" class="fill"/><circle cx="12.5" cy="10" r="1.1" class="fill"/><circle cx="7.5" cy="14.5" r="1.1" class="fill"/><circle cx="12.5" cy="14.5" r="1.1" class="fill"/></svg>',
    check: '<svg viewBox="0 0 20 20"><path d="m5 10.5 3.2 3L15 6.5"/></svg>',
    smile: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.5"/><path d="M7.3 11.8c.7.9 1.6 1.4 2.7 1.4s2-.5 2.7-1.4"/><circle cx="7.8" cy="8.4" r=".9" class="fill"/><circle cx="12.2" cy="8.4" r=".9" class="fill"/></svg>',
    folder: '<svg viewBox="0 0 20 20"><path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.5H15a1.5 1.5 0 0 1 1.5 1.5v6.5A1.5 1.5 0 0 1 15 16H5a1.5 1.5 0 0 1-1.5-1.5z"/></svg>',
  };

  function place(el, rect, { align = 'start', gap = 6, prefer = 'below' } = {}) {
    layer().append(el);
    const w = el.offsetWidth, hgt = el.offsetHeight;
    const vw = innerWidth, vh = innerHeight;
    let x = align === 'end' ? rect.right - w : align === 'center' ? rect.left + rect.width / 2 - w / 2 : rect.left;
    let y = prefer === 'above' ? rect.top - hgt - gap : rect.bottom + gap;
    if (prefer === 'below' && y + hgt > vh - 10 && rect.top - hgt - gap > 10) y = rect.top - hgt - gap;
    if (prefer === 'above' && y < 10) y = rect.bottom + gap;
    x = Math.max(10, Math.min(x, vw - w - 10));
    y = Math.max(10, Math.min(y, vh - hgt - 10));
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }

  // Generic popover that closes on outside click or Escape.
  function popover(el, rect, opts = {}) {
    if (!opts.keepOthers) closeAll();
    place(el, rect, opts);
    const close = () => {
      if (!open.has(api)) return;
      open.delete(api);
      el.remove();
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      opts.onClose && opts.onClose();
    };
    const onDown = (e) => { if (!el.contains(e.target) && !(opts.ignore && opts.ignore.contains(e.target))) close(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); opts.onEscape && opts.onEscape(); } };
    setTimeout(() => document.addEventListener('mousedown', onDown, true));
    if (!opts.noEscape) document.addEventListener('keydown', onKey, true);
    const api = { el, close, reposition: (r) => place(el, r, opts) };
    open.add(api);
    return api;
  }

  function closeAll() { [...open].forEach((p) => p.close()); }
  function anyOpen() { return open.size > 0; }

  /* Keyboard-navigable menu.
     items: { label, icon, hint, sub, danger, on, action, keywords } | 'sep' | { section } */
  function menu(items, rect, opts = {}) {
    const el = h('div', { class: 'pop' + (opts.className ? ' ' + opts.className : '') });
    let rows = [];
    let hot = 0;
    const render = (list) => {
      el.innerHTML = '';
      rows = [];
      list.forEach((it) => {
        if (it === 'sep') { el.append(h('div', { class: 'pop-sep' })); return; }
        if (it.section) { el.append(h('div', { class: 'pop-label', text: it.section })); return; }
        const row = h('button', { class: 'pop-item' + (opts.compact ? ' compact' : '') + (it.danger ? ' danger' : '') + (it.on ? ' on' : '') });
        if (it.icon != null) row.append(h('span', { class: 'ico', html: ICONS[it.icon] || it.icon }));
        const lbl = h('span', { class: 'lbl' }, it.label);
        if (it.sub) lbl.append(h('span', { class: 'sub', text: it.sub }));
        row.append(lbl);
        if (it.hint) row.append(h('span', { class: 'hint', text: it.hint }));
        const idx = rows.length;
        row.addEventListener('mousemove', () => setHot(idx));
        row.addEventListener('mousedown', (e) => e.preventDefault());
        row.addEventListener('click', () => choose(idx));
        rows.push({ row, it });
        el.append(row);
      });
      if (!rows.length) el.append(h('div', { class: 'pop-empty', text: opts.emptyText || 'No results' }));
      setHot(0);
    };
    const setHot = (i) => {
      if (!rows.length) return;
      hot = (i + rows.length) % rows.length;
      rows.forEach((r, k) => r.row.classList.toggle('hot', k === hot));
      rows[hot].row.scrollIntoView({ block: 'nearest' });
    };
    const choose = (i = hot) => {
      const r = rows[i];
      if (!r) return false;
      // Run the action first: closing may reset state the action still needs.
      r.it.action && r.it.action();
      if (!opts.stayOpen) pop.close();
      return true;
    };
    render(items);
    const pop = popover(el, rect, { ...opts, noEscape: opts.external });
    const onKey = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHot(hot + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setHot(hot - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(); }
    };
    if (!opts.external) {
      document.addEventListener('keydown', onKey, true);
      const oldClose = pop.close;
      pop.close = () => { document.removeEventListener('keydown', onKey, true); oldClose(); };
    }
    return {
      ...pop,
      close: () => pop.close(),
      setItems: (list) => { render(list); place(el, opts.anchorRect || rect, opts); },
      move: (d) => setHot(hot + d),
      choose: () => choose(),
      get count() { return rows.length; },
    };
  }

  function emojiPicker(rect, onPick, { allowRemove = true } = {}) {
    const grid = h('div', { class: 'emoji-grid' });
    const search = h('input', { class: 'field', placeholder: 'Filter… (or paste any emoji)' });
    const el = h('div', { class: 'pop emoji-pop' },
      h('div', { class: 'emoji-top' }, search,
        h('button', { class: 'ghost-btn', title: 'Random', onclick: () => { const all = allEmoji(); pick(all[Math.floor(Math.random() * all.length)]); } }, '🎲'),
        allowRemove ? h('button', { class: 'ghost-btn', onclick: () => pick('') }, 'Remove') : null),
      grid);
    const allEmoji = () => Object.values(GN.EMOJI).join(' ').split(/\s+/).filter(Boolean);
    const draw = (q) => {
      grid.innerHTML = '';
      const typed = q.trim();
      if (typed && /\p{Extended_Pictographic}/u.test(typed)) {
        grid.append(h('button', { onclick: () => pick(typed) }, typed));
        return;
      }
      for (const [cat, list] of Object.entries(GN.EMOJI)) {
        if (typed && !cat.toLowerCase().includes(typed.toLowerCase())) continue;
        grid.append(h('div', { class: 'emoji-cat', text: cat }));
        list.split(/\s+/).filter(Boolean).forEach((e) => grid.append(h('button', { onclick: () => pick(e) }, e)));
      }
      if (!grid.children.length) grid.append(h('div', { class: 'emoji-cat', text: 'Try a category: popular, objects, nature, food, symbols' }));
    };
    const pick = (e) => { pop.close(); onPick(e); };
    search.addEventListener('input', () => draw(search.value));
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter' && /\p{Extended_Pictographic}/u.test(search.value)) pick(search.value.trim()); });
    draw('');
    const pop = popover(el, rect);
    setTimeout(() => search.focus());
    return pop;
  }

  function coverPicker(rect, onPick) {
    const grid = h('div', { class: 'cover-grid' });
    Object.entries(GN.COVERS).forEach(([key, c]) => {
      grid.append(h('button', { style: { background: c.css }, onclick: () => { pop.close(); onPick(key); } }, h('span', { text: c.name })));
    });
    const el = h('div', { class: 'pop cover-pop' }, h('div', { class: 'pop-label', text: 'Gradients' }), grid,
      h('div', { class: 'pop-sep' }),
      h('button', { class: 'pop-item compact', onclick: () => { pop.close(); onPick(null); } }, h('span', { class: 'ico', html: ICONS.trash }), h('span', { class: 'lbl', text: 'Remove cover' })));
    const pop = popover(el, rect, { align: 'end' });
    return pop;
  }

  function input(rect, { value = '', placeholder = '', button = 'Done', onSubmit, onRemove }) {
    const field = h('input', { class: 'field', value, placeholder, spellcheck: 'false' });
    const el = h('div', { class: 'pop link-pop' }, field,
      h('button', { class: 'primary-btn', style: { height: '34px' }, onclick: () => submit() }, button),
      onRemove ? h('button', { class: 'ghost-btn', style: { height: '34px' }, title: 'Remove link', onclick: () => { pop.close(); onRemove(); } }, '✕') : null);
    const submit = () => { pop.close(); onSubmit(field.value.trim()); };
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    const pop = popover(el, rect);
    setTimeout(() => { field.focus(); field.select(); });
    return pop;
  }

  function confirm({ title, text, ok = 'OK', danger = false }) {
    return new Promise((resolve) => {
      closeAll();
      const done = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
      const okBtn = h('button', { class: danger ? 'ghost-btn danger-btn' : 'primary-btn', onclick: () => done(true) }, ok);
      const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) done(false); } },
        h('div', { class: 'pop dialog' }, h('h3', { text: title }), h('p', { text }),
          h('div', { class: 'row' }, h('button', { class: 'ghost-btn', onclick: () => done(false) }, 'Cancel'), okBtn)));
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); }
      };
      document.addEventListener('keydown', onKey, true);
      layer().append(back);
      okBtn.focus();
    });
  }

  function toast(msg, { action, onAction, timeout = 3600 } = {}) {
    const wrap = document.getElementById('toasts');
    const t = h('div', { class: 'toast' }, h('span', { text: msg }));
    if (action) t.append(h('button', { onclick: () => { onAction(); kill(); } }, action));
    wrap.append(t);
    const kill = () => { t.classList.add('out'); setTimeout(() => t.remove(), 260); };
    setTimeout(kill, timeout);
  }

  window.UI = { h, ICONS, popover, closeAll, anyOpen, menu, emojiPicker, coverPicker, input, confirm, toast, place };
})();
