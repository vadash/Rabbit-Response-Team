// Unified tokenizer. Splits text into lowercase word tokens of Latin or
// Cyrillic script. Non-string input returns [].

export function extractTokens(text) {
  if (typeof text !== "string") return [];
  const matches = text.toLowerCase().match(/[a-zà-ɏ]+|[а-яё]+/gi);
  return matches ?? [];
}
