/**
 * Compile-time feature flags read from Vite's env substitution.
 * These are baked into the bundle at build time — changing them requires a rebuild.
 */

/**
 * When true, the paid-API toggle and Google sign-in button are rendered.
 * Set VITE_ENABLE_PAID_APIS=true in your .env (or as a docker build-arg) to enable.
 */
export const PAID_APIS_ENABLED =
  import.meta.env.VITE_ENABLE_PAID_APIS === "true";
