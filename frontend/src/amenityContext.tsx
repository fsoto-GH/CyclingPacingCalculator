import { createContext } from "react";
import { AMENITY_LIST } from "./calculator/nearbyStops";

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
