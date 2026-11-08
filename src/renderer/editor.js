/* Block editor: each block is its own contenteditable. Handles typing, splitting/merging,
   slash menu, markdown shortcuts, inline formatting, drag-to-reorder, paste and undo. */
(function () {
  const { h, ICONS } = UI;
  const TEXT_TYPES = new Set(['p', 'h1', 'h2', 'h3', 'bullet', 'number', 'todo', 'quote', 'callout', 'code', 'image']);
  const LIST_TYPES = new Set(['bullet', 'number', 'todo']);
  const PLACEHOLDER = {
    p: "Write, or press '/' for commands", h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', bullet: 'List',
    number: 'List', todo: 'To-do', quote: 'Quote', callout: 'Write something…', code: '// code', image: 'Add a caption…',
  };
  const BLOCK_TYPES = [
    { type: 'p', label: 'Text', sub: 'Plain writing', icon: 'text', keys: 'text paragraph plain' },
    { type: 'h1', label: 'Heading 1', sub: 'Big section title', icon: '<b style="font-family:var(--serif);font-size:17px;font-weight:400">H1</b>', keys: 'heading title h1 #' },
    { type: 'h2', label: 'Heading 2', sub: 'Medium heading', icon: 'H2', keys: 'heading subtitle h2 ##' },
    { type: 'h3', label: 'Heading 3', sub: 'Small heading', icon: 'H3', keys: 'heading h3 ###' },
    { type: 'todo', label: 'To-do list', sub: 'Track tasks with a checkbox', icon: 'todo', keys: 'todo task check checkbox list' },
    { type: 'bullet', label: 'Bulleted list', sub: 'A simple list', icon: 'bullet', keys: 'bullet list unordered ul' },
    { type: 'number', label: 'Numbered list', sub: 'A list with numbers', icon: 'number', keys: 'number numbered ordered ol list' },
    { type: 'quote', label: 'Quote', sub: 'Pull out a quotation', icon: 'quote', keys: 'quote blockquote citation' },
    { type: 'callout', label: 'Callout', sub: 'Make a note stand out', icon: 'callout', keys: 'callout note info tip box' },
    { type: 'code', label: 'Code', sub: 'Monospaced code snippet', icon: 'code', keys: 'code snippet pre mono' },
    { type: 'divider', label: 'Divider', sub: 'Separate sections', icon: 'divider', keys: 'divider line separator hr rule' },
    { type: 'image', label: 'Image', sub: 'Insert a picture from your computer', icon: 'image', keys: 'image picture photo img' },
  ];
  const MD = [
    [/^###$/, 'h3'], [/^##$/, 'h2'], [/^#$/, 'h1'], [/^[-*•+]$/, 'bullet'], [/^1[.)]$/, 'number'],
    [/^\[ ?\]$/, 'todo'], [/^\[x\]$/i, 'todo-done'], [/^>$/, 'quote'], [/^!$/, 'callout'], [/^"$/, 'quote'],
  ];
  const HL = ['violet', 'blue', 'teal', 'amber', 'pink'];
  const HL_COLORS = { violet: '#a78bfa', blue: '#7aa2ff', teal: '#5eead4', amber: '#fbbf77', pink: '#f49ac9' };

  /* ---------- caret helpers ---------- */
  const sel = () => window.getSelection();
  function caretOffset(el) {
    const s = sel();
    if (!s.rangeCount) return 0;
    const r = s.getRangeAt(0);
    if (!el.contains(r.startContainer)) return 0;
    const pre = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(r.startContainer, r.startOffset);
    return pre.toString().length;
  }
  function pointAt(el, offset) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node, left = offset;
    while ((node = walker.nextNode())) {
      if (left <= node.length) return [node, left];
      left -= node.length;
    }
    return [el, el.childNodes.length];
  }
  function setCaret(el, offset = 'end') {
    el.focus({ preventScroll: true });
    const len = el.textContent.length;
    const o = offset === 'end' ? len : offset === 'start' ? 0 : Math.min(offset, len);
    const [n, k] = pointAt(el, o);
    const r = document.createRange();
    r.setStart(n, k);
    r.collapse(true);
    const s = sel();
    s.removeAllRanges();
    s.addRange(r);
    const rect = el.getBoundingClientRect();
    if (rect.bottom > innerHeight - 40 || rect.top < 60) el.scrollIntoView({ block: 'nearest' });
  }
  function rangeOf(el, a, b) {
    const r = document.createRange();
    const [n1, k1] = pointAt(el, a);
    const [n2, k2] = pointAt(el, b);
    r.setStart(n1, k1);
    r.setEnd(n2, k2);
    return r;
  }
  function caretRect() {
    const s = sel();
    if (!s.rangeCount) return null;
    const r = s.getRangeAt(0).cloneRange();
    r.collapse(true);
    const rects = r.getClientRects();
    return rects.length ? rects[0] : null;
  }
  function lineHeight(el) {
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight);
    return isNaN(lh) ? parseFloat(cs.fontSize) * 1.5 : lh;
  }
  const isEmpty = (el) => el.textContent.length === 0 && !el.querySelector('img');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  class Editor {
    constructor(root, page, { onChange, onFocusTitle }) {
      this.root = root;
      this.page = page;
      this.onChange = onChange;
      this.onFocusTitle = onFocusTitle;
      this.undoStack = [];
      this.redoStack = [];
      this.committed = this.snapshot();
      this.burst = null;
      this.slash = null;
      this.fmt = null;
      this.els = new Map();
      if (!page.blocks || !page.blocks.length) page.blocks = [GN.B('p')];

      this.list = h('div', { class: 'blocks' });
      this.addBelow = h('div', { class: 'add-below', title: 'Click to add a block' });
      root.append(this.list, this.addBelow);
      this.renderAll();

      this.list.addEventListener('keydown', (e) => this.onKey(e));
      this.list.addEventListener('beforeinput', (e) => this.onBeforeInput(e));
      this.list.addEventListener('input', (e) => this.onInput(e));
      this.list.addEventListener('paste', (e) => this.onPaste(e));
      this.list.addEventListener('click', (e) => this.onClick(e));
      this.list.addEventListener('dragover', (e) => this.onDragOver(e));
      this.list.addEventListener('dragleave', (e) => { if (!this.list.contains(e.relatedTarget)) this.clearDrop(); });
      this.list.addEventListener('drop', (e) => this.onDrop(e));
      this.list.addEventListener('focusin', () => this.list.classList.remove('only-empty'));
      this.addBelow.addEventListener('mousedown', (e) => { e.preventDefault(); this.focusEnd(); });
      this.onSel = () => this.updateFormatBar();
      document.addEventListener('selectionchange', this.onSel);
    }

    destroy() {
      document.removeEventListener('selectionchange', this.onSel);
      this.closeSlash();
      this.hideFormatBar();
    }

    /* ---------- state & undo ---------- */
    snapshot() { return this.page.blocks.map((b) => ({ ...b })); }
    currentCaret() {
      const s = sel();
      if (!s.rangeCount) return null;
      const node = s.getRangeAt(0).startContainer;
      const blockEl = (node.nodeType === 1 ? node : node.parentElement)?.closest?.('.block');
      if (!blockEl || !this.list.contains(blockEl)) return null;
      const t = blockEl.querySelector('.text');
      return { id: blockEl.dataset.id, offset: t ? caretOffset(t) : 0 };
    }
    // Call BEFORE changing data. Typing in the same block within 1.2s is grouped into one undo step.
    record(kind = 'struct', blockId = null) {
      const now = Date.now();
      if (kind === 'type' && this.burst && this.burst.id === blockId && now - this.burst.t < 1200) {
        this.burst.t = now;
        return;
      }
      this.undoStack.push({ blocks: this.committed, caret: this.lastCaret || this.currentCaret() });
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack = [];
      this.burst = kind === 'type' ? { id: blockId, t: now } : null;
    }
    changed() {
      this.committed = this.snapshot();
      this.lastCaret = this.currentCaret();
      this.onChange && this.onChange();
    }
    undo(redo = false) {
      const from = redo ? this.redoStack : this.undoStack;
      const to = redo ? this.undoStack : this.redoStack;
      const step = from.pop();
      if (!step) return;
      to.push({ blocks: this.snapshot(), caret: this.currentCaret() });
      this.page.blocks = step.blocks.map((b) => ({ ...b }));
      this.committed = this.snapshot();
      this.burst = null;
      this.renderAll();
      const target = step.caret && this.page.blocks.find((b) => b.id === step.caret.id);
      if (target) this.focusBlock(target, step.caret.offset);
      this.onChange && this.onChange();
    }

    /* ---------- rendering ---------- */
    renderAll() {
      this.list.innerHTML = '';
      this.els.clear();
      this.page.blocks.forEach((b) => this.list.append(this.renderBlock(b)));
      this.renumber();
      this.updateOnlyEmpty();
    }
    updateOnlyEmpty() {
      const bs = this.page.blocks;
      this.list.classList.toggle('only-empty', bs.length === 1 && bs[0].type === 'p' && !bs[0].html);
    }

    renderBlock(b) {
      const el = h('div', { class: `block ${b.type}`, 'data-id': b.id });
      if (b.indent && LIST_TYPES.has(b.type)) el.dataset.indent = b.indent;
      if (b.type === 'todo' && b.checked) el.classList.add('done');

      const gutter = h('div', { class: 'block-gutter', contenteditable: 'false' },
        h('button', { class: 'add', title: 'Add a block below', html: ICONS.plus, onmousedown: (e) => e.preventDefault(), onclick: () => this.plusBelow(b) }),
        h('button', { class: 'grip', title: 'Drag to move · click for options', draggable: 'true', html: ICONS.grip,
          onmousedown: (e) => e.stopPropagation(),
          onclick: (e) => this.blockMenu(b, e.currentTarget),
          ondragstart: (e) => this.onDragStart(e, b),
          ondragend: () => this.onDragEnd() }));
      el.append(gutter);

      const text = () => {
        const t = h('div', { class: 'text', contenteditable: b.type === 'code' ? 'plaintext-only' : 'true', 'data-ph': PLACEHOLDER[b.type] || '', spellcheck: b.type === 'code' ? 'false' : 'true' });
        if (b.type === 'code') t.textContent = GNExport.htmlToText(b.html);
        else t.innerHTML = b.html || '';
        return t;
      };

      switch (b.type) {
        case 'bullet': case 'number':
          el.append(h('span', { class: 'marker', contenteditable: 'false' }), text());
          break;
        case 'todo':
          el.append(h('button', { class: 'check', contenteditable: 'false', html: ICONS.check, title: 'Ctrl+Enter',
            onmousedown: (e) => e.preventDefault(), onclick: () => this.toggleTodo(b) }), text());
          break;
        case 'callout': {
          const icon = h('span', { class: 'callout-icon', contenteditable: 'false', text: b.emoji || '💡', title: 'Change icon',
            onclick: (e) => UI.emojiPicker(e.currentTarget.getBoundingClientRect(), (em) => {
              this.record(); b.emoji = em || '💡'; icon.textContent = b.emoji; this.changed();
            }, { allowRemove: false }) });
          el.append(h('div', { class: 'callout-box' }, icon, text()));
          break;
        }
        case 'code': {
          const t = text();
          el.append(h('div', { class: 'code-box' },
            h('div', { class: 'code-head', contenteditable: 'false' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i')),
              h('button', { onclick: () => { navigator.clipboard.writeText(t.innerText); UI.toast('Code copied'); } }, 'Copy')), t));
          break;
        }
        case 'divider':
          el.tabIndex = -1;
          el.append(h('div', { class: 'divider-line' }));
          break;
        case 'image': {
          el.tabIndex = -1;
          const fig = h('div', { class: 'figure' });
          if (b.src) fig.append(h('img', { src: b.src, alt: '', draggable: 'false' }));
          fig.append(text());
          el.append(fig);
          break;
        }
        default:
          el.append(text());
      }
      this.els.set(b.id, el);
      return el;
    }

    rerender(b) {
      const old = this.els.get(b.id);
      const el = this.renderBlock(b);
      if (old) old.replaceWith(el);
      this.renumber();
      return el;
    }

    renumber() {
      const counters = [];
      const fmt = (n, d) => d % 3 === 1 ? String.fromCharCode(96 + ((n - 1) % 26) + 1) : d % 3 === 2 ? toRoman(n) : String(n);
      this.page.blocks.forEach((b) => {
        if (b.type !== 'number') {
          if (!LIST_TYPES.has(b.type)) counters.length = 0;
          return;
        }
        const d = b.indent || 0;
        counters.length = d + 1;
        counters[d] = (counters[d] || 0) + 1;
        const m = this.els.get(b.id)?.querySelector('.marker');
        if (m) m.textContent = fmt(counters[d], d) + '.';
      });
    }

    textOf(b) { return this.els.get(b.id)?.querySelector('.text'); }
    blockOf(node) {
      const el = (node.nodeType === 1 ? node : node.parentElement)?.closest('.block');
      if (!el || !this.list.contains(el)) return null;
      return this.page.blocks.find((b) => b.id === el.dataset.id) || null;
    }
    idx(b) { return this.page.blocks.indexOf(b); }

    focusBlock(b, offset = 'end') {
      const el = this.els.get(b.id);
      if (!el) return;
      const t = this.textOf(b);
      if (t && b.type !== 'image') setCaret(t, offset);
      else { el.focus({ preventScroll: true }); this.selectBlock(b); el.scrollIntoView({ block: 'nearest' }); }
    }
    selectBlock(b) {
      this.list.querySelectorAll('.block.selected').forEach((x) => x.classList.remove('selected'));
      if (b) this.els.get(b.id)?.classList.add('selected');
    }
    focusStart() {
      const first = this.page.blocks.find((b) => TEXT_TYPES.has(b.type) && b.type !== 'image');
      if (first) this.focusBlock(first, 'start');
      else this.insertAfter(-1, GN.B('p'));
    }
    focusEnd() {
      const last = this.page.blocks[this.page.blocks.length - 1];
      if (last && last.type === 'p' && !last.html) { this.focusBlock(last, 'end'); return; }
      this.record();
      this.insertAfter(this.page.blocks.length - 1, GN.B('p'));
      this.changed();
    }

    /* ---------- structural operations (callers record/changed) ---------- */
    insertAfter(i, b, focus = 'start') {
      this.page.blocks.splice(i + 1, 0, b);
      const el = this.renderBlock(b);
      const next = this.page.blocks[i + 2];
      if (next && this.els.get(next.id)) this.list.insertBefore(el, this.els.get(next.id));
      else this.list.append(el);
      this.renumber();
      this.updateOnlyEmpty();
      if (focus) this.focusBlock(b, focus);
      return b;
    }
    remove(b) {
      const i = this.idx(b);
      if (i < 0) return;
      this.page.blocks.splice(i, 1);
      this.els.get(b.id)?.remove();
      this.els.delete(b.id);
      if (!this.page.blocks.length) this.insertAfter(-1, GN.B('p'));
      this.renumber();
      this.updateOnlyEmpty();
    }
    setType(b, type, offset = 'start') {
      if (type === 'todo-done') { type = 'todo'; b.checked = true; }
      if (b.type === 'code' && type !== 'code') b.html = esc(this.textOf(b)?.innerText ?? GNExport.htmlToText(b.html)).replace(/\n/g, '<br>');
      if (type === 'code' && b.type !== 'code') b.html = esc(GNExport.htmlToText(b.html));
      b.type = type;
      if (!LIST_TYPES.has(type)) delete b.indent;
      if (type !== 'todo') delete b.checked;
      if (type === 'callout' && !b.emoji) b.emoji = '💡';
      this.rerender(b);
      this.updateOnlyEmpty();
      if (TEXT_TYPES.has(type) && type !== 'image') this.focusBlock(b, offset);
    }
    syncText(b) {
      const t = this.textOf(b);
      if (!t) return;
      if (b.type === 'code') { b.html = esc(t.innerText.replace(/\n$/, '')); return; }
      // Drop leftover empty tags so an "empty" block really is empty.
      if (t.textContent === '' && t.innerHTML !== '' && !t.querySelector('img')) t.innerHTML = '';
      b.html = t.innerHTML.replace(/<br>$/, '');
    }

    /* ---------- events ---------- */
    onBeforeInput(e) {
      if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
        e.preventDefault();
        this.undo(e.inputType === 'historyRedo');
        return;
      }
      if (/^(insert|delete|format)/.test(e.inputType || '')) {
        const b = this.blockOf(e.target);
        if (b) { this.lastCaret = this.currentCaret(); this.record('type', b.id); }
      }
      // Paste/drop of rich HTML is handled ourselves.
      if (e.inputType === 'insertFromDrop' && e.dataTransfer && e.dataTransfer.types.includes('text/html')) {
        e.preventDefault();
        const text = e.dataTransfer.getData('text/plain');
        if (text) document.execCommand('insertText', false, text);
      }
    }

    onInput(e) {
      const b = this.blockOf(e.target);
      if (!b) return;
      const t = this.textOf(b);
      this.syncText(b);
      if (!e.isComposing) {
        if (e.inputType === 'insertText' && e.data === '/' && b.type !== 'code') this.openSlash(b);
        else if (this.slash) this.updateSlash();
        if (e.inputType === 'insertText' && (e.data === ' ' || e.data === '-' || e.data === '`')) this.markdown(b, t);
      }
      this.updateOnlyEmpty();
      this.changed();
    }

    markdown(b, t) {
      const off = caretOffset(t);
      const full = t.textContent;
      if (b.type === 'p' && full === '---' && off === 3) {
        t.innerHTML = ''; b.html = '';
        this.setType(b, 'divider');
        this.insertAfter(this.idx(b), GN.B('p'));
        return;
      }
      if (b.type === 'p' && full.startsWith('```') && off === 3) {
        rangeOf(t, 0, 3).deleteContents();
        this.syncText(b);
        this.setType(b, 'code');
        return;
      }
      if (b.type !== 'p' || full[off - 1] !== ' ') return;
      const prefix = full.slice(0, off - 1);
      for (const [re, type] of MD) {
        if (re.test(prefix)) {
          rangeOf(t, 0, off).deleteContents();
          this.syncText(b);
          this.setType(b, type, 'start');
          return;
        }
      }
    }

    onKey(e) {
      const b = this.blockOf(e.target);
      if (!b) return;
      const t = this.textOf(b);
      const mod = e.ctrlKey || e.metaKey;
      const editingText = t && t.contains(e.target) || e.target === t;

      if (this.slash) {
        if (e.key === 'ArrowDown') { e.preventDefault(); this.slash.menu.move(1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); this.slash.menu.move(-1); return; }
        if (e.key === 'Enter' || e.key === 'Tab') {
          if (this.slash.menu.count) { e.preventDefault(); this.slash.menu.choose(); return; }
          this.closeSlash();
        }
        if (e.key === 'Escape') { e.preventDefault(); this.closeSlash(); return; }
      }

      if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); this.undo(); return; }
      if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); this.undo(true); return; }
      if (mod && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); this.move(b, e.key === 'ArrowUp' ? -1 : 1); return; }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); this.duplicate(b); return; }
      if (mod && e.key === 'Enter' && b.type === 'todo') { e.preventDefault(); this.toggleTodo(b); return; }

      // Non-text blocks (divider, selected image)
      if (!editingText) {
        if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault();
          const i = this.idx(b);
          this.record(); this.remove(b); this.changed();
          const prev = this.page.blocks[Math.max(0, i - 1)];
          if (prev) this.focusBlock(prev, 'end');
        } else if (e.key === 'Enter') {
          e.preventDefault();
          this.record(); this.insertAfter(this.idx(b), GN.B('p')); this.changed();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); this.go(b, -1, 'end'); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); this.go(b, 1, 'start'); }
        return;
      }

      if (mod && !e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); this.wrapInline('code'); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'h') { e.preventDefault(); this.wrapInline('mark', 'hl-violet'); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); document.execCommand('strikeThrough'); return; }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'k' && !sel().isCollapsed) { e.preventDefault(); e.stopPropagation(); this.editLink(); return; }

      if (b.type === 'code') {
        if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, e.shiftKey ? '' : '  '); return; }
        if (e.key === 'Enter' && !mod && !e.shiftKey) { e.preventDefault(); document.execCommand('insertText', false, '\n'); return; }
        if ((e.key === 'Enter' && (mod || e.shiftKey)) || e.key === 'Escape') {
          e.preventDefault();
          this.record(); this.insertAfter(this.idx(b), GN.B('p')); this.changed();
          return;
        }
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        if (LIST_TYPES.has(b.type)) {
          const prev = this.page.blocks[this.idx(b) - 1];
          const max = prev && LIST_TYPES.has(prev.type) ? Math.min(3, (prev.indent || 0) + 1) : 0;
          const next = Math.max(0, Math.min(max, (b.indent || 0) + (e.shiftKey ? -1 : 1)));
          if (next !== (b.indent || 0)) {
            const off = caretOffset(t);
            this.record(); b.indent = next || undefined; if (!next) delete b.indent;
            this.rerender(b); this.focusBlock(b, off); this.changed();
          }
        }
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey && b.type !== 'code') { e.preventDefault(); this.enter(b, t); return; }
      if (e.key === 'Backspace' && sel().isCollapsed && caretOffset(t) === 0) {
        const r = sel().getRangeAt(0);
        const pre = document.createRange(); pre.selectNodeContents(t); pre.setEnd(r.startContainer, r.startOffset);
        if (pre.toString().length === 0) { e.preventDefault(); this.backspace(b, t); return; }
      }
      if (e.key === 'Delete' && sel().isCollapsed && caretOffset(t) === t.textContent.length) {
        const next = this.page.blocks[this.idx(b) + 1];
        if (next && TEXT_TYPES.has(next.type) && next.type !== 'image' && b.type !== 'image') {
          e.preventDefault();
          this.record();
          const off = t.textContent.length;
          t.insertAdjacentHTML('beforeend', next.type === 'code' ? next.html : next.html || '');
          this.syncText(b); this.remove(next); setCaret(t, off); this.changed();
        }
        return;
      }

      if (!e.shiftKey && !mod) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const rect = caretRect();
          const er = t.getBoundingClientRect();
          const lh = lineHeight(t);
          const up = e.key === 'ArrowUp';
          const edge = !rect || (up ? rect.top - er.top < lh * 0.9 : er.bottom - rect.bottom < lh * 0.9);
          if (edge && this.go(b, up ? -1 : 1, up ? 'end' : 'start')) e.preventDefault();
        } else if (e.key === 'ArrowLeft' && sel().isCollapsed && caretOffset(t) === 0) {
          if (this.go(b, -1, 'end')) e.preventDefault();
        } else if (e.key === 'ArrowRight' && sel().isCollapsed && caretOffset(t) === t.textContent.length) {
          if (this.go(b, 1, 'start')) e.preventDefault();
        }
      }
      if (e.key === 'ArrowUp' && this.idx(b) === 0 && !e.shiftKey) {
        const rect = caretRect();
        if (!rect || rect.top - t.getBoundingClientRect().top < lineHeight(t) * 0.9) { e.preventDefault(); this.onFocusTitle && this.onFocusTitle(); }
      }
    }

    go(b, dir, where) {
      let i = this.idx(b) + dir;
      while (i >= 0 && i < this.page.blocks.length) {
        const nb = this.page.blocks[i];
        if (nb.type === 'divider') { i += dir; continue; }
        this.focusBlock(nb, where);
        return true;
      }
      return false;
    }

    enter(b, t) {
      const off = caretOffset(t);
      const empty = t.textContent.length === 0;
      this.record();
      // Enter on an empty list item leaves the list.
      if (empty && (LIST_TYPES.has(b.type) || b.type === 'quote' || b.type === 'callout')) {
        if (b.indent) { b.indent--; if (!b.indent) delete b.indent; this.rerender(b); this.focusBlock(b); }
        else this.setType(b, 'p');
        this.changed();
        return;
      }
      const nextType = LIST_TYPES.has(b.type) ? b.type : 'p';
      const extra = b.indent ? { indent: b.indent } : {};
      if (off === 0 && !empty && b.type !== 'image') {
        // Caret at the very start: open an empty line above and keep typing where you were.
        const nb = GN.B(LIST_TYPES.has(b.type) ? b.type : 'p', '', extra);
        this.page.blocks.splice(this.idx(b), 0, nb);
        this.list.insertBefore(this.renderBlock(nb), this.els.get(b.id));
        this.renumber();
        setCaret(t, 0);
        this.changed();
        return;
      }
      const s = sel();
      const r = s.getRangeAt(0);
      r.deleteContents();
      const tail = document.createRange();
      tail.setStart(r.startContainer, r.startOffset);
      tail.setEnd(t, t.childNodes.length);
      const box = document.createElement('div');
      box.append(tail.extractContents());
      const tailHtml = box.textContent.length ? box.innerHTML : '';
      this.syncText(b);
      if (b.type === 'image') { this.insertAfter(this.idx(b), GN.B('p', tailHtml)); this.changed(); return; }
      this.insertAfter(this.idx(b), GN.B(nextType, tailHtml, extra), 'start');
      this.changed();
    }

    backspace(b, t) {
      this.record();
      if (b.type !== 'p' && b.type !== 'image') {
        if (b.indent) { b.indent--; if (!b.indent) delete b.indent; this.rerender(b); this.focusBlock(b, 0); }
        else this.setType(b, 'p', 0);
        this.changed();
        return;
      }
      const i = this.idx(b);
      const prev = this.page.blocks[i - 1];
      if (!prev) { this.changed(); return; }
      if (prev.type === 'divider' || (prev.type === 'image' && !t.textContent.length)) {
        if (isEmpty(t) && prev.type === 'image') { this.remove(b); this.focusBlock(prev); }
        else { this.remove(prev); setCaret(t, 0); }
        this.changed();
        return;
      }
      if (b.type === 'image') { this.focusBlock(prev, 'end'); return; }
      const pt = this.textOf(prev);
      const off = pt.textContent.length;
      if (prev.type === 'code') pt.textContent += t.textContent;
      else pt.insertAdjacentHTML('beforeend', b.html || '');
      this.syncText(prev);
      this.remove(b);
      setCaret(pt, off);
      this.changed();
    }

    toggleTodo(b) {
      this.record();
      b.checked = !b.checked;
      if (!b.checked) delete b.checked;
      this.els.get(b.id)?.classList.toggle('done', !!b.checked);
      this.changed();
    }

    move(b, dir) {
      const i = this.idx(b), j = i + dir;
      if (j < 0 || j >= this.page.blocks.length) return;
      const t = this.textOf(b);
      const off = t ? caretOffset(t) : 0;
      this.record();
      const other = this.page.blocks[j];
      this.page.blocks.splice(i, 1);
      this.page.blocks.splice(j, 0, b);
      const el = this.els.get(b.id), oel = this.els.get(other.id);
      if (dir < 0) this.list.insertBefore(el, oel); else this.list.insertBefore(oel, el);
      this.renumber();
      this.focusBlock(b, off);
      this.changed();
    }

    duplicate(b) {
      this.record();
      const copy = { ...b, id: GN.uid() };
      this.insertAfter(this.idx(b), copy, 'end');
      this.changed();
    }

    onClick(e) {
      const a = e.target.closest('a');
      if (a && (e.ctrlKey || e.metaKey)) { e.preventDefault(); window.open(a.href); return; }
      if (a) { this.linkHint(a); }
      const b = this.blockOf(e.target);
      if (b && (b.type === 'divider' || (b.type === 'image' && e.target.tagName === 'IMG'))) {
        this.els.get(b.id).focus();
        this.selectBlock(b);
      } else this.selectBlock(null);
    }

    linkHint(a) {
      const r = a.getBoundingClientRect();
      const m = UI.menu([
        { label: 'Open link', sub: a.getAttribute('href'), icon: 'globe', hint: 'Ctrl+click', action: () => window.open(a.href) },
        { label: 'Copy link', icon: 'copy', action: () => { navigator.clipboard.writeText(a.href); UI.toast('Link copied'); } },
      ], r, { compact: true });
      m.el.style.maxWidth = '320px';
    }

    /* ---------- plus button & block menu ---------- */
    plusBelow(b) {
      this.record();
      let target = b;
      if (!(b.type === 'p' && !b.html)) target = this.insertAfter(this.idx(b), GN.B('p'));
      else this.focusBlock(b);
      this.changed();
      document.execCommand('insertText', false, '/');
    }

    blockMenu(b, anchor) {
      const el = this.els.get(b.id);
      el.classList.add('menu-open');
      this.selectBlock(b);
      const turn = BLOCK_TYPES.filter((x) => TEXT_TYPES.has(x.type) && x.type !== 'image' && b.type !== 'image' && b.type !== 'divider')
        .map((x) => ({ label: x.label, icon: x.icon, on: x.type === b.type, action: () => { this.record(); this.setType(b, x.type, 'end'); this.changed(); } }));
      const items = [
        ...(turn.length ? [{ section: 'Turn into' }, ...turn, 'sep'] : []),
        b.type === 'image' ? { label: 'Replace image', icon: 'image', action: () => this.pickImage(b) } : null,
        { label: 'Duplicate', icon: 'copy', hint: 'Ctrl D', action: () => this.duplicate(b) },
        { label: 'Move up', icon: 'up', hint: 'Ctrl ⇧ ↑', action: () => this.move(b, -1) },
        { label: 'Move down', icon: 'down', hint: 'Ctrl ⇧ ↓', action: () => this.move(b, 1) },
        'sep',
        { label: 'Delete', icon: 'trash', danger: true, hint: 'Del', action: () => {
          const i = this.idx(b);
          this.record(); this.remove(b); this.changed();
          const p = this.page.blocks[Math.max(0, i - 1)]; if (p) this.focusBlock(p, 'end');
        } },
      ].filter(Boolean);
      UI.menu(items, anchor.getBoundingClientRect(), { compact: true, onClose: () => { el.classList.remove('menu-open'); this.selectBlock(null); } });
    }

    async pickImage(b) {
      const src = await window.desk.pickImage();
      if (!src) return;
      this.record();
      b.type = 'image'; b.src = src; b.html = b.html || '';
      delete b.indent; delete b.checked;
      this.rerender(b);
      this.changed();
    }

    /* ---------- slash menu ---------- */
    openSlash(b) {
      const t = this.textOf(b);
      this.closeSlash();
      const start = caretOffset(t) - 1;
      const rect = caretRect() || t.getBoundingClientRect();
      const menu = UI.menu(this.slashItems(b, ''), rect, { external: true, className: 'slash', onClose: () => { if (this.slash && this.slash.menu === menu) this.slash = null; } });
      this.slash = { b, start, menu };
    }
    slashItems(b, q) {
      q = q.toLowerCase().trim();
      const list = BLOCK_TYPES.filter((x) => !q || x.label.toLowerCase().includes(q) || x.keys.includes(q));
      return [{ section: q ? 'Results' : 'Basic blocks' }, ...list.map((x) => ({ label: x.label, sub: x.sub, icon: x.icon, action: () => this.applySlash(x.type) }))]
        .filter((x, i, arr) => !(x.section && arr.length === 1));
    }
    updateSlash() {
      const { b, start, menu } = this.slash;
      const t = this.textOf(b);
      if (!t || !document.activeElement || !t.contains(sel().anchorNode)) return this.closeSlash();
      const off = caretOffset(t);
      const text = t.textContent;
      if (off <= start || text[start] !== '/') return this.closeSlash();
      const q = text.slice(start + 1, off);
      if (q.length > 24 || /\s\s/.test(q)) return this.closeSlash();
      const items = this.slashItems(b, q);
      if (items.length === 0 && q.length > 3) return this.closeSlash();
      menu.setItems(items);
    }
    closeSlash() {
      if (!this.slash) return;
      const m = this.slash.menu;
      this.slash = null;
      m.close();
    }
    applySlash(type) {
      if (!this.slash) return;
      const { b, start } = this.slash;
      this.slash = null;
      const t = this.textOf(b);
      const off = caretOffset(t);
      this.record();
      rangeOf(t, start, Math.max(off, start + 1)).deleteContents();
      this.syncText(b);
      const empty = !t.textContent.length;
      let target = b;
      if (!empty) target = this.insertAfter(this.idx(b), GN.B('p'), null);
      if (type === 'divider') {
        this.setType(target, 'divider');
        this.insertAfter(this.idx(target), GN.B('p'));
      } else if (type === 'image') {
        this.changed();
        this.pickImage(target).then(() => {
          if (target.type !== 'image') { this.focusBlock(target); return; }
          if (!this.page.blocks[this.idx(target) + 1]) { this.record(); this.insertAfter(this.idx(target), GN.B('p')); this.changed(); }
        });
        return;
      } else {
        this.setType(target, type, 'end');
      }
      this.changed();
    }

    /* ---------- inline formatting ---------- */
    activeText() {
      const s = sel();
      if (!s.rangeCount) return null;
      const n = s.getRangeAt(0).commonAncestorContainer;
      const t = (n.nodeType === 1 ? n : n.parentElement)?.closest('.text');
      return t && this.list.contains(t) ? t : null;
    }

    wrapInline(tag, cls, attrs = {}) {
      const t = this.activeText();
      if (!t) return;
      const b = this.blockOf(t);
      if (b.type === 'code') return;
      const s = sel();
      const r = s.getRangeAt(0);
      if (r.collapsed) return;
      this.record();
      const anc = (r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement).closest(tag);
      const unwrap = (node) => { const p = node.parentNode; while (node.firstChild) p.insertBefore(node.firstChild, node); p.removeChild(node); };
      if (anc && t.contains(anc)) {
        if (tag === 'mark' && cls && !anc.classList.contains(cls)) { anc.className = cls; }
        else unwrap(anc);
      } else {
        const frag = r.extractContents();
        frag.querySelectorAll(tag).forEach(unwrap);
        const w = document.createElement(tag);
        if (cls) w.className = cls;
        Object.entries(attrs).forEach(([k, v]) => w.setAttribute(k, v));
        w.append(frag);
        r.insertNode(w);
        const nr = document.createRange();
        nr.selectNodeContents(w);
        s.removeAllRanges();
        s.addRange(nr);
      }
      t.normalize();
      this.syncText(b);
      this.changed();
      this.updateFormatBar();
    }

    clearHighlight() {
      const t = this.activeText();
      if (!t) return;
      const r = sel().getRangeAt(0);
      this.record();
      t.querySelectorAll('mark').forEach((m) => {
        if (r.intersectsNode(m)) { const p = m.parentNode; while (m.firstChild) p.insertBefore(m.firstChild, m); p.removeChild(m); }
      });
      t.normalize();
      this.syncText(this.blockOf(t));
      this.changed();
    }

    editLink() {
      const t = this.activeText();
      if (!t) return;
      const s = sel();
      const saved = s.getRangeAt(0).cloneRange();
      const node = saved.commonAncestorContainer;
      const existing = (node.nodeType === 1 ? node : node.parentElement).closest('a');
      const rect = saved.getBoundingClientRect();
      this.hideFormatBar();
      const restore = () => { t.focus({ preventScroll: true }); s.removeAllRanges(); s.addRange(saved); };
      UI.input(rect, {
        value: existing ? existing.getAttribute('href') : '',
        placeholder: 'Paste a link, e.g. example.com',
        button: 'Link',
        onRemove: existing ? () => { restore(); this.wrapInline('a'); } : null,
        onSubmit: (url) => {
          restore();
          if (!url) { if (existing) this.wrapInline('a'); return; }
          if (!/^[a-z]+:/i.test(url)) url = url.includes('@') && !url.includes('/') ? 'mailto:' + url : 'https://' + url;
          if (!/^(https?:|mailto:)/i.test(url)) return UI.toast('Only web and email links are supported');
          if (existing) { this.record(); existing.setAttribute('href', url); this.syncText(this.blockOf(t)); this.changed(); }
          else this.wrapInline('a', null, { href: url, title: 'Ctrl+click to open' });
        },
      });
    }

    updateFormatBar() {
      const s = sel();
      const t = this.activeText();
      if (!t || s.isCollapsed || this.blockOf(t)?.type === 'code' || this.slash) { this.hideFormatBar(); return; }
      const r = s.getRangeAt(0);
      const rect = r.getBoundingClientRect();
      if (!rect.width) { this.hideFormatBar(); return; }
      if (!this.fmt) this.fmt = this.buildFormatBar();
      const st = (cmd) => { try { return document.queryCommandState(cmd); } catch { return false; } };
      const inside = (tag) => !!((r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement).closest(tag));
      this.fmt.btn.b.classList.toggle('on', st('bold'));
      this.fmt.btn.i.classList.toggle('on', st('italic'));
      this.fmt.btn.u.classList.toggle('on', st('underline'));
      this.fmt.btn.s.classList.toggle('on', st('strikeThrough'));
      this.fmt.btn.code.classList.toggle('on', inside('code'));
      this.fmt.btn.link.classList.toggle('on', inside('a'));
      if (!this.fmt.el.isConnected) document.getElementById('layer').append(this.fmt.el);
      UI.place(this.fmt.el, rect, { prefer: 'above', align: 'center', gap: 10 });
    }
    buildFormatBar() {
      const keep = (e) => e.preventDefault();
      const B = (label, title, fn, style) => h('button', { title, onmousedown: keep, onclick: fn, html: label, style });
      const btn = {
        b: B('<b>B</b>', 'Bold (Ctrl B)', () => document.execCommand('bold')),
        i: B('<i style="font-family:var(--serif);font-size:17px">i</i>', 'Italic (Ctrl I)', () => document.execCommand('italic')),
        u: B('<u>U</u>', 'Underline (Ctrl U)', () => document.execCommand('underline')),
        s: B('<s>S</s>', 'Strikethrough (Ctrl Shift S)', () => document.execCommand('strikeThrough')),
        code: B('<span style="font-family:var(--mono);font-size:12px">&lt;/&gt;</span>', 'Inline code (Ctrl E)', () => this.wrapInline('code')),
        link: B(ICONS.globe, 'Link (Ctrl K)', () => this.editLink()),
      };
      const el = h('div', { class: 'pop fmt-bar' }, btn.b, btn.i, btn.u, btn.s, btn.code, btn.link, h('span', { class: 'sep' }),
        ...HL.map((c) => B(`<span class="swatch" style="background:${HL_COLORS[c]}66;box-shadow:inset 0 0 0 1.5px ${HL_COLORS[c]}"></span>`, 'Highlight ' + c, () => this.wrapInline('mark', 'hl-' + c))),
        B('<span style="font-size:13px;color:var(--text-3)">✕</span>', 'Remove highlight', () => this.clearHighlight()));
      el.addEventListener('mousedown', keep);
      return { el, btn };
    }
    hideFormatBar() { if (this.fmt && this.fmt.el.isConnected) this.fmt.el.remove(); }

    /* ---------- paste ---------- */
    onPaste(e) {
      const b = this.blockOf(e.target);
      if (!b) return;
      const cd = e.clipboardData;
      const img = [...cd.items].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
      if (img) {
        e.preventDefault();
        this.insertImageFile(img.getAsFile(), b);
        return;
      }
      const text = cd.getData('text/plain');
      e.preventDefault();
      if (!text) return;
      if (b.type === 'code' || !text.includes('\n')) { document.execCommand('insertText', false, b.type === 'code' ? text : text.replace(/\r/g, '')); return; }
      const lines = text.replace(/\r/g, '').split('\n');
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      const t = this.textOf(b);
      this.record();
      // Split the current block, put the first line here and the rest as new blocks.
      const r = sel().getRangeAt(0);
      r.deleteContents();
      const tail = document.createRange();
      tail.setStart(r.startContainer, r.startOffset);
      tail.setEnd(t, t.childNodes.length);
      const box = document.createElement('div');
      box.append(tail.extractContents());
      const tailHtml = box.textContent.length ? box.innerHTML : '';
      const firstLine = lines.shift();
      if (b.type === 'p' && !t.textContent.length && !tailHtml) {
        // Empty line: let the first pasted line keep its markdown formatting too.
        const parsed = parseLine(firstLine);
        b.html = parsed.html;
        if (parsed.type !== 'p') { Object.assign(b, { ...parsed, id: b.id }); this.rerender(b); }
        else this.textOf(b).innerHTML = parsed.html;
      } else {
        t.insertAdjacentHTML('beforeend', esc(firstLine));
        this.syncText(b);
      }
      let at = this.idx(b), last = b, inCode = null;
      for (const line of lines) {
        if (/^```/.test(line.trim())) {
          if (inCode) { inCode = null; continue; }
          inCode = GN.B('code', ''); last = this.insertAfter(at++, inCode, null); continue;
        }
        if (inCode) { inCode.html += (inCode.html ? '\n' : '') + esc(line); continue; }
        if (!line.trim()) continue;
        const nb = parseLine(line);
        last = this.insertAfter(at++, nb, null);
      }
      if (inCode) this.rerender(inCode);
      const lt = this.textOf(last);
      const endOff = lt ? lt.textContent.length : 0;
      if (tailHtml && lt) { lt.insertAdjacentHTML('beforeend', tailHtml); this.syncText(last); }
      this.focusBlock(last, endOff);
      this.changed();
    }

    insertImageFile(file, after) {
      if (!file) return;
      if (file.size > 12 * 1024 * 1024) { UI.toast('That image is over 12 MB — please use a smaller one'); return; }
      const fr = new FileReader();
      fr.onload = () => {
        this.record();
        const nb = GN.B('image', '', { src: fr.result });
        if (after && after.type === 'p' && !after.html) {
          Object.assign(after, { type: 'image', src: fr.result });
          this.rerender(after);
          if (!this.page.blocks[this.idx(after) + 1]) this.insertAfter(this.idx(after), GN.B('p'));
        } else this.insertAfter(after ? this.idx(after) : this.page.blocks.length - 1, nb, null);
        this.changed();
      };
      fr.readAsDataURL(file);
    }

    /* ---------- drag to reorder ---------- */
    onDragStart(e, b) {
      this.dragging = b;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-gn-block', b.id);
      const el = this.els.get(b.id);
      e.dataTransfer.setDragImage(el, 20, 14);
      requestAnimationFrame(() => el.classList.add('dragging'));
    }
    onDragEnd() {
      if (this.dragging) this.els.get(this.dragging.id)?.classList.remove('dragging');
      this.dragging = null;
      this.clearDrop();
    }
    dropTarget(y) {
      const blocks = this.page.blocks;
      for (let i = 0; i < blocks.length; i++) {
        const r = this.els.get(blocks[i].id).getBoundingClientRect();
        if (y < r.top + r.height / 2) return { index: i, y: r.top };
      }
      const last = this.els.get(blocks[blocks.length - 1].id).getBoundingClientRect();
      return { index: blocks.length, y: last.bottom };
    }
    onDragOver(e) {
      const isFile = e.dataTransfer.types.includes('Files');
      if (!this.dragging && !isFile) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = this.dragging ? 'move' : 'copy';
      const t = this.dropTarget(e.clientY);
      if (!this.dropLine) this.dropLine = h('div', { class: 'drop-line' });
      const lr = this.list.getBoundingClientRect();
      this.dropLine.style.top = (t.y - lr.top - 2) + 'px';
      if (!this.dropLine.isConnected) this.list.append(this.dropLine);
      this.dropIndex = t.index;
    }
    clearDrop() { this.dropLine?.remove(); }
    onDrop(e) {
      const files = [...(e.dataTransfer.files || [])].filter((f) => f.type.startsWith('image/'));
      if (this.dragging) {
        e.preventDefault();
        const b = this.dragging;
        let to = this.dropIndex;
        const from = this.idx(b);
        this.clearDrop();
        if (to === from || to === from + 1) return;
        this.record();
        this.page.blocks.splice(from, 1);
        if (to > from) to--;
        this.page.blocks.splice(to, 0, b);
        const ref = this.page.blocks[to + 1];
        this.list.insertBefore(this.els.get(b.id), ref ? this.els.get(ref.id) : null);
        this.renumber();
        this.changed();
      } else if (files.length) {
        e.preventDefault();
        const at = this.page.blocks[Math.max(0, (this.dropIndex ?? this.page.blocks.length) - 1)];
        this.clearDrop();
        files.forEach((f) => this.insertImageFile(f, at));
      }
    }
  }

  function parseLine(line) {
    const m = line.match(/^(\s*)(#{1,3}\s|[-*•+]\s\[[ xX]\]\s|\[[ xX]\]\s|[-*•+]\s|\d+[.)]\s|>\s)?(.*)$/);
    const indent = Math.min(3, Math.floor((m[1] || '').replace(/\t/g, '    ').length / 2));
    const mk = (m[2] || '').trim();
    const body = esc(m[3]).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    if (/^#{1,3}$/.test(mk)) return GN.B('h' + mk.length, body);
    if (/\[[xX]\]$/.test(mk)) return GN.B('todo', body, { checked: true, ...(indent ? { indent } : {}) });
    if (/\[ \]$/.test(mk)) return GN.B('todo', body, indent ? { indent } : {});
    if (/^[-*•+]$/.test(mk)) return GN.B('bullet', body, indent ? { indent } : {});
    if (/^\d+[.)]$/.test(mk)) return GN.B('number', body, indent ? { indent } : {});
    if (mk === '>') return GN.B('quote', body);
    if (/^-{3,}$/.test(line.trim())) return GN.B('divider');
    return GN.B('p', body);
  }

  function toRoman(n) {
    const map = [['x', 10], ['ix', 9], ['v', 5], ['iv', 4], ['i', 1]];
    let s = '';
    for (const [r, v] of map) while (n >= v) { s += r; n -= v; }
    return s || 'i';
  }

  window.Editor = Editor;
  window.Editor.blockTypes = BLOCK_TYPES;
})();
