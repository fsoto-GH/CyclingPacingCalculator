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

interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleAccountsIdConfig {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  nonce?: string;
  use_fedcm_for_prompt?: boolean;
  itp_support?: boolean;
}

interface GoogleSignInButtonConfig {
  type?: "standard" | "icon";
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "large" | "medium" | "small";
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  shape?: "rectangular" | "pill" | "circle" | "square";
  logo_alignment?: "left" | "center";
}

interface Window {
  google?: {
    accounts?: {
      id: {
        initialize: (config: GoogleAccountsIdConfig) => void;
        renderButton: (
          parent: HTMLElement,
          options: GoogleSignInButtonConfig,
        ) => void;
        prompt: () => void;
        cancel: () => void;
      };
    };
  };
}
