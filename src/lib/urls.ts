/** The site's root URL, e.g. https://user.github.io/lawx_clubs/ — used for auth email redirects. */
export function siteRootUrl(): string {
  return window.location.origin + import.meta.env.BASE_URL
}
