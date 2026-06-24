/**
 * Color helpers shared across annotation rendering.
 */

// Matches #RGB, #RGBA, #RRGGBB, and #RRGGBBAA hex colors only.
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

/**
 * Validate a color before it is interpolated into HTML or a CSS string.
 *
 * Annotation colors come from the server and are otherwise untrusted; a value
 * like `red"><img src=x onerror=...>` would break out of an attribute or CSS
 * declaration. We only allow hex colors and fall back to a known-safe default
 * for anything else. Use this at every sink where a color is concatenated into
 * markup or `cssText` (DOM/CSSOM setters such as `setAttribute("fill", c)` and
 * `style.color = c` are already injection-safe and don't need it).
 *
 * @param {string} color - Candidate color (typically annotation.color)
 * @param {string} fallback - Color to use when `color` is missing/invalid
 * @returns {string}
 */
export function sanitizeColor(color, fallback) {
  if (typeof color === "string" && HEX_COLOR_RE.test(color)) {
    return color
  }
  return fallback
}
