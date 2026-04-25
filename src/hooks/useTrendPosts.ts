import { useState, useEffect, useCallback } from 'react';
import { fetchTrendPosts, fetchCategories, TrendCard, TrendCategory, ARCHIVE_CATEGORY_ID } from '../lib/wixApi';
import { getLikedIds, getLikedOrder, toggleLike } from '../lib/likeStorage';
import { AppLanguage } from '../lib/languageStorage';
import { fetchNlTranslations, NlTranslations } from '../lib/translationsApi';

export function useTrendPosts(language: AppLanguage = 'en') {
  const [cards, setCards] = useState<TrendCard[]>([]);
  const [categories, setCategories] = useState<TrendCategory[]>([]);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [likedOrder, setLikedOrder] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [total, setTotal] = useState(0);
  const [nlTranslations, setNlTranslations] = useState<NlTranslations | null>(null);

  const [filterCategoryIds, setFilterCategoryIds] = useState<string[]>([]);
  const [retryTrigger, setRetryTrigger] = useState(0);

  // One-time: load liked IDs + order, and categories
  useEffect(() => {
    getLikedIds().then(setLikedIds);
    getLikedOrder().then(setLikedOrder);
    fetchCategories().then((cats) => {
      // Append the synthetic Archive category at the end of the real categories.
      // Its sentinel ID is intercepted server-side so only archived cards are returned.
      setCategories([
        ...cats,
        { id: ARCHIVE_CATEGORY_ID, label: 'Archive', postCount: 0 },
      ]);
    }).catch(() => {});
  }, []);

  // Fetch NL translations once when language switches to 'nl'
  useEffect(() => {
    if (language === 'nl' && nlTranslations === null) {
      fetchNlTranslations().then(setNlTranslations);
    }
  }, [language]);

  // Re-fetch posts whenever the filter or retry changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        setCards([]);
        setNextCursor(undefined);
        const result = await fetchTrendPosts(
          undefined,
          filterCategoryIds.length > 0 ? filterCategoryIds : undefined
        );
        if (cancelled) return;
        setCards(result.cards);
        setNextCursor(result.nextCursor);
        setTotal(result.total);
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filterCategoryIds, retryTrigger]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    try {
      setLoadingMore(true);
      const result = await fetchTrendPosts(
        nextCursor,
        filterCategoryIds.length > 0 ? filterCategoryIds : undefined
      );
      setCards((prev) => [...prev, ...result.cards]);
      setNextCursor(result.nextCursor);
    } catch (e: any) {
      console.warn('Failed to load more:', e.message);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, filterCategoryIds]);

  const handleToggleLike = useCallback(async (postId: string) => {
    const nowLiked = await toggleLike(postId);
    setLikedIds((prev) => {
      const next = new Set(prev);
      if (nowLiked) next.add(postId);
      else next.delete(postId);
      return next;
    });
    setLikedOrder((prev) => {
      if (nowLiked) return [postId, ...prev.filter((id) => id !== postId)];
      return prev.filter((id) => id !== postId);
    });
  }, []);

  const toggleFilterCategory = useCallback((id: string) => {
    setFilterCategoryIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      return [...prev, id];
    });
  }, []);

  const clearFilterCategories = useCallback(() => {
    setFilterCategoryIds([]);
  }, []);

  const retry = useCallback(() => {
    setError(null);
    setRetryTrigger((t) => t + 1);
  }, []);

  const injectCard = useCallback((card: TrendCard) => {
    setCards((prev) => {
      if (prev.some((c) => c.id === card.id)) return prev;
      return [card, ...prev];
    });
  }, []);

  // Merge NL translations into cards when language is 'nl'
  const displayCards = (language === 'nl' && nlTranslations)
    ? cards.map((card) => {
        const tr = nlTranslations.cards[card.id];
        if (!tr) return card;
        return {
          ...card,
          subtitle: tr.subtitle || card.subtitle,
          excerpt: tr.excerpt || card.excerpt,
          keywords: tr.keywords?.length ? tr.keywords : card.keywords,
        };
      })
    : cards;

  return {
    cards: displayCards,
    categories,
    likedIds,
    likedOrder,
    loading,
    loadingMore,
    error,
    total,
    hasMore: !!nextCursor,
    filterCategoryIds,
    toggleFilterCategory,
    clearFilterCategories,
    loadMore,
    toggleLike: handleToggleLike,
    retry,
    injectCard,
  };
}
