import { TrendCard } from './wixApi';

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
  'from','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','shall',
  'not','no','nor','so','yet','both','either','neither','this','that','these',
  'those','it','its','they','them','their','there','here','when','where',
  'which','who','whom','whose','what','how','why','can','as','if','then',
  'than','such','more','most','also','just','very','much','many','some',
  'all','each','every','any','about','into','through','during','before',
  'after','above','below','between','among','within','without','along',
  'following','across','behind','beyond','plus','except','up','out','around',
  'however','therefore','thus','hence','indeed','already','still','always',
  'often','never','sometimes','usually','while','because','since','although',
  'despite','instead','rather','whether','toward','towards','new','one','two',
  'use','used','using','make','made','become','become','need','needs','needed',
  'create','creating','include','including','help','helping','allow','allowing',
  'provide','providing','offer','offering','lead','leading','drive','driving',
  'grow','growing','take','taking','give','giving','come','coming','go','going',
  'see','seeing','say','says','said','way','ways','part','parts','well','even',
  'like','now','get','getting','set','setting','put','putting','work','works',
  'working','play','playing','run','running','move','moving','turn','turning',
  'people','world','global','society','human','social','economic','political',
]);

// Lightweight suffix stemmer: reduces inflected forms to a common root
function stem(word: string): string {
  if (word.length < 5) return word;
  if (word.endsWith('ization') || word.endsWith('isation')) return word.slice(0, -7);
  if (word.endsWith('ness')) return word.slice(0, -4);
  if (word.endsWith('tion')) return word.slice(0, -4);
  if (word.endsWith('sion')) return word.slice(0, -4);
  if (word.endsWith('ment')) return word.slice(0, -4);
  if (word.endsWith('ity') && word.length > 6) return word.slice(0, -3);
  if (word.endsWith('ing') && word.length > 6) return word.slice(0, -3);
  if (word.endsWith('ive') && word.length > 5) return word.slice(0, -3);
  if (word.endsWith('ful') && word.length > 5) return word.slice(0, -3);
  if (word.endsWith('ous') && word.length > 5) return word.slice(0, -3);
  if (word.endsWith('al') && word.length > 5) return word.slice(0, -2);
  if (word.endsWith('ed') && word.length > 5) return word.slice(0, -2);
  if (word.endsWith('er') && word.length > 5) return word.slice(0, -2);
  if (word.endsWith('ly') && word.length > 5) return word.slice(0, -2);
  if (word.endsWith('es') && word.length > 5) return word.slice(0, -2);
  if (word.endsWith('s') && word.length > 5 && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    .map(stem)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

// Weight fields thematically: description matters most, then keywords, title last
function cardToTokens(card: TrendCard): string[] {
  const parts: string[] = [];
  // Repeat fields to weight them in TF calculation
  for (let i = 0; i < 3; i++) parts.push(card.excerpt);
  for (let i = 0; i < 2; i++) parts.push(card.subtitle, card.keywords.join(' '));
  parts.push(card.title);
  return tokenize(parts.join(' '));
}

type SparseVector = Record<string, number>;

export interface SimilarityIndex {
  vectors: Record<string, SparseVector>;
  idf: Record<string, number>;
  cardIds: string[];
}

export function buildIndex(cards: TrendCard[]): SimilarityIndex {
  const n = cards.length;
  const docFreq: Record<string, number> = {};
  const rawCounts: Record<string, Record<string, number>> = {};

  // Build term-frequency counts and document-frequency counts
  for (const card of cards) {
    const tokens = cardToTokens(card);
    const counts: Record<string, number> = {};
    for (const t of tokens) counts[t] = (counts[t] || 0) + 1;
    rawCounts[card.id] = counts;
    for (const t of Object.keys(counts)) {
      docFreq[t] = (docFreq[t] || 0) + 1;
    }
  }

  // IDF: smoothed log — rare terms get higher weight
  const idf: Record<string, number> = {};
  for (const [term, df] of Object.entries(docFreq)) {
    idf[term] = Math.log((n + 1) / (df + 1)) + 1;
  }

  // Build L2-normalised TF-IDF vectors
  const vectors: Record<string, SparseVector> = {};
  for (const card of cards) {
    const raw = rawCounts[card.id] || {};
    const total = Object.values(raw).reduce((s, c) => s + c, 0);
    const vec: SparseVector = {};
    let normSq = 0;
    for (const [term, count] of Object.entries(raw)) {
      const v = (count / total) * (idf[term] || 0);
      vec[term] = v;
      normSq += v * v;
    }
    const norm = Math.sqrt(normSq);
    if (norm > 0) {
      for (const term of Object.keys(vec)) vec[term] /= norm;
    }
    vectors[card.id] = vec;
  }

  return { vectors, idf, cardIds: cards.map(c => c.id) };
}

// Cosine similarity between two pre-normalised sparse vectors
function cosine(a: SparseVector, b: SparseVector): number {
  // Iterate over the smaller vector for speed
  const [small, large] = Object.keys(a).length <= Object.keys(b).length ? [a, b] : [b, a];
  let dot = 0;
  for (const term of Object.keys(small)) {
    if (large[term] !== undefined) dot += small[term] * large[term];
  }
  return dot; // vectors are already unit-length
}

export interface RelatedCard {
  card: TrendCard;
  score: number;
}

export function findRelated(
  sourceId: string,
  allCards: TrendCard[],
  index: SimilarityIndex,
  topN = 6,
): RelatedCard[] {
  const sourceVec = index.vectors[sourceId];
  if (!sourceVec) return [];

  const scores: RelatedCard[] = [];
  for (const card of allCards) {
    if (card.id === sourceId) continue;
    const vec = index.vectors[card.id];
    if (!vec) continue;
    const score = cosine(sourceVec, vec);
    if (score > 0.005) scores.push({ card, score });
  }

  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, topN);
}
