import { useState, useEffect } from 'react';
import { fetchTrendPosts, TrendCard } from '../lib/wixApi';
import { buildIndex, SimilarityIndex } from '../lib/similarity';

// Module-level cache: only load + index all 600 cards once per app session
const CACHE: { cards: TrendCard[]; index: SimilarityIndex | null } = {
  cards: [],
  index: null,
};

export function useAllCards() {
  const [allCards, setAllCards] = useState<TrendCard[]>(CACHE.cards);
  const [similarityIndex, setSimilarityIndex] = useState<SimilarityIndex | null>(CACHE.index);
  const [indexReady, setIndexReady] = useState(CACHE.index !== null);

  useEffect(() => {
    if (CACHE.index !== null) return; // already loaded and indexed

    let cancelled = false;

    async function loadAll() {
      const all: TrendCard[] = [];
      let cursor: string | undefined;

      try {
        do {
          const result = await fetchTrendPosts(cursor, undefined, 100);
          if (cancelled) return;
          all.push(...result.cards);
          cursor = result.nextCursor;
        } while (cursor);

        if (cancelled) return;

        // Build TF-IDF index on background thread (synchronous but fast for 600 cards)
        const idx = buildIndex(all);
        CACHE.cards = all;
        CACHE.index = idx;

        setAllCards(all);
        setSimilarityIndex(idx);
        setIndexReady(true);
      } catch (e) {
        // Non-fatal: related trends just won't show
        console.warn('[useAllCards] Background load failed:', e);
      }
    }

    loadAll();
    return () => { cancelled = true; };
  }, []);

  return { allCards, similarityIndex, indexReady };
}
