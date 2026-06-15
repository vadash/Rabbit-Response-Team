// Language detection and stopword sets.
// Per design §6 (detection) and §5.3 (stopwords live here, the only consumer
// being the synonym scanner).

const CYRILLIC_RE = /[Ѐ-ӿ]/g;
const LATIN_RE = /[a-zÀ-ɏ]/gi;

/**
 * Detect the dominant script of `text`.
 * Counts Cyrillic and Latin characters; returns 'ru' or 'en' based on which
 * count is higher. Empty input (or input with no script characters) → null.
 *
 * Counting — not `.test()` — so a single stray word in a foreign script does
 * not flip the verdict on mixed-script messages like
 * "ugh, same here — да блин опять". Ties fall back to English (the original
 * extension's implicit default).
 */
export function detectLanguage(text) {
  if (typeof text !== "string" || text.length === 0) return null;

  const cyrillic = (text.match(CYRILLIC_RE) || []).length;
  const latin = (text.match(LATIN_RE) || []).length;

  if (cyrillic === 0 && latin === 0) return null;
  return cyrillic > latin ? "ru" : "en";
}

/**
 * Resolve the active language for a chat turn.
 * - 'en' / 'ru' → forced, message ignored.
 * - 'auto'     → detect via `detectLanguage`, defaulting to 'en' when the
 *                message is empty or script-less.
 */
export function resolveLanguage(setting, userMessage) {
  if (setting === "auto") {
    return detectLanguage(userMessage) ?? "en";
  }
  return setting;
}

// English stopwords — articles, conjunctions, prepositions, auxiliaries,
// pronouns, common adverbs. Lowercase only. No duplicates.
export const STOPWORDS_EN = new Set([
  // Articles, conjunctions, prepositions
  "the", "a", "an", "and", "or", "but", "nor", "for", "yet", "so",
  "in", "on", "at", "to", "of", "with", "by", "from", "as", "into",
  "onto", "upon", "about", "above", "below", "under", "over", "between",
  "through", "during", "before", "after", "since", "until", "while",
  // Auxiliaries / common verbs
  "is", "am", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "doing", "done",
  "will", "would", "should", "could", "can", "may", "might", "must", "shall",
  "make", "makes", "made", "making",
  // Pronouns
  "i", "me", "my", "mine", "myself",
  "you", "your", "yours", "yourself", "yourselves",
  "he", "him", "his", "himself",
  "she", "her", "hers", "herself",
  "it", "its", "itself",
  "we", "us", "our", "ours", "ourselves",
  "they", "them", "their", "theirs", "themselves",
  "this", "that", "these", "those",
  "what", "which", "who", "whom", "whose", "when", "where", "why", "how",
  // Common adjectives / adverbs / quantifiers
  "very", "really", "quite", "just", "only", "even", "also",
  "still", "already", "always", "never", "often", "sometimes", "usually",
  "however", "therefore", "thus", "hence", "moreover", "furthermore",
  "there", "here", "then", "than", "such",
  "some", "any", "each", "every", "both", "either", "neither",
  "much", "many", "more", "most", "less", "least", "few", "several",
  "enough", "same", "other", "another",
]);

// Russian stopwords — particles, prepositions, pronouns, common adverbs.
// Lowercase only. No duplicates (regression guard: 'мне' must appear once).
export const STOPWORDS_RU = new Set([
  // Particles / conjunctions
  "и", "а", "но", "или", "ни", "же", "ли", "бы", "б",
  "да", "нет", "не", "уж", "ведь", "вот", "только",
  // Prepositions
  "в", "во", "на", "по", "к", "ко", "с", "со", "у", "от", "до",
  "из", "за", "над", "под", "при", "про", "о", "об", "обо",
  "для", "ради", "без", "безо", "через", "сквозь", "между", "перед",
  // Pronouns
  "я", "мы", "ты", "вы", "он", "она", "оно", "они",
  "меня", "тебя", "его", "её", "ее", "нас", "вас", "их",
  "мне", "тебе", "ему", "ей", "нам", "вам", "им",
  "мной", "тобой", "им", "ей", "нами", "вами", "ими",
  "мой", "моя", "моё", "мое", "мои", "твой", "твоя", "твоё", "твое", "твои",
  "наш", "наша", "наше", "наши", "ваш", "ваша", "ваше", "ваши",
  "свой", "свою", "своего", "своей", "свои", "своими",
  "этот", "эта", "это", "эти", "тот", "та", "те",
  "такой", "такая", "такое", "такие", "каков", "какова",
  "кто", "что", "какой", "который", "чей", "сколько",
  "себя", "себе", "собой", "собою",
  // Auxiliaries / common verbs
  "быть", "есть", "был", "была", "было", "были", "буду", "будет",
  // Common adverbs
  "уже", "ещё", "еще", "там", "тут", "здесь", "где", "куда", "откуда",
  "когда", "почему", "зачем", "как", "так", "очень", "много", "мало",
  "хорошо", "плохо", "тоже", "также", "поэтому", "значит",
]);
