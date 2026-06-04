import { createContext, useContext } from "react";
import { SERVER_FUNCTIONS_ENABLED } from "./config";
import {
  type UserSettings,
  SETTINGS_VERSION,
  USER_SETTINGS_DEFAULTS,
} from "./userSettings";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
}

export interface AppSettingsContextValue {
  /** True when paid/external APIs may be used (mirrors SERVER_FUNCTIONS_ENABLED). */
  enableServerFunctions: boolean;
  /** Currently authenticated user, or null if not signed in. */
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => void;
  /** True while the initial Supabase session check is in flight. */
  authLoading: boolean;
  /** True when the current user has Google Maps tile layers enabled. */
  enableGoogleMaps: boolean;
  /** True when the current user has Google Places search enabled. */
  enableGooglePlaces: boolean;
  /** True when the current user may use backend geocoding endpoints. */
  enableGoogleGeocoding: boolean;
  /** Persisted user preferences (localStorage + DB for auth users). */
  userSettings: UserSettings;
  /** Update one or more settings fields. Writes through to localStorage and DB. */
  updateUserSettings: (patch: Partial<UserSettings>) => void;
}

export const AppSettingsContext = createContext<AppSettingsContextValue>({
  enableServerFunctions: SERVER_FUNCTIONS_ENABLED,
  user: null,
  setUser: () => {},
  authLoading: false,
  enableGoogleMaps: false,
  enableGooglePlaces: false,
  enableGoogleGeocoding: false,
  userSettings: {
    ...USER_SETTINGS_DEFAULTS,
    settingsVersion: SETTINGS_VERSION,
  },
  updateUserSettings: () => {},
});

export function useAppSettings(): AppSettingsContextValue {
  return useContext(AppSettingsContext);
}
