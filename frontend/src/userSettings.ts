import type { MapTileLayerKey } from "./calculator/mapTileLayers";

export const SETTINGS_VERSION = 1;

export interface UserSettings {
  settingsVersion: number;
  etaMarginOpen: number;
  etaMarginClose: number;
  /** Persisted amenity stop types. Undefined = use all (default). */
  stopTypes?: string[];
  /** Persisted nearby-stop search radius in metres. */
  stopRadiusM?: number;
  /** Default map tile layer for all map components. */
  defaultMapStyle?: MapTileLayerKey;
}

export const USER_SETTINGS_DEFAULTS: UserSettings = {
  settingsVersion: SETTINGS_VERSION,
  etaMarginOpen: 15,
  etaMarginClose: 7,
};

const LS_KEY = "user_settings_v1";

export function loadSettingsFromStorage(): UserSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...USER_SETTINGS_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return {
      ...USER_SETTINGS_DEFAULTS,
      ...parsed,
      settingsVersion: SETTINGS_VERSION,
    };
  } catch {
    return { ...USER_SETTINGS_DEFAULTS };
  }
}

export function saveSettingsToStorage(settings: UserSettings): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(settings));
  } catch {
    // localStorage unavailable — silently ignore
  }
}
