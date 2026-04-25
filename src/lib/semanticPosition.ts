import { TrendCard } from './wixApi';
import { RelatedCard } from './similarity';

// ── Vocabulary for abstract ↔ pragmatic axis ──────────────────────────────

const ABSTRACT_WORDS = [
  'paradigm', 'philosophy', 'concept', 'theory', 'consciousness', 'identity',
  'values', 'ethics', 'meaning', 'culture', 'society', 'civilization',
  'worldview', 'ideology', 'principle', 'framework', 'systemic', 'emergent',
  'transformation', 'shift', 'evolution', 'narrative', 'discourse',
  'governance', 'democracy', 'freedom', 'rights', 'power', 'inequality',
  'justice', 'trust', 'belief', 'perception', 'imagination', 'creativity',
  'awareness', 'mindset', 'social', 'political', 'cultural', 'philosophical',
  'psychological', 'behavioral', 'cognitive', 'moral', 'existential',
  'structural', 'collective', 'symbolic', 'abstract', 'vision',
  'inequality', 'agency', 'sovereignty', 'resilience', 'legitimacy',
];

const PRAGMATIC_WORDS = [
  'product', 'tool', 'platform', 'service', 'app', 'device', 'implementation',
  'deployment', 'adoption', 'market', 'business', 'company', 'startup',
  'revenue', 'cost', 'efficiency', 'automation', 'process', 'infrastructure',
  'regulation', 'standard', 'protocol', 'software', 'hardware', 'data',
  'algorithm', 'robot', 'sensor', 'network', 'factory', 'supply', 'logistics',
  'manufacturing', 'production', 'energy', 'battery', 'electric', 'solar',
  'medical', 'treatment', 'drug', 'vaccine', 'therapy', 'clinical',
  'engineering', 'technical', 'operational', 'practical', 'applied',
  'transaction', 'payment', 'finance', 'insurance', 'healthcare', 'policy',
  'built', 'installed', 'measured', 'tested', 'shipped', 'scaled',
];

// ── Vocabulary for near-term (now) ↔ far-term (2030) axis ────────────────

const FUTURE_WORDS = [
  '2030', '2029', '2028', '2027', '2026', 'future', 'coming', 'eventually',
  'horizon', 'prediction', 'scenario', 'anticipated', 'long-term', 'forecast',
  'prospect', 'nascent', 'speculative', 'experimental', 'breakthrough',
  'revolution', 'disruption', 'projected', 'trajectory', 'envisioned',
  'next decade', 'emerging', 'transformative', 'moonshot', 'reimagine',
  'by 2030', 'will be', 'could become', 'may lead', 'next generation',
];

const PRESENT_WORDS = [
  'today', 'current', 'already', 'existing', 'now', 'recent', '2024', '2025',
  'early', 'initial', 'pilot', 'mainstream', 'widespread', 'adopted',
  'deployed', 'available', 'accessible', 'proven', 'established',
  'growing', 'expanding', 'scaling', 'rollout', 'launched', 'released',
  'implemented', 'operational', 'commercial', 'ongoing', 'happening',
  'increasingly', 'rapidly', 'actively', 'currently', 'real-time',
];

// ── Scoring ───────────────────────────────────────────────────────────────

function scoreCard(card: TrendCard): { abstractness: number; futureOrientation: number } {
  const text = [
    card.title,
    card.subtitle, card.subtitle,          // subtitle weighted more
    card.excerpt,
    card.keywords.join(' '),
  ].join(' ').toLowerCase();

  let abstractCount = 0;
  let pragmaticCount = 0;
  let futureCount = 0;
  let presentCount = 0;

  for (const w of ABSTRACT_WORDS)  if (text.includes(w)) abstractCount++;
  for (const w of PRAGMATIC_WORDS) if (text.includes(w)) pragmaticCount++;
  for (const w of FUTURE_WORDS)    if (text.includes(w)) futureCount++;
  for (const w of PRESENT_WORDS)   if (text.includes(w)) presentCount++;

  const totalAP = abstractCount + pragmaticCount;
  // 0 = pragmatic, 1 = abstract; default 0.5 when unclear
  const abstractness = totalAP > 0 ? abstractCount / totalAP : 0.5;

  const totalFP = futureCount + presentCount;
  // 0 = now/near-term, 1 = future/2030; default 0.5 when unclear
  const futureOrientation = totalFP > 0 ? futureCount / totalFP : 0.5;

  return { abstractness, futureOrientation };
}

// ── Slot definitions (hexagonal compass) ─────────────────────────────────
//
//          [0] ABSTRACT
//  [5] NOW + abstract     [1] FUTURE + abstract
//  [4] NOW + pragmatic    [2] FUTURE + pragmatic
//          [3] PRAGMATIC
//
// Target: [abstractness (0–1), futureOrientation (0–1)]

const SLOT_TARGETS: [number, number][] = [
  [1.0, 0.5],   // 0: top          — purely abstract
  [0.7, 1.0],   // 1: top-right    — abstract + 2030
  [0.3, 1.0],   // 2: bottom-right — pragmatic + 2030
  [0.0, 0.5],   // 3: bottom       — purely pragmatic
  [0.3, 0.0],   // 4: bottom-left  — pragmatic + now
  [0.7, 0.0],   // 5: top-left     — abstract + now
];

export interface PositionedCard {
  card: TrendCard;
  score: number;       // similarity score
  slotIndex: number;   // 0–5 hexagon slot
}

export function assignPositions(related: RelatedCard[]): PositionedCard[] {
  if (related.length === 0) return [];

  // Score all candidates on semantic axes
  const candidates = related.map(item => ({
    card: item.card,
    score: item.score,
    ...scoreCard(item.card),
  }));

  const result: PositionedCard[] = [];
  const usedIndices = new Set<number>();

  // Assign cardinal slots first (top, bottom, top-left, top-right, bottom-left, bottom-right)
  const slotOrder = [0, 3, 5, 1, 4, 2];

  for (const slotIdx of slotOrder) {
    if (usedIndices.size >= candidates.length) break;
    const [targetA, targetF] = SLOT_TARGETS[slotIdx];

    let bestIdx = -1;
    let bestDist = Infinity;

    for (let i = 0; i < candidates.length; i++) {
      if (usedIndices.has(i)) continue;
      const da = candidates[i].abstractness - targetA;
      const df = candidates[i].futureOrientation - targetF;
      const dist = Math.sqrt(da * da + df * df);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      usedIndices.add(bestIdx);
      result.push({ card: candidates[bestIdx].card, score: candidates[bestIdx].score, slotIndex: slotIdx });
    }
  }

  return result;
}
