/** The Android side of `platform.ts`, loaded only inside the app. */
import { App } from '@capacitor/app';
import { Clipboard } from '@capacitor/clipboard';
import { registerPlugin } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Preferences } from '@capacitor/preferences';
import { Share } from '@capacitor/share';
import type { AppHooks, Pulse } from './platform';
import type { KeyValue } from './storage';

export interface GamesStatus {
  /** The build carries a Play Games project id and the device has Play services. */
  available: boolean;
  signedIn: boolean;
  /** The player's Play Games name, once signed in. */
  player?: string;
}

export interface BillingStatus {
  /** Google Play billing answered. */
  available: boolean;
  /** The full game has been bought on this Google account. */
  owned: boolean;
  /** A purchase is waiting on payment, such as cash at a store. */
  pending?: boolean;
  /** The full game's price, formatted for the player's country. */
  price?: string;
}

/** The game's Java plugins in android/app/src/main/java/se/cuplex/bridgebuilder. */
interface GamesPlugin {
  status(): Promise<GamesStatus>;
  signIn(): Promise<GamesStatus>;
  unlock(o: { key: string }): Promise<void>;
  submitScore(o: { key: string; score: number }): Promise<void>;
  showAchievements(): Promise<void>;
  showLeaderboards(): Promise<void>;
  loadSave(o: { name: string }): Promise<{ data: string | null }>;
  writeSave(o: { name: string; data: string; description: string }): Promise<void>;
}

interface BillingPlugin {
  status(o: { product: string }): Promise<BillingStatus>;
  buy(o: { product: string }): Promise<BillingStatus>;
  restore(o: { product: string }): Promise<BillingStatus>;
  addListener(event: 'change', fn: (s: BillingStatus) => void): Promise<unknown>;
}

const PlayGames = registerPlugin<GamesPlugin>('PlayGames');
const PlayBilling = registerPlugin<BillingPlugin>('PlayBilling');

/** The one-time in-app product that opens every chapter, as set up in the Play Console. */
const FULL_GAME = 'full_game';
/** The Play Games saved game that carries the device's profiles and progress. */
const CLOUD_SAVE = 'progress';

export interface Native {
  storage: KeyValue;
  /** The installed app's versionName. */
  version: string;
  bindApp(game: AppHooks): void;
  exportFile(name: string, text: string): Promise<void>;
  shareVideo(name: string, video: Blob): Promise<void>;
  copyText(text: string): Promise<void>;
  vibrate(pulse: Pulse): void;
  games: {
    status(): Promise<GamesStatus>;
    signIn(): Promise<GamesStatus>;
    unlock(key: string): Promise<void>;
    submitScore(key: string, score: number): Promise<void>;
    showAchievements(): Promise<void>;
    showLeaderboards(): Promise<void>;
    loadSave(): Promise<string | null>;
    writeSave(data: string, description: string): Promise<void>;
  };
  billing: {
    status(): Promise<BillingStatus>;
    buy(): Promise<BillingStatus>;
    restore(): Promise<BillingStatus>;
    onChange(fn: (s: BillingStatus) => void): void;
  };
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

/** Writes a file to the app's cache and opens the share sheet on it. */
async function shareCached(name: string, data: string, encoding: Encoding | undefined, dialogTitle: string): Promise<void> {
  const { uri } = await Filesystem.writeFile({ path: name, data, directory: Directory.Cache, encoding });
  try {
    await Share.share({ title: name, files: [uri], dialogTitle });
  } catch {
    // Closing the share sheet without picking anything isn't an error.
  }
}

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.addEventListener('load', () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1)));
    r.addEventListener('error', () => reject(r.error ?? new Error('Could not read the video')));
    r.readAsDataURL(blob);
  });
}

/** A Play call that fails (no Play services, no network) never takes the game down with it. */
const quiet = (p: Promise<unknown>): void => void p.catch(() => undefined);

export async function createNative(): Promise<Native> {
  const { version } = await App.getInfo();
  return {
    storage: await nativeStorage(),
    version,
    bindApp(game) {
      // Back where there's nothing left to close sends the app to the background, as Android apps do.
      void App.addListener('backButton', () => {
        if (!game.back()) void App.minimizeApp();
      });
      void App.addListener('pause', () => game.suspend());
    },
    exportFile: (name, text) => shareCached(name, text, Encoding.UTF8, 'Save or send the level'),
    async shareVideo(name, video) {
      await shareCached(name, await base64(video), undefined, 'Share the collapse');
    },
    copyText: (text) => Clipboard.write({ string: text }),
    vibrate(pulse) {
      if (pulse === 'long') quiet(Haptics.vibrate({ duration: 220 }));
      else quiet(Haptics.impact({ style: pulse === 'light' ? ImpactStyle.Light : ImpactStyle.Heavy }));
    },
    games: {
      status: () => PlayGames.status().catch(() => ({ available: false, signedIn: false })),
      signIn: () => PlayGames.signIn().catch(() => ({ available: false, signedIn: false })),
      unlock: (key) => PlayGames.unlock({ key }),
      submitScore: (key, score) => PlayGames.submitScore({ key, score }),
      showAchievements: () => PlayGames.showAchievements(),
      showLeaderboards: () => PlayGames.showLeaderboards(),
      loadSave: async () => (await PlayGames.loadSave({ name: CLOUD_SAVE })).data,
      writeSave: (data, description) => PlayGames.writeSave({ name: CLOUD_SAVE, data, description }),
    },
    billing: {
      status: () => PlayBilling.status({ product: FULL_GAME }).catch(() => ({ available: false, owned: false })),
      buy: () => PlayBilling.buy({ product: FULL_GAME }),
      restore: () => PlayBilling.restore({ product: FULL_GAME }),
      onChange: (fn) => quiet(PlayBilling.addListener('change', fn)),
    },
  };
}
