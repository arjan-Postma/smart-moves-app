import React from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { TrendCard } from '../lib/wixApi';
import { useLanguage } from '../contexts/LanguageContext';
import { t } from '../lib/i18n';

interface Props {
  cards: TrendCard[];
  likedIds: Set<string>;
  readIds: Set<string>;
  currentIndex: number;
  searchQuery: string;
  pinnedIds?: string[] | null;
  unreadMode?: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onSelectCard: (index: number, context?: TrendCard[]) => void;
  loadMore: () => void;
}

export default function ListScreen({
  cards,
  likedIds,
  readIds,
  currentIndex,
  searchQuery,
  pinnedIds,
  unreadMode,
  hasMore,
  loadingMore,
  onSelectCard,
  loadMore,
}: Props) {
  const { language } = useLanguage();
  const query = searchQuery.toLowerCase();
  const filtered = pinnedIds
    ? pinnedIds.map((id) => cards.find((c) => c.id === id)).filter(Boolean) as TrendCard[]
    : query.length > 1
      ? cards.filter(
          (c) =>
            c.title.toLowerCase().includes(query) ||
            c.subtitle.toLowerCase().includes(query) ||
            c.keywords.some((k) => k.toLowerCase().includes(query))
        )
      : cards;

  // A filter is active when pinnedIds is set OR when there's a search query —
  // in that case we pass `filtered` as context so the swipe deck stays bounded.
  const filterActive = !!(pinnedIds || query.length > 1);

  function renderItem({ item, index }: { item: TrendCard; index: number }) {
    const originalIndex = cards.indexOf(item);
    const isActive = originalIndex === currentIndex;
    const liked = likedIds.has(item.id);
    const unread = !readIds.has(item.id);

    return (
      <TouchableOpacity
        style={[styles.row, isActive && styles.rowActive]}
        onPress={() => filterActive ? onSelectCard(filtered.indexOf(item), filtered) : onSelectCard(originalIndex)}
        activeOpacity={0.7}
      >
        {item.imageUrl ? (
          <Image source={{ uri: item.imageUrl }} style={styles.thumbnail} resizeMode="cover" />
        ) : (
          <View style={[styles.thumbnail, styles.thumbnailPlaceholder]} />
        )}
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.rowSubtitle} numberOfLines={2}>
            {item.subtitle}
          </Text>
        </View>
        {/* Single fixed slot — liked and unread are mutually exclusive */}
        <View style={styles.iconSlot}>
          {liked
            ? <Text style={styles.rowHeart}>♥</Text>
            : unread
              ? <View style={styles.unreadDot} />
              : null}
        </View>
      </TouchableOpacity>
    );
  }

  // Info bar label — shown when a search filter or unread mode is active
  let barLabel: string | null = null;
  if (pinnedIds) {
    barLabel = t(language, 'list_bar_pinned', { n: filtered.length });
  } else if (query.length > 1) {
    barLabel = t(language, 'list_bar_search', { n: filtered.length, q: searchQuery.trim() });
  } else if (unreadMode) {
    barLabel = t(language, 'list_bar_unread', { n: filtered.length });
  }

  return (
    <View style={styles.container}>
      {barLabel !== null && (
        <View style={styles.infoBar}>
          <Text style={styles.infoBarText} numberOfLines={1}>{barLabel}</Text>
        </View>
      )}
    <FlatList
      data={filtered}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      onEndReached={hasMore ? loadMore : undefined}
      onEndReachedThreshold={0.3}
      ListFooterComponent={
        loadingMore ? (
          <ActivityIndicator style={styles.footer} color="#FE0437" />
        ) : hasMore ? (
          <Text style={styles.footerText}>{t(language, 'list_scroll_more')}</Text>
        ) : (
          <Text style={styles.footerText}>{t(language, 'list_count', { n: filtered.length })}</Text>
        )
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{t(language, 'list_no_results', { q: searchQuery })}</Text>
        </View>
      }
    />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  infoBar: {
    backgroundColor: '#F4F4F4',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8E8E8',
  },
  infoBarText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111',
    letterSpacing: 0.3,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8E8E8',
    backgroundColor: '#FFF',
  },
  rowActive: {
    backgroundColor: '#FFF8F4',
  },
  thumbnail: {
    width: 64,
    height: 64,
    borderRadius: 6,
    marginRight: 12,
  },
  thumbnailPlaceholder: {
    backgroundColor: '#E0E0E0',
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  rowSubtitle: {
    fontSize: 13,
    color: '#555',
    lineHeight: 18,
  },
  iconSlot: {
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  rowHeart: {
    fontSize: 14,
    lineHeight: 14,
    color: '#FE0437',
    textAlign: 'center',
    includeFontPadding: false,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#67CDCD',
  },
  footer: {
    padding: 20,
  },
  footerText: {
    textAlign: 'center',
    color: '#AAA',
    fontSize: 12,
    padding: 20,
  },
  empty: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: '#999',
    fontSize: 14,
  },
});
