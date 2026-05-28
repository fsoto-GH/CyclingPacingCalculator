import { createContext, useState } from "react";
import type { ReactNode } from "react";
import { AMENITY_LIST } from "./calculator/overpass";
import { loadSettingsFromStorage } from "./userSettings";

interface AmenityContextValue {
  selectedTypes: Set<string>;
  textQuery: string;
  radiusM: number;
  setSelectedTypes: (v: Set<string>) => void;
  setTextQuery: (v: string) => void;
  setRadiusM: (v: number) => void;
}

export const AmenityContext = createContext<AmenityContextValue>({
  selectedTypes: new Set(AMENITY_LIST),
  textQuery: "",
  radiusM: 1609.34,
  setSelectedTypes: () => {},
  setTextQuery: () => {},
  setRadiusM: () => {},
});

export function AmenityProvider({ children }: { children: ReactNode }) {
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(() => {
    const saved = loadSettingsFromStorage().stopTypes;
    return saved && saved.length > 0 ? new Set(saved) : new Set(AMENITY_LIST);
  });
  const [textQuery, setTextQuery] = useState("");
  const [radiusM, setRadiusM] = useState(
    () => loadSettingsFromStorage().stopRadiusM ?? 1609.34,
  );

  return (
    <AmenityContext.Provider
      value={{
        selectedTypes,
        textQuery,
        radiusM,
        setSelectedTypes,
        setTextQuery,
        setRadiusM,
      }}
    >
      {children}
    </AmenityContext.Provider>
  );
}
