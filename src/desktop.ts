/**
 * What the desktop app's bridge script (desktop/src/bridge.js) puts on `window.bridgeDesktop`.
 * The Tauri shell serves the same web build; this is all it adds.
 */
export interface DesktopBridge {
  /** The installed app's version. */
  version: string;
  /** Asks where to save a file and writes it there. Resolves false if the player cancels. */
  saveFile(name: string, data: Uint8Array): Promise<boolean>;
}
