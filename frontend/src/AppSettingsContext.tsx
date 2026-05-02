import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { getAuthUser } from "./api";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
}

interface AppSettingsContextValue {
  /** Whether the user has turned on paid/premium API features. */
  paidApisEnabled: boolean;
  setPaidApisEnabled: (enabled: boolean) => void;
  /** Currently authenticated user, or null if not signed in. */
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => void;
  /** True while the initial /v1/auth/me request is in flight. */
  authLoading: boolean;
}

const AppSettingsContext = createContext<AppSettingsContextValue>({
  paidApisEnabled: false,
  setPaidApisEnabled: () => {},
  user: null,
  setUser: () => {},
  authLoading: false,
});

const PAID_APIS_KEY = "paidApisEnabled";

export function AppSettingsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [paidApisEnabled, _setPaidApisEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(PAID_APIS_KEY) === "true";
    } catch {
      return false;
    }
  });

  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const setPaidApisEnabled = useCallback((enabled: boolean) => {
    _setPaidApisEnabled(enabled);
    try {
      localStorage.setItem(PAID_APIS_KEY, String(enabled));
    } catch {
      /* storage unavailable */
    }
  }, []);

  // Hydrate user from the server on mount (session cookie already set by browser)
  useEffect(() => {
    getAuthUser()
      .then((u) => setUser(u))
      .catch(() => setUser(null))
      .finally(() => setAuthLoading(false));
  }, []);

  return (
    <AppSettingsContext.Provider
      value={{
        paidApisEnabled,
        setPaidApisEnabled,
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
