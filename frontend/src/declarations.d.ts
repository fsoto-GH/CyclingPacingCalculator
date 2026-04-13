declare module "tz-lookup" {
  function tzlookup(lat: number, lon: number): string;
  export = tzlookup;
}

// opening_hours is a complex CommonJS module; we only use the constructor + .getUnknown()
declare module "opening_hours" {
  interface OhOptions {
    address?: object;
    locale?: string;
  }
  class OpeningHours {
    constructor(
      value: string,
      nominatimObject?: object | null,
      options?: OhOptions,
    );
    getUnknown(): boolean;
    // Returns array of [from: Date, to: Date, open: boolean, comment: string]
    getIterator(from?: Date): {
      getDate(): Date;
      getState(): boolean;
      advance(to?: Date): boolean;
    };
  }
  export = OpeningHours;
}
