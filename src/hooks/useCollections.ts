import { useState, useEffect, useCallback } from 'react';
import { Collection, getCollections, saveCollections } from '../lib/collectionsStorage';

export function useCollections() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getCollections().then((c) => { setCollections(c); setLoaded(true); });
  }, []);

  // Persist to AsyncStorage whenever collections change (after initial load)
  useEffect(() => {
    if (loaded) saveCollections(collections);
  }, [collections, loaded]);

  // All mutators use functional updates so they never close over stale state
  const createCollection = useCallback((name: string): string => {
    const id = Date.now().toString();
    const trimmed = name.trim();
    if (!trimmed) return '';
    setCollections((prev) => [...prev, { id, name: trimmed, cardIds: [] }]);
    return id;
  }, []);

  const deleteCollection = useCallback((id: string) => {
    setCollections((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const toggleCard = useCallback((collectionId: string, cardId: string) => {
    setCollections((prev) => prev.map((c) => {
      if (c.id !== collectionId) return c;
      return c.cardIds.includes(cardId)
        ? { ...c, cardIds: c.cardIds.filter((id) => id !== cardId) }
        : { ...c, cardIds: [...c.cardIds, cardId] };
    }));
  }, []);

  const removeCardFromAll = useCallback((cardId: string) => {
    setCollections((prev) => prev.map((c) => ({
      ...c,
      cardIds: c.cardIds.filter((id) => id !== cardId),
    })));
  }, []);

  const importCollection = useCallback((name: string, cardIds: string[]): string => {
    const id = Date.now().toString();
    const trimmed = name.trim();
    if (!trimmed) return '';
    setCollections((prev) => [...prev, { id, name: trimmed, cardIds }]);
    return id;
  }, []);

  const renameCollection = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCollections((prev) => prev.map((c) => c.id === id ? { ...c, name: trimmed } : c));
  }, []);

  return { collections, createCollection, deleteCollection, toggleCard, removeCardFromAll, importCollection, renameCollection };
}
