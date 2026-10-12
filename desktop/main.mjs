/**
 * The desktop app: an Electron window around the same web build as the site and the Android app.
 * It serves dist/ from an app:// origin (so modules, workers and storage behave as on the web),
 * keeps saves in that origin's storage under the user's app data, remembers the window, and adds
 * a save dialog for exported levels and collapse clips.
 *
 *   npm run desktop        build, then run the app
 *   npm run desktop:dev    run the app against `npm run dev` (http://localhost:5173), with reloads
 *   npm run desktop:dist   build a Windows installer into release/
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, screen, shell } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '..', 'dist');
const dev = process.argv.includes('--dev');
const DEV_URL = 'http://localhost:5173/';
const ORIGIN = 'app://bridge/';
const stateFile = () => path.join(app.getPath('userData'), 'window.json');

// Saves live in one folder whether the app runs from source or installed. Tests pass their own
// with --user-data-dir.
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(app.getPath('appData'), 'Bridge Builder'));

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }]);

/** Serves dist/ at app://bridge/, and nothing outside it. */
function serveDist() {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(dist, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
    if (!file.startsWith(dist + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

/** The window's last size and place, if it still fits on a screen. */
function savedBounds() {
  try {
    const s = JSON.parse(readFileSync(stateFile(), 'utf8'));
    const area = screen.getDisplayMatching(s.bounds).workArea;
    const fits = s.bounds.x >= area.x - 50 && s.bounds.y >= area.y - 50 && s.bounds.width <= area.width + 100 && s.bounds.height <= area.height + 100;
    return fits ? s : null;
  } catch {
    return null;
  }
}

function createWindow() {
  const saved = savedBounds();
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    ...saved?.bounds,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b1d38',
    title: 'Bridge Builder',
    icon: path.join(here, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(here, 'preload.cjs'), sandbox: true, contextIsolation: true },
  });
  if (saved?.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  win.on('close', () => {
    try {
      writeFileSync(stateFile(), JSON.stringify({ bounds: win.getNormalBounds(), maximized: win.isMaximized() }));
    } catch {
      // The window opens at its default size next time.
    }
  });

  // Links out of the game (such as the privacy policy) open in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(ORIGIN) || (dev && url.startsWith(DEV_URL))) return;
    e.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });

  // No menu bar, so the keys a menu would bring are handled here: F11 full screen, and in
  // development F12 for the developer tools and Ctrl+R to reload.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    } else if (!app.isPackaged && input.key === 'F12') {
      win.webContents.toggleDevTools();
      e.preventDefault();
    } else if (!app.isPackaged && input.control && input.key.toLowerCase() === 'r') {
      win.webContents.reload();
      e.preventDefault();
    }
  });

  void win.loadURL(dev ? DEV_URL : `${ORIGIN}index.html`);
}

ipcMain.on('bridge:version', (e) => {
  e.returnValue = app.getVersion();
});

ipcMain.handle('bridge:save-file', async (e, name, data) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const ext = path.extname(String(name)).slice(1);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath(ext === 'json' ? 'documents' : 'videos'), path.basename(String(name))),
    filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [],
  });
  if (canceled || !filePath) return false;
  await writeFile(filePath, Buffer.from(data));
  return true;
});

// One window: a second launch brings the first to the front.
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win?.isMinimized()) win.restore();
    win?.focus();
  });
  Menu.setApplicationMenu(null);
  void app.whenReady().then(() => {
    serveDist();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
