const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const isMac = process.platform === 'darwin';
const dataDir = () => app.getPath('userData');
const dataFile = () => path.join(dataDir(), 'notes.json');
const backupFile = () => path.join(dataDir(), 'notes.backup.json');
const stateFile = () => path.join(dataDir(), 'window.json');

let win;

// Lets tests run against a throwaway data folder.
if (process.env.GLASS_NOTES_DATA) app.setPath('userData', process.env.GLASS_NOTES_DATA);

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// Write to a temp file first, then rename, so a crash never leaves a half-written file.
function writeAtomic(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function createWindow() {
  const saved = readJSON(stateFile()) || {};
  win = new BrowserWindow({
    width: saved.width || 1280,
    height: saved.height || 820,
    x: saved.x,
    y: saved.y,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#07070d',
    title: 'Glass Notes',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: isMac ? undefined : { color: '#00000000', symbolColor: '#d9d6f2', height: 40 },
    trafficLightPosition: { x: 16, y: 13 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  if (saved.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Links inside notes open in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) {
      e.preventDefault();
      if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    }
  });

  const saveBounds = () => {
    if (!win || win.isDestroyed()) return;
    const b = win.getNormalBounds();
    try { writeAtomic(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() })); } catch {}
  };
  // Before closing, let the page write any unsaved typing to disk.
  let allowClose = false;
  win.on('close', (e) => {
    saveBounds();
    if (allowClose) return;
    e.preventDefault();
    const done = () => { allowClose = true; if (!win.isDestroyed()) win.close(); };
    ipcMain.once('app:flushed', done);
    win.webContents.send('app:flush');
    setTimeout(done, 1500);
  });
}

ipcMain.handle('data:load', () => {
  return readJSON(dataFile()) || readJSON(backupFile());
});

let lastBackup = 0;
ipcMain.handle('data:save', (_e, text) => {
  fs.mkdirSync(dataDir(), { recursive: true });
  // Keep a rolling backup of the previous good version, at most every 5 minutes.
  if (Date.now() - lastBackup > 5 * 60 * 1000 && fs.existsSync(dataFile())) {
    try { fs.copyFileSync(dataFile(), backupFile()); lastBackup = Date.now(); } catch {}
  }
  writeAtomic(dataFile(), text);
  return true;
});

ipcMain.handle('data:location', () => dataFile());
ipcMain.handle('data:reveal', () => shell.showItemInFolder(dataFile()));

// Embed the bundled fonts so exported pages look the same on any computer.
let fontCss = null;
function embedFonts(html) {
  if (fontCss === null) {
    const dir = path.join(__dirname, 'renderer', 'fonts');
    const face = (family, file, style, weight, range) => {
      try {
        const b64 = fs.readFileSync(path.join(dir, file)).toString('base64');
        return `@font-face{font-family:"${family}";font-style:${style};font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${b64}) format("woff2");${range ? `unicode-range:${range};` : ''}}`;
      } catch { return ''; }
    };
    fontCss = [
      face('Inter', 'inter-latin-wght-normal.woff2', 'normal', '100 900', 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'),
      face('Inter', 'inter-latin-ext-wght-normal.woff2', 'normal', '100 900', 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+20A0-20AB,U+20AD-20C0,U+2C60-2C7F,U+A720-A7FF'),
      face('Inter', 'inter-cyrillic-wght-normal.woff2', 'normal', '100 900', 'U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116'),
      face('Inter', 'inter-latin-wght-italic.woff2', 'italic', '100 900', 'U+0000-00FF,U+2000-206F'),
      face('Instrument Serif', 'instrument-serif-latin-400-normal.woff2', 'normal', '400'),
      face('Instrument Serif', 'instrument-serif-latin-400-italic.woff2', 'italic', '400'),
      face('JetBrains Mono', 'jetbrains-mono-latin-wght-normal.woff2', 'normal', '100 800'),
    ].join('\n');
  }
  return String(html).replace('/*@FONTS@*/', () => fontCss);
}

function safeName(name) {
  return (name || 'Untitled').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 80) || 'Untitled';
}

ipcMain.handle('export:html', async (_e, { title, html }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export as web page',
    defaultPath: path.join(app.getPath('documents'), safeName(title) + '.html'),
    filters: [{ name: 'Web page', extensions: ['html'] }],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, embedFonts(html), 'utf8');
  return filePath;
});

ipcMain.handle('export:pdf', async (_e, { title, html }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export as PDF',
    defaultPath: path.join(app.getPath('documents'), safeName(title) + '.pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return null;
  const pdf = await renderPdf(html);
  fs.writeFileSync(filePath, pdf);
  return filePath;
});

async function renderPdf(html) {
  const tmp = path.join(app.getPath('temp'), `glass-notes-${Date.now()}.html`);
  fs.writeFileSync(tmp, embedFonts(html), 'utf8');
  const pw = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
  try {
    await pw.loadFile(tmp);
    await pw.webContents.executeJavaScript('document.fonts ? document.fonts.ready.then(()=>1) : 1').catch(() => {});
    return await pw.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      preferCSSPageSize: true,
    });
  } finally {
    pw.destroy();
    fs.rm(tmp, () => {});
  }
}

ipcMain.handle('shell:open', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('image:pick', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Insert image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
  });
  if (canceled || !filePaths[0]) return null;
  const file = filePaths[0];
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    if (!isMac) Menu.setApplicationMenu(null);
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
}
