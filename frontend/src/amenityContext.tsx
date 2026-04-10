import { createContext, useState } from "react";
import type { ReactNode } from "react";
import { AMENITY_LIST } from "./calculator/overpass";

interface AmenityContextValue {
  selectedTypes: Set<string>;
  customTypes: string;
  radiusM: number;
  setSelectedTypes: (v: Set<string>) => void;
  setCustomTypes: (v: string) => void;
  setRadiusM: (v: number) => void;
}

export const AmenityContext = createContext<AmenityContextValue>({
  selectedTypes: new Set(AMENITY_LIST),
  customTypes: "",
  radiusM: 1609.34,
  setSelectedTypes: () => {},
  setCustomTypes: () => {},
  setRadiusM: () => {},
});

export function AmenityProvider({ children }: { children: ReactNode }) {
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(
    () => new Set(AMENITY_LIST),
  );
  const [customTypes, setCustomTypes] = useState("");
  const [radiusM, setRadiusM] = useState(1609.34);

  return (
    <AmenityContext.Provider
      value={{
        selectedTypes,
        customTypes,
        radiusM,
        setSelectedTypes,
        setCustomTypes,
        setRadiusM,
      }}
    >
      {children}
    </AmenityContext.Provider>
  );
}
