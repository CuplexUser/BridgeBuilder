/**
 * Differences between the web build and the Android app (Capacitor). The game itself is the same
 * code on both; this module only swaps device storage, file export, the clipboard and the back button.
 * The native side is loaded on demand, so the web build carries none of it.
 */
import { Capacitor } from '@capacitor/core';
import type { Native } from './native';
import { useDeviceStorage } from './storage';

/** True inside the Android app, false in a browser. */
export const isNative = Capacitor.isNativePlatform();

let native: Native | null = null;

/** Sets up the app shell. Runs before the game starts, since profiles and saves load from its storage. */
export async function initPlatform(): Promise<void> {
  if (!isNative) return;
  native = await (await import('./native')).createNative();
  useDeviceStorage(native.storage);
}

/** What the app shell needs from the game. */
export interface AppHooks {
  /** The back button. Returns false when there is nothing to go back to and the app should close. */
  back(): boolean;
  /** The app went to the background. */
  suspend(): void;
}

/** The installed app's version, or null in a browser, where the site has no version to show. */
export function appVersion(): string | null {
  return native?.version ?? null;
}

export function bindApp(game: AppHooks): void {
  native?.bindApp(game);
}

/** Hands a text file to the player: a download in the browser, the share sheet in the app. */
export async function exportFile(name: string, text: string): Promise<void> {
  if (native) return native.exportFile(name, text);
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string): Promise<void> {
  if (native) return native.copyText(text);
  if (!navigator.clipboard) throw new Error('No clipboard');
  await navigator.clipboard.writeText(text);
}
