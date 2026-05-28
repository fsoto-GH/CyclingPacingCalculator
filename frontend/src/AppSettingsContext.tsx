import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { syncUser, fetchUserSettings, putUserSettings } from "./api";
import { SERVER_FUNCTIONS_ENABLED } from "./config";
import {
  type UserSettings,
  SETTINGS_VERSION,
  USER_SETTINGS_DEFAULTS,
  loadSettingsFromStorage,
  saveSettingsToStorage,
} from "./userSettings";
import { supabase } from "./supabaseClient";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
}

interface AppSettingsContextValue {
  /** True when paid/external APIs may be used (mirrors SERVER_FUNCTIONS_ENABLED). */
  paidApisEnabled: boolean;
  /** Currently authenticated user, or null if not signed in. */
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => void;
  /** True while the initial Supabase session check is in flight. */
  authLoading: boolean;
  /** True when the current user has Google Maps tile layers enabled. */
  enableGoogleMaps: boolean;
  /** True when the current user has Google Places search enabled. */
  enableGooglePlaces: boolean;
  /** Persisted user preferences (localStorage + DB for auth users). */
  userSettings: UserSettings;
  /** Update one or more settings fields. Writes through to localStorage and DB. */
  updateUserSettings: (patch: Partial<UserSettings>) => void;
}

const AppSettingsContext = createContext<AppSettingsContextValue>({
  paidApisEnabled: false,
  user: null,
  setUser: () => {},
  authLoading: false,
  enableGoogleMaps: false,
  enableGooglePlaces: false,
  userSettings: { ...USER_SETTINGS_DEFAULTS },
  updateUserSettings: () => {},
});

export function AppSettingsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const paidApisEnabled = SERVER_FUNCTIONS_ENABLED;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(SERVER_FUNCTIONS_ENABLED);
  const [enableGoogleMaps, setEnableGoogleMaps] = useState(false);
  const [enableGooglePlaces, setEnableGooglePlaces] = useState(false);
  const [userSettings, setUserSettingsState] = useState<UserSettings>(
    loadSettingsFromStorage,
  );

  // When an authenticated user signs in, pull their settings from the API.
  // DB wins on conflict; merged result is written back to localStorage as cache.
  useEffect(() => {
    if (!SERVER_FUNCTIONS_ENABLED || !user) return;
    fetchUserSettings()
      .then((raw) => {
        if (!raw || Object.keys(raw).length === 0) return;
        const merged: UserSettings = {
          ...USER_SETTINGS_DEFAULTS,
          ...(raw as Partial<UserSettings>),
          settingsVersion: SETTINGS_VERSION,
        };
        setUserSettingsState(merged);
        saveSettingsToStorage(merged);
      })
      .catch((err) => console.warn("[user_settings] fetch failed:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const updateUserSettings = useCallback(
    (patch: Partial<UserSettings>) => {
      setUserSettingsState((prev) => {
        const next: UserSettings = { ...prev, ...patch };
        saveSettingsToStorage(next);
        if (SERVER_FUNCTIONS_ENABLED && user) {
          putUserSettings(next as unknown as Record<string, unknown>).catch(
            (err) => console.error("[user_settings] upsert failed:", err),
          );
        }
        return next;
      });
    },
    // user is read inside the setState callback via closure — include it
    // so the reference stays fresh after sign-in / sign-out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.id],
  );

  // Hydrate user from the Supabase session on mount, and keep in sync.
  // Skipped entirely when SERVER_FUNCTIONS_ENABLED is false.
  useEffect(() => {
    if (!SERVER_FUNCTIONS_ENABLED) return;

    setAuthLoading(true);

    // Hydrate from existing session immediately.
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user ?? null;
      setUser(
        u
          ? {
              id: u.id,
              email: u.email ?? "",
              name:
                (u.user_metadata?.full_name as string | undefined) ??
                (u.user_metadata?.name as string | undefined) ??
                u.email ??
                "",
              avatar_url:
                (u.user_metadata?.avatar_url as string | undefined) ?? null,
            }
          : null,
      );
      if (data.session?.access_token) {
        syncUser(data.session.access_token)
          .then((res) => {
            setEnableGoogleMaps(res.flags.enable_google_maps);
            setEnableGooglePlaces(res.flags.enable_google_places);
          })
          .catch(() => {});
      }
      setAuthLoading(false);
    });

    // Keep in sync for sign-in / sign-out events.
    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        const u = session?.user ?? null;
        setUser(
          u
            ? {
                id: u.id,
                email: u.email ?? "",
                name:
                  (u.user_metadata?.full_name as string | undefined) ??
                  (u.user_metadata?.name as string | undefined) ??
                  u.email ??
                  "",
                avatar_url:
                  (u.user_metadata?.avatar_url as string | undefined) ?? null,
              }
            : null,
        );
        if (!u) {
          setEnableGoogleMaps(false);
          setEnableGooglePlaces(false);
        }

        // Upsert the user in our local DB on every fresh sign-in.
        if (event === "SIGNED_IN" && session?.access_token) {
          syncUser(session.access_token)
            .then((res) => {
              setEnableGoogleMaps(res.flags.enable_google_maps);
              setEnableGooglePlaces(res.flags.enable_google_places);
            })
            .catch((err) => console.error("[auth] sync failed:", err));
        }
      },
    );

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  return (
    <AppSettingsContext.Provider
      value={{
        paidApisEnabled,
        user,
        setUser,
        authLoading,
        enableGoogleMaps,
        enableGooglePlaces,
        userSettings,
        updateUserSettings,
      }}
    >
      {children}
    </AppSettingsContext.Provider>
  );
}

export function useAppSettings(): AppSettingsContextValue {
  return useContext(AppSettingsContext);
}
