import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { getAuthUser } from "./api";
import { PAID_APIS_ENABLED } from "./config";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
}

interface AppSettingsContextValue {
  /** Master frontend switch for paid API controls. If false, force free APIs. */
  paidApisFrontendEnabled: boolean;
  setPaidApisFrontendEnabled: (enabled: boolean) => void;
  /** Free vs. freemium mode toggle (only meaningful when paidApisFrontendEnabled=true). */
  useFreemiumApis: boolean;
  setUseFreemiumApis: (enabled: boolean) => void;
  /** Effective paid API usage flag consumed by API routing call sites. */
  paidApisEnabled: boolean;
  /** Currently authenticated user, or null if not signed in. */
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => void;
  /** True while the initial /v1/auth/me request is in flight. */
  authLoading: boolean;
}

const AppSettingsContext = createContext<AppSettingsContextValue>({
  paidApisFrontendEnabled: false,
  setPaidApisFrontendEnabled: () => {},
  useFreemiumApis: false,
  setUseFreemiumApis: () => {},
  paidApisEnabled: false,
  user: null,
  setUser: () => {},
  authLoading: false,
});

const FRONTEND_ENABLE_KEY = "paidApisFrontendEnabled";
const FREEMIUM_MODE_KEY = "useFreemiumApis";
const LEGACY_PAID_APIS_KEY = "paidApisEnabled";

export function AppSettingsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [paidApisFrontendEnabled, _setPaidApisFrontendEnabled] =
    useState<boolean>(() => {
      try {
        return localStorage.getItem(FRONTEND_ENABLE_KEY) === "true";
      } catch {
        return false;
      }
    });

  const [useFreemiumApis, _setUseFreemiumApis] = useState<boolean>(() => {
    try {
      // Backward-compatible migration: if the new key doesn't exist yet,
      // fall back to the legacy paidApisEnabled flag.
      const next = localStorage.getItem(FREEMIUM_MODE_KEY);
      if (next != null) return next === "true";
      return localStorage.getItem(LEGACY_PAID_APIS_KEY) === "true";
    } catch {
      return false;
    }
  });

  const paidApisEnabled = paidApisFrontendEnabled && useFreemiumApis;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const setPaidApisFrontendEnabled = useCallback((enabled: boolean) => {
    _setPaidApisFrontendEnabled(enabled);
    try {
      localStorage.setItem(FRONTEND_ENABLE_KEY, String(enabled));
    } catch {
      /* storage unavailable */
    }
  }, []);

  const setUseFreemiumApis = useCallback((enabled: boolean) => {
    _setUseFreemiumApis(enabled);
    try {
      localStorage.setItem(FREEMIUM_MODE_KEY, String(enabled));
      // Keep legacy key in sync so older code paths remain consistent.
      localStorage.setItem(LEGACY_PAID_APIS_KEY, String(enabled));
    } catch {
      /* storage unavailable */
    }
  }, []);

  // Hydrate user from the server on mount (session cookie already set by browser)
  useEffect(() => {
    if (!PAID_APIS_ENABLED || !paidApisFrontendEnabled) {
      setUser(null);
      setAuthLoading(false);
      return;
    }

    setAuthLoading(true);
    getAuthUser()
      .then((u) => setUser(u))
      .catch(() => setUser(null))
      .finally(() => setAuthLoading(false));
  }, [paidApisFrontendEnabled]);

  return (
    <AppSettingsContext.Provider
      value={{
        paidApisFrontendEnabled,
        setPaidApisFrontendEnabled,
        useFreemiumApis,
        setUseFreemiumApis,
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
