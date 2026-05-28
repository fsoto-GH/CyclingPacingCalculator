/**
 * Compile-time feature flags read from Vite's env substitution.
 * These are baked into the bundle at build time — changing them requires a rebuild.
 */

/**
 * When true, server-dependent features are rendered: Google sign-in, Search
 * RideWithGPS, and My Race Plans. When false the app runs fully serverless and
 * none of those features are shown (except public plan GET, which bypasses this
 * flag on the API side).
 * Set VITE_ENABLE_SERVER_FUNCTIONS=true in your .env (or as a docker build-arg)
 * to enable.
 */
export const SERVER_FUNCTIONS_ENABLED =
  import.meta.env.VITE_ENABLE_SERVER_FUNCTIONS === "true";
