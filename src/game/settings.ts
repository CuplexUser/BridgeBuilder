import { sfx } from '../audio';
import { available, detectLocale, LANGUAGES, setLocale, t, type Lang } from '../i18n';
import { applyStatic } from '../i18n/dom';
import { motion } from '../motion';
import { canVibrate, vibrate } from '../platform';
import { setStressPalette } from '../render/palette';
import { savePrefs, type StressPalette, type VolumeBus } from '../storage';
import type { ScreenId } from '../ui/ui';
import type { Game } from './game';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * The Settings screen, over the title or the pause menu: language, volume, vibration, motion and
 * the stress colors. They're the device's, kept in its prefs, and apply as they change.
 */
export class Settings {
  /** The screen Settings was opened over, while it's open. */
  from: ScreenId | null = null;

  constructor(private game: Game) {
    const screen = $('scr-settings');
    screen.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement;
      if (el.classList.contains('set-volume')) this.setVolume(el.dataset.bus as VolumeBus, Number(el.value), false);
    });
    screen.addEventListener('change', (e) => {
      const el = e.target as HTMLInputElement;
      if (el.classList.contains('set-volume')) this.setVolume(el.dataset.bus as VolumeBus, Number(el.value), true);
      else if (el.id === 'set-lang') void this.setLanguage(el.value || undefined);
      else if (el.id === 'set-haptics') this.setHaptics(el.checked);
      else if (el.id === 'set-motion') this.setReduceMotion(el.checked);
    });
  }

  /** Puts the saved settings in force, at start. The language is set before the game is made (main.ts). */
  apply(): void {
    const p = this.game.prefs;
    for (const [bus, v] of Object.entries(p.volume ?? {})) sfx.setVolume(bus as VolumeBus, v);
    if (p.reduceMotion !== undefined) motion.reduced = p.reduceMotion;
    document.documentElement.dataset.motion = motion.reduced ? 'reduce' : 'full';
    setStressPalette(p.stressPalette ?? 'classic');
  }

  open(): void {
    sfx.ui();
    this.from ??= this.game.ui.current ?? 'title';
    this.render();
    this.game.ui.show('settings');
  }

  close(): void {
    if (!this.from) return;
    sfx.ui();
    this.game.ui.show(this.from);
    this.from = null;
  }

  /** Sets every control from the prefs, in the current language. */
  private render(): void {
    const p = this.game.prefs;
    // What "Automatic" gives: the device's language if the game has it, or English.
    const device = available().includes(detectLocale()) ? detectLocale() : 'en';
    const auto = LANGUAGES.find((l) => l.code === device)!.name;
    $<HTMLSelectElement>('set-lang').innerHTML =
      `<option value="">${t('settings.auto', { lang: auto })}</option>` +
      available()
        .map((code) => `<option value="${code}" lang="${code}">${LANGUAGES.find((l) => l.code === code)!.name}</option>`)
        .join('');
    $<HTMLSelectElement>('set-lang').value = p.lang && available().includes(p.lang as Lang) ? p.lang : '';
    for (const el of document.querySelectorAll<HTMLInputElement>('.set-volume')) el.value = String(sfx.volume[el.dataset.bus as VolumeBus]);
    $('set-haptics-row').classList.toggle('hidden', !canVibrate);
    $<HTMLInputElement>('set-haptics').checked = this.game.haptics.enabled;
    $<HTMLInputElement>('set-motion').checked = motion.reduced;
    this.renderPalette(p.stressPalette ?? 'classic');
  }

  private renderPalette(palette: StressPalette): void {
    for (const b of document.querySelectorAll<HTMLElement>('#scr-settings [data-palette]')) b.classList.toggle('on', b.dataset.palette === palette);
    $('set-ramp').dataset.palette = palette;
  }

  /** Switches language and writes everything on screen again in it. Unset follows the device. */
  async setLanguage(code: string | undefined): Promise<void> {
    this.game.prefs.lang = code;
    savePrefs(this.game.prefs);
    await setLocale(code ?? detectLocale());
    applyStatic();
    this.game.relabel();
    this.render();
  }

  /** `done`: the slider was let go, so play a click at the new level. */
  private setVolume(bus: VolumeBus, v: number, done: boolean): void {
    sfx.unlock();
    sfx.setVolume(bus, v);
    if (!done) return;
    this.game.prefs.volume = { ...this.game.prefs.volume, [bus]: v };
    savePrefs(this.game.prefs);
    sfx.ui();
  }

  private setHaptics(on: boolean): void {
    this.game.haptics.enabled = on;
    this.game.prefs.haptics = on;
    savePrefs(this.game.prefs);
    if (on) vibrate('heavy');
  }

  private setReduceMotion(on: boolean): void {
    this.game.prefs.reduceMotion = on;
    savePrefs(this.game.prefs);
    this.apply();
    sfx.ui();
  }

  setPalette(palette: StressPalette): void {
    this.game.prefs.stressPalette = palette;
    savePrefs(this.game.prefs);
    setStressPalette(palette);
    this.renderPalette(palette);
    sfx.select();
  }
}
