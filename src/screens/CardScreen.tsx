import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  PanResponder,
  Dimensions,
  ActivityIndicator,
  Platform,
  TouchableOpacity,
} from 'react-native';
import TrendCard from '../components/TrendCard';
import { TrendCard as TrendCardType } from '../lib/wixApi';
import { useLanguage } from '../contexts/LanguageContext';
import { t } from '../lib/i18n';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SWIPE_THRESHOLD = 60;

interface Props {
  cards: TrendCardType[];
  currentIndex: number;
  likedIds: Set<string>;
  isLandscape: boolean;
  onIndexChange: (index: number) => void;
  onToggleLike: (postId: string) => void;
  loadMore: () => void;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  onRelated?: (card: TrendCardType) => void;
  onHeartLongPress?: (card: TrendCardType) => void;
}

export default function CardScreen({
  cards,
  currentIndex,
  likedIds,
  isLandscape,
  onIndexChange,
  onToggleLike,
  loadMore,
  hasMore,
  loading,
  error,
  onRetry,
  onRelated,
  onHeartLongPress,
}: Props) {
  const { language } = useLanguage();
  const translateX = useRef(new Animated.Value(0)).current;

  // Refs to always hold the latest prop values inside the stable panResponder closure
  const currentIndexRef = useRef(currentIndex);
  const cardsRef = useRef(cards);
  const hasMoreRef = useRef(hasMore);
  const onIndexChangeRef = useRef(onIndexChange);
  const loadMoreRef = useRef(loadMore);

  useEffect(() => { currentIndexRef.current = currentIndex; });
  useEffect(() => { cardsRef.current = cards; });
  useEffect(() => { hasMoreRef.current = hasMore; });
  useEffect(() => { onIndexChangeRef.current = onIndexChange; });
  useEffect(() => { loadMoreRef.current = loadMore; });

  // Native PanResponder — used on iOS/Android only
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > Math.abs(gs.dy) * 1.3 && Math.abs(gs.dx) > 8,

      onPanResponderMove: (_, gs) => {
        translateX.setValue(gs.dx);
      },

      onPanResponderRelease: (_, gs) => {
        if (gs.dx < -SWIPE_THRESHOLD) {
          handleSwipe('left');
        } else if (gs.dx > SWIPE_THRESHOLD) {
          handleSwipe('right');
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  function handleSwipe(direction: 'left' | 'right') {
    // Read fresh values from refs — never stale
    const idx = currentIndexRef.current;
    const cardCount = cardsRef.current.length;
    const more = hasMoreRef.current;

    // Reversed: swipe left → next card, swipe right → previous card
    const nextIndex = direction === 'left' ? idx + 1 : idx - 1;

    if (direction === 'right' && idx === 0) {
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
      return;
    }
    if (direction === 'left' && idx >= cardCount - 1) {
      if (more) loadMoreRef.current();
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
      return;
    }

    const exitTo = direction === 'left' ? -SCREEN_WIDTH : SCREEN_WIDTH;
    Animated.timing(translateX, {
      toValue: exitTo,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      onIndexChangeRef.current(nextIndex);
      translateX.setValue(0);
      if (direction === 'left' && nextIndex >= cardCount - 5 && more) {
        loadMoreRef.current();
      }
    });
  }

  // ── Web: native DOM touch + keyboard events ────────────────────────────────
  // React Native Web's PanResponder attaches listeners at the DOCUMENT root
  // (capture phase), which means ANY tap on the page — including the search bar
  // — fires the pan-responder and triggers a spring-back flicker that blocks
  // the search input from receiving focus.
  //
  // Fix: on web, skip panHandlers entirely and use element-scoped DOM listeners
  // instead. These only fire for touches that originate ON the card div, so the
  // search bar is completely unaffected.
  const webCardRef = useRef<any>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = webCardRef.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;

    const onTouchStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      // Only track horizontal movement for the drag-feedback animation
      if (Math.abs(dx) > Math.abs(dy)) {
        translateX.setValue(dx);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
        handleSwipe(dx < 0 ? 'left' : 'right');
      } else {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
      }
    };

    // Desktop: arrow-key navigation.
    // Skip when an input/textarea has focus so typing doesn't accidentally swipe.
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') handleSwipe('left');
      if (e.key === 'ArrowRight') handleSwipe('right');
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    (globalThis as any).document?.addEventListener('keydown', onKeyDown);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      (globalThis as any).document?.removeEventListener('keydown', onKeyDown);
    };
    // Include `loading` so the effect re-fires when the card view first becomes
    // visible (loading spinner → card): on the first run webCardRef.current is
    // null (loading screen shown), so no listeners are attached; on the second
    // run (loading=false) the Animated.View is in the DOM and we attach them.
    // handleSwipe and translateX are stable so no stale-closure risk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, isLandscape]);

  // ──────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#FE0437" />
        <Text style={styles.loadingText}>{t(language, 'card_loading')}</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>⚠ {t(language, 'card_error')}</Text>
        {onRetry && (
          <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
            <Text style={styles.retryButtonText}>{t(language, 'card_retry')}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  if (cards.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingText}>{t(language, 'card_no_cards')}</Text>
      </View>
    );
  }

  const card = cards[currentIndex];

  // Landscape: fullscreen image + title overlay + like button
  if (isLandscape) {
    return (
      <View
        ref={Platform.OS === 'web' ? webCardRef : undefined}
        style={styles.landscapeContainer}
        {...(Platform.OS !== 'web' ? panResponder.panHandlers : {})}
      >
        <Animated.Image
          source={{ uri: card.imageUrl }}
          style={[styles.landscapeImage, { transform: [{ translateX }] }]}
          resizeMode="cover"
        />
        {/* Like button top-right */}
        <TouchableOpacity
          style={styles.landscapeLikeBtn}
          onPress={() => onToggleLike(card.id)}
          activeOpacity={0.7}
        >
          <Text style={styles.landscapeLikeIcon}>
            {likedIds.has(card.id) ? '♥' : '♡'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <Animated.View
      // On web: attach ref for native DOM touch listeners (no panHandlers)
      // On native: use PanResponder as before
      ref={Platform.OS === 'web' ? webCardRef : undefined}
      style={[styles.cardWrapper, { transform: [{ translateX }] }]}
      {...(Platform.OS !== 'web' ? panResponder.panHandlers : {})}
    >
      <TrendCard
        card={card}
        isLiked={likedIds.has(card.id)}
        onToggleLike={() => onToggleLike(card.id)}
        onRelated={onRelated ? () => onRelated(card) : undefined}
        onHeartLongPress={onHeartLongPress ? () => onHeartLongPress(card) : undefined}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cardWrapper: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  loadingText: {
    marginTop: 12,
    color: '#666',
    fontSize: 15,
  },
  errorText: {
    color: '#FE0437',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  retryButton: {
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#111',
    borderRadius: 24,
  },
  retryButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  landscapeContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  landscapeImage: {
    // flex: 1 fills the container naturally — avoids the conflict between
    // position:absolute and width/height:'100%' that can leave black gaps on web.
    flex: 1,
    backgroundColor: '#000',
  },
  landscapeLikeBtn: {
    position: 'absolute',
    top: 16,
    right: 20,
    padding: 8,
  },
  landscapeLikeIcon: {
    fontSize: 32,
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
