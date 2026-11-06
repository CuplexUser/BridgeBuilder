/** The Android side of `platform.ts`, loaded only inside the app. */
import { App } from '@capacitor/app';
import { Clipboard } from '@capacitor/clipboard';
import { registerPlugin } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Preferences } from '@capacitor/preferences';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { Share } from '@capacitor/share';
import type { AppHooks, Pulse, RichHaptics } from './platform';
import type { KeyValue } from './storage';
import { t } from './i18n';

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

interface StorePlugin {
  requestReview(): Promise<void>;
  openListing(): Promise<void>;
}

interface RumblePlugin {
  capabilities(): Promise<{ tier: 'full' | 'amplitude' | 'basic' }>;
  play(o: { timings: number[]; amplitudes: number[] }): Promise<void>;
  primitive(o: { name: 'tick' | 'thud'; scale: number }): Promise<void>;
  stop(): Promise<void>;
}

const PlayGames = registerPlugin<GamesPlugin>('PlayGames');
const PlayBilling = registerPlugin<BillingPlugin>('PlayBilling');
const PlayStore = registerPlugin<StorePlugin>('PlayStore');
const Rumble = registerPlugin<RumblePlugin>('Rumble');

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
  /** Opens the share sheet on a picture, with a message (and its link) to go with it. */
  shareImage(name: string, image: Blob, text: string): Promise<void>;
  /** Calls back with each link the app is opened with, the one that launched it first. */
  onLink(fn: (url: string) => void): void;
  copyText(text: string): Promise<void>;
  vibrate(pulse: Pulse): void;
  /** What the phone's vibrator can do beyond plain pulses; null if nothing. */
  richHaptics(): Promise<RichHaptics | null>;
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
  /** Asks Google Play for its rating card, which it may or may not show. */
  requestReview(): Promise<void>;
  /** Opens the game's page on Google Play, where it can be rated. */
  openListing(): Promise<void>;
  /** Turns the screen to landscape from portrait or back, and holds it there whatever the phone's auto-rotate says. */
  rotate(): Promise<void>;
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
async function shareCached(name: string, data: string, encoding: Encoding | undefined, dialogTitle: string, text?: string): Promise<void> {
  const { uri } = await Filesystem.writeFile({ path: name, data, directory: Directory.Cache, encoding });
  try {
    await Share.share({ title: name, text, files: [uri], dialogTitle });
  } catch {
    // Closing the share sheet without picking anything isn't an error.
  }
}

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.addEventListener('load', () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1)));
    r.addEventListener('error', () => reject(r.error ?? new Error('Could not read the file')));
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
    exportFile: (name, text) => shareCached(name, text, Encoding.UTF8, t('share.levelTitle')),
    async shareImage(name, image, text) {
      await shareCached(name, await base64(image), undefined, t('share.bridgeTitle'), text);
    },
    onLink(fn) {
      void App.getLaunchUrl().then((launch) => launch?.url && fn(launch.url));
      void App.addListener('appUrlOpen', (e) => fn(e.url));
    },
    copyText: (text) => Clipboard.write({ string: text }),
    async rotate() {
      const { type } = await ScreenOrientation.orientation();
      await ScreenOrientation.lock({ orientation: type.startsWith('landscape') ? 'portrait' : 'landscape' });
    },
    vibrate(pulse) {
      if (pulse === 'long') quiet(Haptics.vibrate({ duration: 220 }));
      else quiet(Haptics.impact({ style: pulse === 'light' ? ImpactStyle.Light : ImpactStyle.Heavy }));
    },
    async richHaptics() {
      const { tier } = await Rumble.capabilities().catch(() => ({ tier: 'basic' }));
      if (tier === 'basic') return null;
      const wave = (timings: number[], amplitudes: number[]) => quiet(Rumble.play({ timings, amplitudes }));
      // Phones without the primitives get the closest a short waveform can do.
      const full = tier === 'full';
      return {
        wave,
        tick: () => (full ? quiet(Rumble.primitive({ name: 'tick', scale: 0.6 })) : wave([12], [90])),
        thud: () => (full ? quiet(Rumble.primitive({ name: 'thud', scale: 1 })) : wave([50], [200])),
        stop: () => quiet(Rumble.stop()),
      };
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
    requestReview: () => PlayStore.requestReview(),
    openListing: () => PlayStore.openListing(),
  };
}
