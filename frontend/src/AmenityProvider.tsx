import { useState } from "react";
import type { ReactNode } from "react";
import { AMENITY_LIST } from "./calculator/nearbyStops";
import { AmenityContext } from "./amenityContext";
import { loadSettingsFromStorage } from "./userSettings";

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
