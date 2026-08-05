/**
 * Tokenizes mixed Markdown text for lexical search.
 *
 * The token contract intentionally matches Search v3: ASCII words are
 * lower-cased, CJK runs produce overlapping bigrams, and hashtags retain both
 * their hashed and hierarchy-aware plain forms.
 *
 * @param value - Text to tokenize
 * @returns De-duplicated tokens in deterministic discovery order
 */
export function tokenizeMixed(value: string): string[] {
  if (!value) {
    return [];
  }

  const tokens = new Set<string>();
  const lowered = value.toLowerCase();
  let asciiSource = lowered;

  // Preserve tags as first-class tokens while also making their hierarchy searchable.
  let tagMatches: RegExpMatchArray | null = null;
  try {
    tagMatches = lowered.match(/#[\p{L}\p{N}_/-]+/gu);
  } catch {
    tagMatches = lowered.match(/#[a-z0-9_/-]+/g);
  }

  if (tagMatches) {
    for (const tag of tagMatches) {
      tokens.add(tag);

      const tagBody = tag.slice(1);
      if (!tagBody) {
        continue;
      }

      tokens.add(tagBody);

      const segments = tagBody.split("/").filter((segment) => segment.length > 0);
      if (segments.length > 0) {
        let prefix = "";
        for (const segment of segments) {
          prefix = prefix ? `${prefix}/${segment}` : segment;
          tokens.add(prefix);
          tokens.add(`#${prefix}`);
          tokens.add(segment);
        }
      }
      const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      asciiSource = asciiSource.replace(new RegExp(escapedTag, "gu"), " ");
    }
  }

  const asciiWords = asciiSource.match(/[a-z0-9_]+/g) || [];
  asciiWords.forEach((word) => tokens.add(word));

  const cjkPattern = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]+/g;
  const cjkMatches = value.match(cjkPattern) || [];

  for (const match of cjkMatches) {
    if (match.length === 1) {
      tokens.add(match);
    }
    for (let index = 0; index < match.length - 1; index++) {
      tokens.add(match.slice(index, index + 2));
    }
  }

  return Array.from(tokens);
}
