import { useAppSettings } from "../AppSettingsContext";

/** Initiates Google OAuth login by navigating to the backend auth route. */
export function login() {
  window.location.href = "/v1/auth/google";
}

/** Calls the backend logout endpoint and clears the user from context. */
export async function logoutRequest(): Promise<void> {
  await fetch("/v1/auth/logout", { method: "POST", credentials: "include" });
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
