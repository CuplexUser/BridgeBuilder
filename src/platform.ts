/**
 * Differences between the three builds of the one game: the web build, the Android app (Capacitor)
 * and the desktop app (Tauri). The game itself is the same code on all three. This module decides
 * the UI profile (touch-first or dense desktop) and the level editor's size caps, and swaps device
 * storage, file export, shared bridges and their links, the clipboard, the back button, haptics,
 * Play Games and the store.
 * Each shell's side is loaded on demand, so the web build carries none of it.
 */
import { Capacitor } from '@capacitor/core';
import type { DesktopBridge } from './desktop';
import { LIMITS } from './maker';
import type { BillingStatus, GamesStatus, Native } from './native';
import { hasShareLink } from './share';
import { useDeviceStorage } from './storage';

export type PlatformKind = 'web' | 'android' | 'desktop';

/** True inside the Android app. */
export const isNative = Capacitor.isNativePlatform();

const desktopBridge = (globalThis as { bridgeDesktop?: DesktopBridge }).bridgeDesktop;

/** Which build is running. */
export const platform: PlatformKind = isNative ? 'android' : desktopBridge ? 'desktop' : 'web';

/**
 * How the UI is laid out and what it hints at. `touch` is for fingers: big targets, no key hints,
 * no focus jumping to buttons. `desktop` is denser, shows keys and has room for longer levels.
 * A browser picks by its primary pointer, as the stylesheet once did on its own.
 */
export type UiProfile = 'touch' | 'desktop';

export const uiProfile: UiProfile =
  platform === 'android' ? 'touch' : platform === 'desktop' ? 'desktop' : typeof matchMedia === 'function' && matchMedia('(hover: none)').matches ? 'touch' : 'desktop';

/**
 * How big a level the editor will make. Any build loads a level up to LIMITS.maxWidth; on a touch
 * device the editor stops growing one at 64 m, where a phone's physics and screen still keep up.
 */
export const levelCaps = { maxWidth: uiProfile === 'desktop' ? LIMITS.maxWidth : 64 };

let native: Native | null = null;

/** Sets up the app shell. Runs before the game starts, since profiles and saves load from its storage. */
export async function initPlatform(): Promise<void> {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.ui = uiProfile;
    document.documentElement.dataset.platform = platform;
  }
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
  return native?.version ?? desktopBridge?.version ?? null;
}

export function bindApp(game: AppHooks): void {
  native?.bindApp(game);
}

/**
 * Calls back with each shared-bridge link the game is opened with: App Links in the app, the
 * page's own address on the web. The web address drops the link afterwards, so a reload doesn't
 * drive the same bridge again.
 */
export function onLink(fn: (url: string) => void): void {
  if (native) return native.onLink(fn);
  if (desktopBridge || !hasShareLink(location.search)) return;
  const url = location.href;
  const rest = new URLSearchParams(location.search);
  rest.delete('b');
  rest.delete('s');
  history.replaceState(null, '', `${location.pathname}${rest.size ? `?${rest}` : ''}${location.hash}`);
  fn(url);
}

/** Hands a text file to the player: a download in the browser, a save dialog on desktop, the share sheet in the app. */
export async function exportFile(name: string, text: string): Promise<void> {
  if (native) return native.exportFile(name, text);
  if (desktopBridge) {
    await desktopBridge.saveFile(name, new TextEncoder().encode(text));
    return;
  }
  download(name, new Blob([text], { type: 'application/json' }));
}

/** What became of a shared bridge: handed to a share sheet, or its link copied and the picture saved. */
export type ShareOutcome = 'shared' | 'copied';

/**
 * Hands a picture and a link to the player: the share sheet in the app and in browsers that can
 * share; elsewhere the link goes on the clipboard and the picture to a save dialog (desktop) or
 * a download.
 */
export async function shareBridge(name: string, image: Blob, text: string, url: string): Promise<ShareOutcome> {
  if (native) {
    await native.shareImage(name, image, `${text} ${url}`);
    return 'shared';
  }
  if (!desktopBridge) {
    const withPicture = { files: [new File([image], name, { type: image.type })], text: `${text} ${url}`, title: 'Bridge Builder' };
    try {
      if (navigator.canShare?.(withPicture)) await navigator.share(withPicture);
      else if (typeof navigator.share === 'function') await navigator.share({ text, url, title: 'Bridge Builder' });
      else throw new Error('No share sheet');
      return 'shared';
    } catch (e) {
      // Closing the share sheet without picking anything isn't an error; anything else falls back to the clipboard.
      if (e instanceof DOMException && e.name === 'AbortError') return 'shared';
    }
  }
  await copyText(url);
  if (desktopBridge) await desktopBridge.saveFile(name, new Uint8Array(await image.arrayBuffer()));
  else download(name, image);
  return 'copied';
}

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string): Promise<void> {
  if (native) return native.copyText(text);
  if (!navigator.clipboard) throw new Error('No clipboard');
  await navigator.clipboard.writeText(text);
}

// ───────────────────────────── Haptics ─────────────────────────────

/** How hard a haptic pulse is: a creak, a member snapping, or the whole bridge going down. */
export type Pulse = 'light' | 'heavy' | 'long';

/** True where the device can buzz: the app, and phone browsers with the Vibration API. */
export const canVibrate = isNative || (uiProfile === 'touch' && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function');

/** One haptic pulse, fire and forget. */
export function vibrate(pulse: Pulse): void {
  if (native) {
    native.vibrate(pulse);
    return;
  }
  if (!canVibrate) return;
  try {
    navigator.vibrate(pulse === 'light' ? 8 : pulse === 'heavy' ? 40 : [70, 50, 160]);
  } catch {
    // Some browsers refuse until the page has been tapped.
  }
}

// ───────────────────────────── Play Games ─────────────────────────────

export type { GamesStatus };

/**
 * Google Play Games Services: achievements, leaderboards and a cloud save. Only the Android app
 * has them, and only once the Play Console's game IDs are in the build (android/.../games-ids.xml).
 * Achievements and leaderboards are named by their key in that file, without the
 * `achievement_` or `leaderboard_` prefix. An unlock or score rejects if it didn't reach Play Games.
 */
export const games = {
  status: (): Promise<GamesStatus> => native?.games.status() ?? Promise.resolve({ available: false, signedIn: false }),
  signIn: (): Promise<GamesStatus> => native?.games.signIn() ?? Promise.resolve({ available: false, signedIn: false }),
  unlock: (key: string): Promise<void> => native?.games.unlock(key) ?? Promise.reject(new Error('No Play Games here')),
  submitScore: (key: string, score: number): Promise<void> => native?.games.submitScore(key, score) ?? Promise.reject(new Error('No Play Games here')),
  showAchievements: (): Promise<void> => native?.games.showAchievements() ?? Promise.resolve(),
  showLeaderboards: (): Promise<void> => native?.games.showLeaderboards() ?? Promise.resolve(),
  loadSave: (): Promise<string | null> => native?.games.loadSave() ?? Promise.resolve(null),
  writeSave: (data: string, description: string): Promise<void> => native?.games.writeSave(data, description) ?? Promise.resolve(),
};

// ───────────────────────────── Store ─────────────────────────────

export type { BillingStatus };

/**
 * The one-time unlock of the full game, through Google Play. Only the Android app has a paywall:
 * the web and desktop builds are the whole game for free.
 */
export const hasPaywall = platform === 'android';

export const billing = {
  status: (): Promise<BillingStatus> => native?.billing.status() ?? Promise.resolve({ available: false, owned: false }),
  buy: (): Promise<BillingStatus> => native?.billing.buy() ?? Promise.resolve({ available: false, owned: false }),
  restore: (): Promise<BillingStatus> => native?.billing.restore() ?? Promise.resolve({ available: false, owned: false }),
  /** Called when a purchase completes outside a buy() call, such as a pending one that went through later. */
  onChange: (fn: (s: BillingStatus) => void): void => native?.billing.onChange(fn),
};
