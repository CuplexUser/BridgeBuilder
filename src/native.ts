/** The Android side of `platform.ts`, loaded only inside the app. */
import { App } from '@capacitor/app';
import { Clipboard } from '@capacitor/clipboard';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { Share } from '@capacitor/share';
import type { AppHooks } from './platform';
import type { KeyValue } from './storage';

export interface Native {
  storage: KeyValue;
  bindApp(game: AppHooks): void;
  exportFile(name: string, text: string): Promise<void>;
  copyText(text: string): Promise<void>;
}

/**
 * Saves live in native preferences rather than the WebView's localStorage, which the system may
 * clear. The game reads storage synchronously, so everything is loaded into memory once at startup
 * and every write goes to both.
 */
async function nativeStorage(): Promise<KeyValue> {
  const data = new Map<string, string>();
  const { keys } = await Preferences.keys();
  const values = await Promise.all(keys.map((key) => Preferences.get({ key })));
  keys.forEach((key, i) => {
    const { value } = values[i];
    if (value !== null) data.set(key, value);
  });
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
      void Preferences.set({ key, value });
    },
  };
}

export async function createNative(): Promise<Native> {
  return {
    storage: await nativeStorage(),
    bindApp(game) {
      // Back where there's nothing left to close sends the app to the background, as Android apps do.
      void App.addListener('backButton', () => {
        if (!game.back()) void App.minimizeApp();
      });
      void App.addListener('pause', () => game.suspend());
    },
    async exportFile(name, text) {
      const { uri } = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
      try {
        await Share.share({ title: name, files: [uri], dialogTitle: 'Save or send the level' });
      } catch {
        // Closing the share sheet without picking anything isn't an error.
      }
    },
    copyText: (text) => Clipboard.write({ string: text }),
  };
}
