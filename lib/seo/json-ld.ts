/**
 * Serializes structured data for a `<script type="application/ld+json">` tag.
 *
 * JSON.stringify leaves `<` alone, so vendor-written text such as
 * `</script><script>…` would close the tag and run as script (stored XSS).
 * Escaping `<`, `>` and `&` as \u-sequences keeps the JSON identical to
 * parsers while making it impossible to break out of the tag. U+2028/U+2029
 * are escaped too: they are valid in JSON but line terminators in older JS.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
