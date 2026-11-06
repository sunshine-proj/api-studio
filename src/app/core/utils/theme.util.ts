import { ThemePreference } from '../models';

/** The theme actually shown for a preference. "system" follows the operating system. */
export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): 'light' | 'dark' {
  return preference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : preference;
}
