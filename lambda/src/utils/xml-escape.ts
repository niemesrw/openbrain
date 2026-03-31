/**
 * Escapes characters that have special meaning in XML/HTML so that
 * user-controlled text cannot break out of an XML delimiter wrapper.
 * Handles the five predefined XML entities: & < > " '
 */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
