/* Isomorphic. */

export const SITE_ASSETS_BUCKET = "site-assets";
/** Stays under the default 1 MB server action body limit. */
export const OG_IMAGE_MAX_BYTES = 900_000;

export function ogImagePath(ext: "jpg" | "png", now = Date.now()): string {
  return `og/${now}.${ext}`;
}
