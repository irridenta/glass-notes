#!/usr/bin/env node
/* End-to-end smoke test: launches the real Glass Notes app with a throwaway data folder,
   uses it like a person would, and fails loudly if anything core is broken.

   Run:  npm i --no-save playwright    (once)
         node automation/smoke-test.js
   On Linux without a screen:  xvfb-run -a node automation/smoke-test.js
   Screenshots of any failure go to automation/smoke-output/. */
const { _electron: electron } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'smoke-output');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-notes-smoke-'));
const results = [];
let app, win;

async function launch() {
  app = await electron.launch({
    executablePath: require(path.join(ROOT, 'node_modules', 'electron')), // the project's Electron
    args: [ROOT, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, GLASS_NOTES_DATA: DATA },
  });
  win = await app.firstWindow();
  win.errors = [];
  win.on('pageerror', (e) => win.errors.push(e.message));
  win.on('console', (m) => m.type() === 'error' && win.errors.push(m.text()));
  await win.waitForSelector('.tree-row', { timeout: 15000 });
}

async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err: err.message });
    console.log(`  ✗ ${name}\n      ${err.message.split('\n')[0]}`);
    fs.mkdirSync(OUT, { recursive: true });
    if (win) await win.screenshot({ path: path.join(OUT, name.replace(/\W+/g, '-') + '.png') }).catch(() => {});
  }
}

const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const blocksOf = (title) => win.evaluate((t) => {
  const p = Object.values(window.__gn.db.pages).find((x) => x.title === t);
  return p ? p.blocks.map((b) => ({ type: b.type, html: b.html, checked: !!b.checked, indent: b.indent || 0 })) : null;
}, title);

(async () => {
  console.log('Glass Notes smoke test');
  await step('app starts and shows the welcome guide', async () => {
    await launch();
    expect(await win.locator('.tree-row', { hasText: 'Welcome to Glass Notes' }).count() >= 1, 'welcome page missing from sidebar');
  });
  if (!win) { console.log('\nApp did not start; skipping the rest.'); process.exit(1); }

  await step('new page with title and markdown shortcuts', async () => {
    await win.keyboard.press('Control+n');
    await win.keyboard.type('Smoke page');
    await win.keyboard.press('Enter');
    await win.keyboard.type('## Heading ');
    await win.keyboard.type('x'); await win.keyboard.press('Backspace');
    await win.keyboard.type('Section');
    await win.keyboard.press('Enter');
    await win.keyboard.type('[] task one');
    await win.keyboard.press('Enter');
    await win.keyboard.type('task two');
    await win.keyboard.press('Enter'); await win.keyboard.press('Enter');
    await win.keyboard.type('- item');
    await win.keyboard.press('Enter'); await win.keyboard.press('Tab');
    await win.keyboard.type('nested');
    const b = await blocksOf('Smoke page');
    expect(b, 'page not saved in memory');
    const types = b.map((x) => x.type).join(',');
    expect(types.startsWith('h2,todo,todo,bullet,bullet'), `unexpected blocks: ${types}`);
    expect(b[4].indent === 1, 'Tab did not indent the list item');
  });

  await step('slash menu inserts a quote and a code block', async () => {
    await win.keyboard.press('Enter'); await win.keyboard.press('Enter'); await win.keyboard.press('Enter');
    await win.keyboard.type('/quote'); await win.keyboard.press('Enter');
    await win.keyboard.type('Quoted words');
    await win.keyboard.press('Enter');
    await win.keyboard.type('/code'); await win.keyboard.press('Enter');
    await win.keyboard.type('line 1'); await win.keyboard.press('Enter'); await win.keyboard.type('line 2');
    const b = await blocksOf('Smoke page');
    const quote = b.find((x) => x.type === 'quote');
    const code = b.find((x) => x.type === 'code');
    expect(quote && quote.html === 'Quoted words', 'quote not created');
    expect(code && code.html === 'line 1\nline 2', `code block wrong: ${JSON.stringify(code)}`);
  });

  await step('to-do toggles, undo and redo work', async () => {
    await win.locator('.block.todo .check').first().click();
    let b = await blocksOf('Smoke page');
    expect(b[1].checked, 'checkbox click did not tick the to-do');
    await win.locator('.block.todo .text').first().click();
    await win.keyboard.press('Control+z');
    b = await blocksOf('Smoke page');
    expect(!b[1].checked, 'undo did not untick');
    await win.keyboard.press('Control+y');
    b = await blocksOf('Smoke page');
    expect(b[1].checked, 'redo did not re-tick');
  });

  await step('search finds the page', async () => {
    await win.keyboard.press('Escape');
    await win.keyboard.press('Control+k');
    await win.keyboard.type('Smoke');
    expect(await win.locator('.palette .pop-item', { hasText: 'Smoke page' }).count() >= 1, 'search did not list the page');
    await win.keyboard.press('Escape');
  });

  await step('export as web page and PDF', async () => {
    await app.evaluate(({ dialog }, dir) => {
      let i = 0;
      dialog.showSaveDialog = async (_w, o) => ({ canceled: false, filePath: `${dir}/export-${i++}.${o.filters[0].extensions[0]}` });
    }, DATA);
    await win.evaluate(async () => {
      const p = Object.values(window.__gn.db.pages).find((x) => x.title === 'Smoke page');
      await window.__gn.doExport(p, 'html');
      await window.__gn.doExport(p, 'pdf');
    });
    const html = fs.readFileSync(path.join(DATA, 'export-0.html'), 'utf8');
    expect(html.includes('Smoke page') && html.includes('Quoted words'), 'web page export is missing content');
    expect(html.includes('font/woff2;base64'), 'fonts were not embedded in the web page');
    const pdf = fs.readFileSync(path.join(DATA, 'export-1.pdf'));
    expect(pdf.slice(0, 5).toString() === '%PDF-' && pdf.length > 10000, 'PDF export is missing or empty');
  });

  await step('trash and restore', async () => {
    await win.evaluate(() => {
      const p = Object.values(window.__gn.db.pages).find((x) => x.title === 'Smoke page');
      window.__gn.openPage(p.id);
    });
    await win.locator('#moreBtn').click();
    await win.locator('.pop-item', { hasText: 'Move to Trash' }).click();
    expect(await win.locator('.tree-row', { hasText: 'Smoke page' }).count() === 0, 'page still in sidebar after trashing');
    await win.locator('#openTrash').click();
    await win.locator('.list-row', { hasText: 'Smoke page' }).locator('button', { hasText: 'Restore' }).click();
    expect(await win.locator('.tree-row', { hasText: 'Smoke page' }).count() === 1, 'restore did not bring the page back');
  });

  await step('notes survive a restart', async () => {
    await win.waitForTimeout(800);
    await app.close();
    const saved = JSON.parse(fs.readFileSync(path.join(DATA, 'notes.json'), 'utf8'));
    expect(Object.values(saved.pages).some((p) => p.title === 'Smoke page'), 'page missing from notes.json');
    await launch();
    expect(await win.locator('.tree-row', { hasText: 'Smoke page' }).count() === 1, 'page missing after restart');
  });

  await step('no errors in the app console', async () => {
    expect(win.errors.length === 0, win.errors.join(' | '));
  });

  if (app) await app.close().catch(() => {});
  fs.rmSync(DATA, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  if (app) await app.close().catch(() => {});
  process.exit(1);
});
