// The CVOA launcher and all embedded pages must never restore staff credentials.
export function resolvePublicBookingMode(browser) {
  if (!browser) return false;
  const embedded = browser.parent !== browser;
  const requested = new URLSearchParams(browser.location.search).get("cvoa_public") === "1";
  try {
    const active = embedded || requested || browser.sessionStorage.getItem("schedlr-public-booking") === "1";
    if (active) browser.sessionStorage.setItem("schedlr-public-booking", "1");
    return active;
  } catch {
    // A browser that cannot retain the mode must fail closed across navigation.
    return true;
  }
}
export const publicBookingMode = resolvePublicBookingMode(typeof window === "undefined" ? null : window);
export const publicAuthOptions = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
  storageKey: "schedlr-public-anonymous",
};
