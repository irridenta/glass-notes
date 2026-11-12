/* Password-protected pages.
   A locked page's blocks are encrypted with AES-256-GCM. The key comes from the password
   via PBKDF2-SHA256 (600,000 rounds, random salt), so the password itself is never stored.
   Title, icon and cover stay visible so the page can be found in the sidebar. */
(function () {
  const { h, ICONS } = UI;
  const ITERATIONS = 600000;
  const te = new TextEncoder();
  const td = new TextDecoder();

  function toB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function deriveKey(password, salt, iterations = ITERATIONS) {
    const base = await crypto.subtle.importKey('raw', te.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  // The page id is bound in as extra data, so an encrypted body can't be swapped onto another page.
  async function seal(key, pageId, blocks) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(pageId) }, key, te.encode(JSON.stringify(blocks)));
    return { iv: toB64(iv), data: toB64(new Uint8Array(data)) };
  }

  async function open(key, pageId, locked) {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(locked.iv), additionalData: te.encode(pageId) }, key, fromB64(locked.data));
    return JSON.parse(td.decode(plain));
  }

  /* Create the lock record for a page. Returns { key, locked }. */
  async function protect(pageId, blocks, password, hint) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(password, salt);
    const body = await seal(key, pageId, blocks);
    return { key, locked: { v: 1, kdf: 'PBKDF2-SHA256', iter: ITERATIONS, salt: toB64(salt), hint: hint || '', ...body } };
  }

  /* Try a password. Resolves { key, blocks } or null if it's wrong. */
  async function unlock(pageId, locked, password) {
    try {
      const key = await deriveKey(password, fromB64(locked.salt), locked.iter || ITERATIONS);
      return { key, blocks: await open(key, pageId, locked) };
    } catch {
      return null;
    }
  }

  /* Dialog asking for a new password (with confirmation and an optional hint). */
  function askNewPassword({ title, text, ok }) {
    return new Promise((resolve) => {
      UI.closeAll();
      const pw = h('input', { class: 'field', type: 'password', placeholder: 'Password', autocomplete: 'new-password' });
      const pw2 = h('input', { class: 'field', type: 'password', placeholder: 'Type it again', autocomplete: 'new-password' });
      const hint = h('input', { class: 'field', placeholder: 'Hint (optional, visible to anyone)', maxlength: '80' });
      const err = h('div', { class: 'lock-error' });
      const done = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
      const submit = () => {
        if (pw.value.length < 4) return fail('Use at least 4 characters.');
        if (pw.value !== pw2.value) return fail('The two passwords don’t match.');
        if (hint.value && pw.value && hint.value.toLowerCase().includes(pw.value.toLowerCase())) return fail('The hint can’t contain the password.');
        done({ password: pw.value, hint: hint.value.trim() });
      };
      const fail = (m) => { err.textContent = m; box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake'); };
      const box = h('div', { class: 'pop dialog lock-dialog' },
        h('div', { class: 'lock-badge', html: ICONS.lock }),
        h('h3', { text: title }), h('p', { text }),
        h('div', { class: 'lock-fields' }, pw, pw2, hint), err,
        h('div', { class: 'row' }, h('button', { class: 'ghost-btn', onclick: () => done(null) }, 'Cancel'), h('button', { class: 'primary-btn', onclick: submit }, ok)));
      const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) done(null); } }, box);
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submit(); }
      };
      document.addEventListener('keydown', onKey, true);
      document.getElementById('layer').append(back);
      pw.focus();
    });
  }

  /* Dialog asking for the current password; check(password) resolves true when it's right. */
  function askPassword({ title, text, ok, hint, check }) {
    return new Promise((resolve) => {
      UI.closeAll();
      const pw = h('input', { class: 'field', type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
      const err = h('div', { class: 'lock-error' });
      const okBtn = h('button', { class: 'primary-btn', onclick: () => submit() }, ok);
      const done = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
      const submit = async () => {
        if (!pw.value) return;
        okBtn.disabled = true;
        const good = await check(pw.value);
        okBtn.disabled = false;
        if (good) return done(pw.value);
        err.textContent = 'Wrong password.' + (hint ? ` Hint: ${hint}` : '');
        box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
        pw.select();
      };
      const box = h('div', { class: 'pop dialog lock-dialog' },
        h('div', { class: 'lock-badge', html: ICONS.lock }), h('h3', { text: title }), h('p', { text }),
        h('div', { class: 'lock-fields' }, pw), err,
        h('div', { class: 'row' }, h('button', { class: 'ghost-btn', onclick: () => done(null) }, 'Cancel'), okBtn));
      const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) done(null); } }, box);
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submit(); }
      };
      document.addEventListener('keydown', onKey, true);
      document.getElementById('layer').append(back);
      pw.focus();
    });
  }

  window.GNLock = { protect, unlock, seal, askNewPassword, askPassword };
})();
