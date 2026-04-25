import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { useTrendPosts } from './src/hooks/useTrendPosts';
import { LanguageProvider, useLanguage } from './src/contexts/LanguageContext';
import { t, tCategory } from './src/lib/i18n';
import { useAllCards } from './src/hooks/useAllCards';
import { useShake } from './src/hooks/useShake';
import CardScreen from './src/screens/CardScreen';
import ListScreen from './src/screens/ListScreen';
import LikedScreen from './src/screens/LikedScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import RelatedTrendsMap from './src/components/RelatedTrendsMap';
import { getReadIds, saveReadIds } from './src/lib/readStorage';
import { useCollections } from './src/hooks/useCollections';
import { getLastCardId, saveLastCardId } from './src/lib/lastCardStorage';
import { trackEvent } from './src/lib/analytics';
import { TrendCard } from './src/lib/wixApi';

type ActiveScreen = 'card' | 'list' | 'liked' | 'profile';

// Monochrome person-in-circle icon — same colour scheme as the bottom nav icons.
// Drawn with View primitives so it scales and tints identically to the Unicode
// symbols used in the nav bar (no emoji colour rendering, no extra library needed).
function ProfileIcon({ color, size }: { color: string; size: number }) {
  const border = Math.max(2, Math.round(size * 0.085));
  const inner = size - border * 2;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Outer ring */}
      <View style={{
        position: 'absolute',
        width: size, height: size,
        borderRadius: size / 2,
        borderWidth: border,
        borderColor: color,
      }} />
      {/* Inner circle — clips head + shoulders to circle shape */}
      <View style={{
        width: inner, height: inner,
        borderRadius: inner / 2,
        overflow: 'hidden',
        alignItems: 'center',
      }}>
        {/* Head */}
        <View style={{
          width: inner * 0.36, height: inner * 0.36,
          borderRadius: inner * 0.18,
          backgroundColor: color,
          marginTop: inner * 0.18,
        }} />
        {/* Shoulders */}
        <View style={{
          width: inner * 0.72, height: inner * 0.55,
          borderTopLeftRadius: inner * 0.36,
          borderTopRightRadius: inner * 0.36,
          backgroundColor: color,
          marginTop: inner * 0.09,
        }} />
      </View>
    </View>
  );
}

// Funnel / filter icon drawn with View primitives. Turns red when active.
function FilterIcon({ active = false, size = 22 }: { active?: boolean; size?: number }) {
  const color = active ? '#FE0437' : '#888';
  const w = size;
  const topH = Math.round(size * 0.28);
  const midH = Math.round(size * 0.28);
  const botH = Math.round(size * 0.2);
  return (
    <View style={{ width: w, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Top wide bar */}
      <View style={{ width: w, height: Math.round(size * 0.12), backgroundColor: color, borderRadius: 2, marginBottom: Math.round(size * 0.1) }} />
      {/* Middle bar */}
      <View style={{ width: Math.round(w * 0.68), height: Math.round(size * 0.12), backgroundColor: color, borderRadius: 2, marginBottom: Math.round(size * 0.1) }} />
      {/* Bottom narrow bar */}
      <View style={{ width: Math.round(w * 0.36), height: Math.round(size * 0.12), backgroundColor: color, borderRadius: 2 }} />
    </View>
  );
}

function TrashIcon({ size = 14, color = '#AAA' }: { size?: number; color?: string }) {
  const w = Math.round(size * 0.72);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'flex-end' }}>
      <View style={{ width: Math.round(w * 0.38), height: Math.round(size * 0.14), borderTopLeftRadius: 1, borderTopRightRadius: 1, backgroundColor: color }} />
      <View style={{ width: w + 2, height: Math.round(size * 0.11), backgroundColor: color, marginBottom: Math.round(size * 0.05) }} />
      <View style={{ width: w, height: Math.round(size * 0.56), borderBottomLeftRadius: 2, borderBottomRightRadius: 2, backgroundColor: color }} />
    </View>
  );
}


function UnreadDot({ active }: { active: boolean }) {
  return (
    <View style={{
      width: 14, height: 14,
      borderRadius: 7,
      backgroundColor: active ? '#FE0437' : '#CCC',
    }} />
  );
}

function AppInner() {
  const { language } = useLanguage();

  // On web, base landscape on actual device orientation via matchMedia.
  // useWindowDimensions reacts to the iOS virtual keyboard opening (which
  // shrinks visualViewport height), causing re-renders that can dismiss the
  // keyboard. matchMedia only fires on real device rotation.
  const [isLandscapeWeb, setIsLandscapeWeb] = useState<boolean>(() =>
    Platform.OS === 'web'
      ? ((globalThis as any).window?.matchMedia?.('(orientation: landscape)')?.matches ?? false)
      : false
  );
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const mq = (globalThis as any).window?.matchMedia?.('(orientation: landscape)');
    if (!mq) return;
    const handler = (e: any) => setIsLandscapeWeb(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  const { width, height } = useWindowDimensions(); // still needed for native
  const isLandscape = Platform.OS === 'web' ? isLandscapeWeb : (width > height);

  // Dynamically toggle viewport-fit=cover on the meta tag so landscape images
  // can bleed edge-to-edge past iPhone safe areas, while portrait mode is
  // completely unaffected (SafeAreaView insets stay at 0, no white bar).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const meta = (globalThis as any).document?.querySelector('meta[name="viewport"]');
    if (!meta) return;
    const base = 'width=device-width, initial-scale=1, shrink-to-fit=no';
    meta.setAttribute('content', isLandscape ? `${base}, viewport-fit=cover` : base);
  }, [isLandscape]);

  const [activeScreen, setActiveScreen] = useState<ActiveScreen>('card');
  const [currentIndex, setCurrentIndex] = useState(0);
  // When true, CardScreen swipes only liked cards (user came from LikedScreen)
  const [likedMode, setLikedMode] = useState(false);
  // When set, CardScreen swipes only these cards (search results or collection subset)
  const [swipeContext, setSwipeContext] = useState<TrendCard[] | null>(null);
  const [unreadMode, setUnreadMode] = useState(false);
  // Fixed snapshot of unread cards taken when entering unread mode.
  // Using a snapshot prevents deck-shifting (cards being removed as they're read)
  // and stops the counter from fluctuating as pagination loads more cards.
  const [unreadSnapshot, setUnreadSnapshot] = useState<TrendCard[] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pinnedIds, setPinnedIds] = useState<string[] | null>(null);
  const searchInputRef = useRef<TextInput>(null);
  const webSearchRef = useRef<any>(null);

  // Collections — used for the long-press-heart picker on home cards
  const { collections, toggleCard, createCollection } = useCollections();
  const [heartPickerCard, setHeartPickerCard] = useState<TrendCard | null>(null);
  const [heartPickerNewCol, setHeartPickerNewCol] = useState(false);
  const [heartPickerNewColName, setHeartPickerNewColName] = useState('');
  const heartPickerNewColInputRef = useRef<any>(null);

  // Track which cards have been viewed in the swipe deck.
  // Persisted via AsyncStorage so read state survives app restarts.
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  useEffect(() => { getReadIds().then(setReadIds); }, []);

  // Track app open once per session
  useEffect(() => { trackEvent('app_open'); }, []);

  const {
    cards, categories, likedIds, likedOrder, loading, loadingMore, error, total, hasMore,
    filterCategoryIds, toggleFilterCategory, clearFilterCategories,
    loadMore, toggleLike, retry, injectCard,
  } = useTrendPosts(language);

  // Filter sheet state
  const [filterOpen, setFilterOpen] = useState(false);

  const { allCards, similarityIndex, indexReady } = useAllCards();

  // Related trends map overlay
  const [relatedSourceCard, setRelatedSourceCard] = useState<TrendCard | null>(null);

  // Restore the last-viewed home card once cards are first available.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || cards.length === 0) return;
    restoredRef.current = true;
    getLastCardId().then((id) => {
      if (!id) return;
      const idx = cards.findIndex((c) => c.id === id);
      if (idx > 0) setCurrentIndex(idx);
    });
  }, [cards]);

  // Derived: liked cards for the Liked screen and liked-mode swiping
  const likedCards = cards.filter((c) => likedIds.has(c.id));

  // Unread filter: exclude cards already seen (only in home + list, not liked mode)
  const unreadCards = unreadMode ? cards.filter((c) => !readIds.has(c.id)) : cards;

  // An empty snapshot means all loaded cards were already read — treat it as absent
  // so the live unreadCards filter takes over (and auto-loadMore can fill the deck).
  const effectiveSnapshot = unreadSnapshot && unreadSnapshot.length > 0 ? unreadSnapshot : null;

  // Cards are already filtered server-side by filterCategoryId.
  // Liked mode overrides for the swipe deck only.
  // swipeContext overrides everything when the user taps from a filtered list or collection.
  // In unread mode, effectiveSnapshot (stable deck) is preferred; falls back to live filter.
  const swipeCards = swipeContext ?? (likedMode ? likedCards : effectiveSnapshot ?? unreadCards);

  // List view respects unread filter
  const listCards = unreadCards;

  // ID of the card currently shown — used to highlight in list views
  const activeCardId = swipeCards[currentIndex]?.id;

  // Whether the LIKED tab should appear active
  const isLikedTabActive = activeScreen === 'liked' || (activeScreen === 'card' && likedMode);

  // Mark a card as read only on deliberate interaction (swipe past, list tap, navigator tap).
  function markRead(cardId: string) {
    setReadIds((prev) => {
      if (prev.has(cardId)) return prev;
      const next = new Set(prev);
      next.add(cardId);
      return next;
    });
  }

  // When currentIndex changes in home (swipe), mark the card the user swiped AWAY from
  // and track the newly shown card.
  const prevSwipeIndexRef = useRef<number>(-1);
  useEffect(() => {
    const prev = prevSwipeIndexRef.current;
    prevSwipeIndexRef.current = currentIndex;
    if (activeScreen !== 'card' || likedMode) return;
    if (prev >= 0 && prev !== currentIndex) {
      const card = swipeCards[prev];
      if (card) markRead(card.id);
    }
    // Track the card now being viewed
    const viewed = swipeCards[currentIndex];
    if (viewed) {
      trackEvent('card_view', {
        cardId: viewed.id,
        cardTitle: viewed.subtitle || viewed.title,
        cardCategory: viewed.categoryIds?.[0] ?? undefined,
      });
    }
  }, [currentIndex]);

  // Persist read state to AsyncStorage whenever it changes.
  useEffect(() => { saveReadIds(readIds); }, [readIds]);

  // When in unread mode with an empty deck (all loaded cards are read) but the server
  // has more pages, automatically fetch the next page so the user isn't stuck.
  useEffect(() => {
    if (unreadMode && swipeCards.length === 0 && hasMore && !loading && !loadingMore) {
      loadMore();
    }
  }, [unreadMode, swipeCards.length, hasMore, loading, loadingMore]);

  // Persist the current home-mode card so the app reopens at the same position.
  // Only save in plain home mode (not liked-mode, not a swipe context).
  useEffect(() => {
    if (likedMode || swipeContext) return;
    const card = unreadCards[currentIndex];
    if (card) saveLastCardId(card.id);
  }, [currentIndex, likedMode, swipeContext]);

  // Live search: jump to matching card as the user types (300 ms debounce)
  useEffect(() => {
    if (!searchQuery.trim() || activeScreen !== 'card' || swipeCards.length === 0) return;
    const timer = setTimeout(() => {
      const query = searchQuery.toLowerCase();
      const idx = swipeCards.findIndex(
        (c) =>
          c.title.toLowerCase().includes(query) ||
          c.subtitle.toLowerCase().includes(query) ||
          c.keywords.some((k) => k.toLowerCase().includes(query))
      );
      if (idx >= 0) setCurrentIndex(idx);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, activeScreen, swipeCards]);

  /**
   * Map the current liked-mode index back to the full cards array and clear
   * liked mode. Call before switching to HOME or LIJST.
   */
  function exitLikedMode() {
    if (!likedMode && !swipeContext) return;
    const currentCard = swipeCards[currentIndex];
    const fullIdx = currentCard ? cards.findIndex((c) => c.id === currentCard.id) : 0;
    setCurrentIndex(fullIdx >= 0 ? fullIdx : 0);
    setLikedMode(false);
    setSwipeContext(null);
  }

  /**
   * Called from ListScreen.
   * When a filter/search is active, `context` is the filtered subset so the swipe
   * deck only contains those cards. Without context, swipes through all list cards.
   */
  function handleSelectCard(index: number, context?: TrendCard[]) {
    if (context) {
      const card = context[index];
      if (card) markRead(card.id);
      setSwipeContext(context);
      setCurrentIndex(index);
    } else {
      const card = listCards[index];
      if (card) markRead(card.id);
      setSwipeContext(null);
      setCurrentIndex(index);
    }
    setLikedMode(false);
    setActiveScreen('card');
  }

  /**
   * Called from LikedScreen.
   * When in a collection view, `context` is the collection's visible cards so the
   * swipe deck only contains those cards. Without context, swipes all liked cards.
   */
  function handleSelectLikedCard(originalIndex: number, context?: TrendCard[]) {
    if (context) {
      // originalIndex is the index within `context`
      setSwipeContext(context);
      setCurrentIndex(originalIndex);
    } else {
      const card = cards[originalIndex];
      if (!card) return;
      const likedIdx = likedCards.findIndex((c) => c.id === card.id);
      setSwipeContext(null);
      setCurrentIndex(likedIdx >= 0 ? likedIdx : 0);
    }
    setLikedMode(true);
    setActiveScreen('card');
  }

  function handleHeartLongPress(card: TrendCard) {
    // Auto-like the card if not already liked (you're adding it to a collection)
    if (!likedIds.has(card.id)) toggleLike(card.id);
    setHeartPickerCard(card);
  }

  function handleHeartPickerCreateCollection() {
    const name = heartPickerNewColName.trim();
    if (!name) return;
    const id = createCollection(name);
    if (id && heartPickerCard) {
      toggleCard(id, heartPickerCard.id);
      trackEvent('collection_add', {
        cardId: heartPickerCard.id,
        cardTitle: heartPickerCard.subtitle || heartPickerCard.title,
        collectionId: id,
      });
    }
    setHeartPickerNewColName('');
    setHeartPickerNewCol(false);
  }

  function handleHomePress() {
    exitLikedMode();
    setSwipeContext(null);
    setActiveScreen('card');
  }

  function handleListPress() {
    exitLikedMode();
    setSwipeContext(null);
    setActiveScreen('list');
  }

  function handleFilterPress() {
    setFilterOpen(true);
  }

  function toggleUnreadMode() {
    const turningOn = !unreadMode;
    setUnreadMode(turningOn);
    setCurrentIndex(0);
    if (likedMode) setLikedMode(false);
    if (turningOn) {
      // Only snapshot immediately if cards are already loaded.
      // If cards are still loading the effect below will take the snapshot as
      // soon as they arrive, preventing an empty deck / "no cards found".
      if (!loading && cards.length > 0) {
        setUnreadSnapshot(cards.filter((c) => !readIds.has(c.id)));
      }
      // else: unreadSnapshot stays null → swipeCards falls back to unreadCards
      // (dynamic live filter) until the deferred effect fires.
    } else {
      setUnreadSnapshot(null);
    }
  }

  // Deferred snapshot: if the user toggled unread mode while cards were still
  // loading, take the snapshot as soon as the first page of cards is ready.
  useEffect(() => {
    if (unreadMode && !unreadSnapshot && !loading && cards.length > 0) {
      setUnreadSnapshot(cards.filter((c) => !readIds.has(c.id)));
      setCurrentIndex(0);
    }
  }, [unreadMode, unreadSnapshot, loading, cards.length]);

  function handleClearSearch() {
    setSearchQuery('');
    setPinnedIds(null);
    if (Platform.OS === 'web' && webSearchRef.current) {
      webSearchRef.current.value = '';
    }
  }

  /** Submit search: go to LIST (from home/filter) or stay in LIKED */
  function handleSearchSubmit() {
    if (!searchQuery.trim()) return;
    trackEvent('search', { query: searchQuery.trim() });
    if (activeScreen === 'liked') return; // stays filtered in LIKED

    // Easter egg: /r or /r3 → random card(s) in list view
    const randomMatch = searchQuery.trim().match(/^\/[rR](\d+)?$/);
    if (randomMatch) {
      const n = Math.min(parseInt(randomMatch[1] || '1', 10), cards.length);
      const shuffled = [...cards].sort(() => Math.random() - 0.5);
      setPinnedIds(shuffled.slice(0, n).map((c) => c.id));
      exitLikedMode();
      setActiveScreen('list');
      return;
    }

    setPinnedIds(null);
    exitLikedMode();
    setActiveScreen('list');
  }

  function handleProfilePress() {
    exitLikedMode();
    setActiveScreen('profile');
  }

  function handleShowRelated(card: TrendCard) {
    setRelatedSourceCard(card);
  }

  function handleSelectRelated(card: TrendCard) {
    markRead(card.id);
    setRelatedSourceCard(null);
    const idx = cards.findIndex((c) => c.id === card.id);
    if (idx >= 0) {
      setCurrentIndex(idx);
    } else {
      injectCard(card);
      setCurrentIndex(0);
    }
    setLikedMode(false);
    setActiveScreen('card');
  }

  useShake(React.useCallback(() => {
    if (cards.length === 0) return;
    const randomIdx = Math.floor(Math.random() * cards.length);
    setCurrentIndex(randomIdx);
    setLikedMode(false);
    setActiveScreen('card');
  }, [cards]));

  const positionLabel = (() => {
    if (swipeCards.length === 0) return '';
    const pos = currentIndex + 1;
    let total_: string;
    if (swipeContext) {
      total_ = String(swipeContext.length);
    } else if (likedMode) {
      total_ = String(likedCards.length);
    } else if (effectiveSnapshot) {
      // Stable snapshot count; '+' signals more server pages may contain unread cards.
      total_ = `${effectiveSnapshot.length}${hasMore ? '+' : ''}`;
    } else if (unreadMode) {
      // Snapshot not ready yet — use the live unread count rather than the server total.
      total_ = `${unreadCards.length}${hasMore ? '+' : ''}`;
    } else {
      total_ = String(total || cards.length);
    }
    return `${pos} / ${total_}`;
  })();

  // Landscape: fullscreen image only, no chrome
  if (isLandscape) {
    return (
      // StyleSheet.absoluteFillObject (position:absolute + all sides 0) makes
      // the container bleed past safe-area insets to the physical screen edges,
      // so the card image can go truly full-screen in landscape.
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#000' }]}>
        <CardScreen
          cards={swipeCards}
          currentIndex={currentIndex}
          likedIds={likedIds}
          isLandscape
          onIndexChange={setCurrentIndex}
          onToggleLike={toggleLike}
          loadMore={likedMode || swipeContext || effectiveSnapshot ? () => {} : loadMore}
          hasMore={likedMode || swipeContext || effectiveSnapshot ? false : hasMore}
          loading={loading}
          error={error}
          onRetry={retry}
          onHeartLongPress={handleHeartLongPress}
        />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFF" />

      <View style={styles.searchBar}>
        <View style={styles.searchRow}>
          <View style={styles.searchContainer}>
            {Platform.OS === 'web'
              ? (React.createElement as any)('input', {
                  ref: webSearchRef,
                  style: {
                    flex: '1',
                    height: '100%',
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    // ≥16px prevents iOS Safari from auto-zooming on focus
                    fontSize: 16,
                    color: '#111',
                    cursor: 'text',
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                  },
                  placeholder: t(language, 'search_placeholder'),
                  onKeyDown: (e: any) => { if (e.key === 'Enter') handleSearchSubmit(); },
                  // No value prop — uncontrolled input. React.createElement with
                  // value= causes WebKit (iOS Safari/Chrome) to dismiss the keyboard
                  // whenever App re-renders (e.g. when keyboard opens and shrinks
                  // visualViewport height). Without value=, React never touches
                  // input.value after the initial render, so focus is preserved.
                  onChange: (e: any) => setSearchQuery(e.target.value),
                  type: 'text',
                })
              : (
                <TextInput
                  ref={searchInputRef}
                  style={styles.searchInput}
                  placeholder={t(language, 'search_placeholder')}
                  placeholderTextColor="#AAA"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  returnKeyType="search"
                  onSubmitEditing={handleSearchSubmit}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              )}
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={handleClearSearch} style={styles.clearBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <TrashIcon size={14} color="#AAA" />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity style={styles.unreadButton} onPress={toggleUnreadMode}>
            <UnreadDot active={unreadMode} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.profileButton} onPress={handleFilterPress} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <FilterIcon active={filterCategoryIds.length > 0} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Main content */}
      <View style={styles.content}>
        {activeScreen === 'card' ? (
          <>
            <CardScreen
              cards={swipeCards}
              currentIndex={currentIndex}
              likedIds={likedIds}
              isLandscape={false}
              onIndexChange={setCurrentIndex}
              onToggleLike={toggleLike}
              loadMore={likedMode || swipeContext || effectiveSnapshot ? () => {} : loadMore}
              hasMore={likedMode || swipeContext || effectiveSnapshot ? false : hasMore}
              loading={loading || (unreadMode && loadingMore && swipeCards.length === 0)}
              error={error}
              onRetry={retry}
              onRelated={handleShowRelated}
              onHeartLongPress={handleHeartLongPress}
            />
            {swipeCards.length > 0 && !loading && (
              <Text style={styles.positionLabel}>{positionLabel}</Text>
            )}
          </>
        ) : activeScreen === 'list' ? (
          <ListScreen
            cards={listCards}
            likedIds={likedIds}
            readIds={readIds}
            currentIndex={currentIndex}
            searchQuery={searchQuery}
            pinnedIds={pinnedIds}
            unreadMode={unreadMode}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onSelectCard={handleSelectCard}
            loadMore={loadMore}
          />
        ) : activeScreen === 'profile' ? (
          <ProfileScreen />
        ) : (
          <LikedScreen
            cards={cards}
            likedIds={likedIds}
            likedOrder={likedOrder}
            activeCardId={activeCardId}
            searchQuery={searchQuery}
            onSelectCard={(idx, ctx) => handleSelectLikedCard(idx, ctx)}
          />
        )}
      </View>

      {/* Bottom navigation */}
      <View style={styles.bottomNav}>
        {/* HOME — active only when NOT in liked mode */}
        <TouchableOpacity
          style={[styles.navButton, activeScreen === 'card' && !likedMode && styles.navButtonActive]}
          onPress={handleHomePress}
        >
          <Text style={[styles.navIcon, activeScreen === 'card' && !likedMode && styles.navIconActive]}>⊟</Text>
          <Text style={[styles.navLabel, activeScreen === 'card' && !likedMode && styles.navLabelActive]}>
            {t(language, 'nav_home')}
          </Text>
        </TouchableOpacity>

        {/* LIKED */}
        <TouchableOpacity
          style={[styles.navButton, isLikedTabActive && styles.navButtonActive]}
          onPress={() => { setActiveScreen('liked'); }}
        >
          <Text style={[styles.navIcon, isLikedTabActive && styles.navIconActive]}>
            {isLikedTabActive ? '♥' : '♡'}
          </Text>
          <Text style={[styles.navLabel, isLikedTabActive && styles.navLabelActive]}>
            {t(language, 'nav_liked')}
          </Text>
        </TouchableOpacity>

        {/* LIST */}
        <TouchableOpacity
          style={[styles.navButton, activeScreen === 'list' && styles.navButtonActive]}
          onPress={handleListPress}
        >
          <Text style={[styles.navIcon, activeScreen === 'list' && styles.navIconActive]}>☰</Text>
          <Text style={[styles.navLabel, activeScreen === 'list' && styles.navLabelActive]}>
            {t(language, 'nav_list')}
          </Text>
        </TouchableOpacity>

        {/* PROFILE */}
        <TouchableOpacity
          style={[styles.navButton, activeScreen === 'profile' && styles.navButtonActive]}
          onPress={handleProfilePress}
        >
          <View style={{ height: 24, marginBottom: 2, alignItems: 'center', justifyContent: 'center' }}>
            <ProfileIcon
              color={activeScreen === 'profile' ? '#FE0437' : '#888'}
              size={20}
            />
          </View>
          <Text style={[styles.navLabel, activeScreen === 'profile' && styles.navLabelActive]}>
            {t(language, 'nav_profile')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Long-press heart: collection picker ── */}
      <Modal visible={!!heartPickerCard} transparent animationType="slide" onRequestClose={() => setHeartPickerCard(null)}>
        <TouchableOpacity style={pickerStyles.overlay} activeOpacity={1} onPress={() => setHeartPickerCard(null)}>
          <TouchableOpacity style={pickerStyles.sheet} activeOpacity={1}>
            <View style={pickerStyles.handle} />
            <Text style={pickerStyles.title}>{t(language, 'col_add_to')}</Text>
            {collections.length === 0
              ? <Text style={pickerStyles.empty}>No collections yet</Text>
              : collections.map((col) => {
                  const included = heartPickerCard ? col.cardIds.includes(heartPickerCard.id) : false;
                  return (
                    <TouchableOpacity key={col.id} style={pickerStyles.row}
                      onPress={() => {
                        if (!heartPickerCard) return;
                        const wasIncluded = col.cardIds.includes(heartPickerCard.id);
                        toggleCard(col.id, heartPickerCard.id);
                        if (!wasIncluded) {
                          trackEvent('collection_add', {
                            cardId: heartPickerCard.id,
                            cardTitle: heartPickerCard.subtitle || heartPickerCard.title,
                            collectionId: col.id,
                          });
                        }
                      }}>
                      <Text style={pickerStyles.check}>{included ? '☑' : '☐'}</Text>
                      <Text style={pickerStyles.colName}>{col.name}</Text>
                    </TouchableOpacity>
                  );
                })
            }
            <TouchableOpacity style={pickerStyles.newBtn} onPress={() => setHeartPickerNewCol(true)}>
              <Text style={pickerStyles.newText}>{t(language, 'col_new_plus')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={pickerStyles.doneBtn} onPress={() => setHeartPickerCard(null)}>
              <Text style={pickerStyles.doneText}>{t(language, 'col_done')}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Long-press heart: new collection modal ── */}
      <Modal visible={heartPickerNewCol} transparent animationType="slide" onRequestClose={() => setHeartPickerNewCol(false)}>
        <TouchableOpacity style={pickerStyles.overlay} activeOpacity={1} onPress={() => setHeartPickerNewCol(false)}>
          <TouchableOpacity style={pickerStyles.newColBox} activeOpacity={1}>
            <Text style={pickerStyles.newColTitle}>{t(language, 'col_new')}</Text>
            {Platform.OS === 'web'
              ? (React.createElement as any)('input', {
                  ref: heartPickerNewColInputRef,
                  style: { height: 44, border: '1.5px solid #111', borderRadius: 6, paddingLeft: 12, paddingRight: 12, fontSize: 16, color: '#111', background: '#FFF', outline: 'none', width: '100%', boxSizing: 'border-box', marginBottom: 12, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
                  placeholder: t(language, 'col_name_placeholder'),
                  value: heartPickerNewColName,
                  onChange: (e: any) => setHeartPickerNewColName(e.target.value),
                  onKeyDown: (e: any) => { if (e.key === 'Enter') handleHeartPickerCreateCollection(); },
                  type: 'text',
                })
              : <TextInput style={pickerStyles.newColInput} placeholder={t(language, 'col_name_placeholder')} placeholderTextColor="#AAA" value={heartPickerNewColName} onChangeText={setHeartPickerNewColName} autoFocus returnKeyType="done" onSubmitEditing={handleHeartPickerCreateCollection} />
            }
            <View style={pickerStyles.newColButtons}>
              <TouchableOpacity style={pickerStyles.cancelBtn} onPress={() => { setHeartPickerNewCol(false); setHeartPickerNewColName(''); }}>
                <Text style={pickerStyles.cancelText}>{t(language, 'col_cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[pickerStyles.createBtn, !heartPickerNewColName.trim() && pickerStyles.createBtnDisabled]} onPress={handleHeartPickerCreateCollection} disabled={!heartPickerNewColName.trim()}>
                <Text style={pickerStyles.createText}>{t(language, 'col_create')}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Filter sheet ── */}
      <Modal visible={filterOpen} transparent animationType="slide" onRequestClose={() => setFilterOpen(false)}>
        <TouchableOpacity style={pickerStyles.overlay} activeOpacity={1} onPress={() => setFilterOpen(false)}>
          <TouchableOpacity style={pickerStyles.sheet} activeOpacity={1}>
            <View style={pickerStyles.handle} />
            <Text style={pickerStyles.title}>{t(language, 'filter_title').toUpperCase()}</Text>
            {categories.map((cat) => {
              const active = filterCategoryIds.includes(cat.id);
              const isArchive = cat.id === '__archive__';
              return (
                <React.Fragment key={cat.id}>
                  {isArchive && <View style={pickerStyles.catSeparator} />}
                  <TouchableOpacity
                    style={pickerStyles.row}
                    onPress={() => { toggleFilterCategory(cat.id); setCurrentIndex(0); }}
                  >
                    <Text style={[pickerStyles.check, isArchive && pickerStyles.archiveCheck]}>{active ? '☑' : '☐'}</Text>
                    <Text style={[pickerStyles.colName, isArchive && pickerStyles.archiveLabel]}>
                      {tCategory(language, cat.label)}
                    </Text>
                  </TouchableOpacity>
                </React.Fragment>
              );
            })}
            {/* Always reserve space so layout doesn't shift when filter is toggled */}
            <TouchableOpacity
              style={[pickerStyles.newBtn, !filterCategoryIds.length && { opacity: 0 }]}
              onPress={() => { clearFilterCategories(); setCurrentIndex(0); }}
              disabled={filterCategoryIds.length === 0}
            >
              <Text style={pickerStyles.newText}>{t(language, 'filter_clear_all')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={pickerStyles.doneBtn} onPress={() => setFilterOpen(false)}>
              <Text style={pickerStyles.doneText}>{t(language, 'col_done')}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Related Trends overlay — rendered at SafeAreaView level so it covers nav + content */}
      {relatedSourceCard && (
        <RelatedTrendsMap
          sourceCard={relatedSourceCard}
          allCards={allCards}
          similarityIndex={similarityIndex}
          indexReady={indexReady}
          onSelectCard={handleSelectRelated}
          onClose={() => setRelatedSourceCard(null)}
        />
      )}
    </SafeAreaView>
  );
}

const pickerStyles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 32, paddingHorizontal: 20, paddingTop: 12 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#DDD', alignSelf: 'center', marginBottom: 16 },
  title: { fontSize: 16, fontWeight: '700', color: '#111', marginBottom: 16, textAlign: 'center' },
  empty: { fontSize: 14, color: '#AAA', textAlign: 'center', marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  check: { fontSize: 20, color: '#FE0437', marginRight: 12, width: 24 },
  colName: { fontSize: 15, color: '#222' },
  catSeparator: { paddingTop: 8, paddingBottom: 4 },
  archiveCheck: { color: '#999' },
  archiveLabel: { color: '#888', fontStyle: 'italic' },
  newBtn: { paddingVertical: 14 },
  newText: { fontSize: 14, color: '#FE0437', fontWeight: '600' },
  doneBtn: { marginTop: 8, backgroundColor: '#111', borderRadius: 24, height: 48, alignItems: 'center', justifyContent: 'center' },
  doneText: { color: '#FFF', fontSize: 14, fontWeight: '700', letterSpacing: 1 },
  // New collection sub-modal
  newColBox: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  newColTitle: { fontSize: 16, fontWeight: '700', color: '#111', marginBottom: 16, textAlign: 'center' },
  newColInput: { height: 44, borderWidth: 1.5, borderColor: '#111', borderRadius: 6, paddingHorizontal: 12, fontSize: 16, color: '#111', marginBottom: 12 },
  newColButtons: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, height: 44, borderRadius: 8, borderWidth: 1, borderColor: '#DDD', alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 14, color: '#555' },
  createBtn: { flex: 1, height: 44, borderRadius: 8, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  createBtnDisabled: { backgroundColor: '#DDD' },
  createText: { fontSize: 14, color: '#FFF', fontWeight: '700' },
});

export default function App() {
  return (
    <LanguageProvider>
      <AppInner />
    </LanguageProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFF',
  },
  searchBar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#FFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8E8E8',
    zIndex: 10,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchContainer: {
    flex: 1,
    height: 38,
    backgroundColor: '#F4F4F4',
    borderRadius: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#111',
  },
  clearBtn: {
    paddingLeft: 6,
  },
  unreadButton: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileButton: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  content: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  positionLabel: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    color: '#FFF',
    fontSize: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: 'hidden',
  },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: '#111111',
    paddingBottom: Platform.OS === 'ios' ? 0 : 4,
  },
  navButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  navButtonActive: {},
  navIcon: {
    fontSize: 20,
    lineHeight: 24,
    color: '#888',
    marginBottom: 2,
  },
  navIconActive: {
    color: '#FE0437',
  },
  navLabel: {
    fontSize: 10,
    color: '#888',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  navLabelActive: {
    color: '#FE0437',
  },
});
