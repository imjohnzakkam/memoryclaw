const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "must",
  "i", "me", "my", "we", "our", "you", "your", "he", "him", "his",
  "she", "her", "it", "its", "they", "them", "their",
  "what", "which", "who", "whom", "this", "that", "these", "those",
  "am", "at", "by", "for", "from", "in", "into", "of", "on", "to",
  "with", "and", "but", "or", "nor", "not", "so", "if", "then",
  "about", "up", "out", "just", "also", "very", "how", "all", "any",
  "both", "each", "more", "most", "other", "some", "such", "no",
  "than", "too", "only", "own", "same", "as", "when", "where", "why",
]);

export function extractKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}
