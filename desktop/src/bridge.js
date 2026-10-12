// The desktop app's bridge to the page: what src/desktop.ts describes as window.bridgeDesktop.
// desktop/src/main.rs runs this before the page's own scripts, with the app's version and whether
// this is a development build filled in. It talks to the Rust side only through Tauri's IPC, so
// the web build needs no Tauri package.
(() => {
  // oxlint-disable-next-line no-underscore-dangle -- Tauri's own name
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const dev = __DEV__;

  window.bridgeDesktop = Object.freeze({
    version: '__VERSION__',
    saveFile: (name, data) => invoke('save_file', data, { headers: { 'x-name': encodeURIComponent(String(name)) } }),
  });

  // No menu bar, so F11 is handled here. Outside development, the browser's own keys (reload,
  // find, print) are kept from the game; in development Ctrl+R reloads and F12 opens the
  // developer tools as in a browser.
  window.addEventListener(
    'keydown',
    (e) => {
      const key = e.key.toLowerCase();
      if (e.key === 'F11') {
        e.preventDefault();
        void invoke('toggle_fullscreen');
      } else if (!dev && (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && ['r', 'f', 'g', 'p', 'u'].includes(key)))) {
        e.preventDefault();
      }
    },
    true,
  );

  // The WebView's own right-click menu (back, reload, print) has no place in a game. Text fields
  // keep theirs for cut, copy and paste.
  if (!dev) {
    window.addEventListener('contextmenu', (e) => {
      if (!(e.target instanceof Element && e.target.closest('input, textarea, [contenteditable]'))) e.preventDefault();
    });
  }
})();
