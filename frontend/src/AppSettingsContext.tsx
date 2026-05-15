import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { syncUser } from "./api";
import { SERVER_FUNCTIONS_ENABLED } from "./config";

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
}

const AppSettingsContext = createContext<AppSettingsContextValue>({
  paidApisEnabled: false,
  user: null,
  setUser: () => {},
  authLoading: false,
});

export function AppSettingsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const paidApisEnabled = SERVER_FUNCTIONS_ENABLED;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(SERVER_FUNCTIONS_ENABLED);

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

        // Upsert the user in our local DB on every fresh sign-in.
        if (event === "SIGNED_IN" && session?.access_token) {
          syncUser(session.access_token).catch((err) =>
            console.error("[auth] sync failed:", err),
          );
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
      }}
    >
      {children}
    </AppSettingsContext.Provider>
  );
}

export function useAppSettings(): AppSettingsContextValue {
  return useContext(AppSettingsContext);
}
