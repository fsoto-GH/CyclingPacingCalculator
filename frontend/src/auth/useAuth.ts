import { supabase } from "../supabaseClient";
import { useAppSettings } from "../AppSettingsContext";

/** Initiates Google OAuth login via Supabase Auth. */
export function login() {
  // Keep the deployed path (e.g. GitHub Pages project subpath) instead of
  // redirecting only to origin.
  const redirectTo = window.location.href.split("#")[0];
  supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
    },
  });
}

/** Signs out the current user via Supabase Auth. */
export async function logoutRequest(): Promise<void> {
  await supabase.auth.signOut();
}

/**
 * Convenience hook exposing auth state and actions.
 * Must be used inside <AppSettingsProvider>.
 */
export function useAuth() {
  const { user, setUser, authLoading } = useAppSettings();

  async function logout() {
    await logoutRequest();
    setUser(null);
  }

  return { user, authLoading, login, logout };
}
