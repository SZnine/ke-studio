declare const __KE_BUILD__: string;
export const buildId =
  typeof __KE_BUILD__ === "undefined" ? "development" : __KE_BUILD__;
/** All parts of a page load use the same release, including workers and language runtime. */
export function assetUrl(name: string) {
  const url = new URL(name, import.meta.url);
  url.searchParams.set("v", buildId);
  return url;
}
