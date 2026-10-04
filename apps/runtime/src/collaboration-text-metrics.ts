/** Unicode code points, not UTF-16 offsets or estimated Chinese word counts. */
export function measureCollaborationText(text: string) {
  return { characters: Array.from(text).length, charactersWithoutWhitespace: Array.from(text.replace(/\s/gu, '')).length,
    scope: 'entire_text' as const, punctuationIncluded: true as const };
}
