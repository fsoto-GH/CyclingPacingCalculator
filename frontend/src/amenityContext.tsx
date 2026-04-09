import { createContext, useState } from "react";
import type { ReactNode } from "react";
import { AMENITY_LIST } from "./calculator/overpass";

interface AmenityContextValue {
  selectedTypes: Set<string>;
  customTypes: string;
  setSelectedTypes: (v: Set<string>) => void;
  setCustomTypes: (v: string) => void;
}

export const AmenityContext = createContext<AmenityContextValue>({
  selectedTypes: new Set(AMENITY_LIST),
  customTypes: "",
  setSelectedTypes: () => {},
  setCustomTypes: () => {},
});

export function AmenityProvider({ children }: { children: ReactNode }) {
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(
    () => new Set(AMENITY_LIST),
  );
  const [customTypes, setCustomTypes] = useState("");

  return (
    <AmenityContext.Provider
      value={{ selectedTypes, customTypes, setSelectedTypes, setCustomTypes }}
    >
      {children}
    </AmenityContext.Provider>
  );
}
