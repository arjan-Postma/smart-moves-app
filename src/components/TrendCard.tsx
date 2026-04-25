import React, { useRef } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Animated,
} from 'react-native';
import { TrendCard as TrendCardType } from '../lib/wixApi';
import { useLanguage } from '../contexts/LanguageContext';
import { t } from '../lib/i18n';
import { trackEvent } from '../lib/analytics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const IMAGE_HEIGHT = SCREEN_WIDTH * (9 / 16);

// Hub / network icon for Related Moves button
function HubIcon({ size = 22, color = '#111111' }: { size?: number; color?: string }) {
  const cx = size / 2;
  const cy = size / 2;
  const centerR = size * 0.16;
  const spokeLen = size * 0.26;
  const dotR = size * 0.10;
  const lineW = Math.max(1, Math.round(size * 0.07));
  const angles = [-90, -30, 30, 90, 150, 210];

  return (
    <View style={{ width: size, height: size }}>
      <View style={{
        position: 'absolute',
        width: centerR * 2, height: centerR * 2, borderRadius: centerR,
        backgroundColor: color,
        left: cx - centerR, top: cy - centerR,
      }} />
      {angles.map((angle) => {
        const rad = (angle * Math.PI) / 180;
        const midDist = centerR + spokeLen / 2;
        const endDist = centerR + spokeLen;
        const midX = cx + midDist * Math.cos(rad);
        const midY = cy + midDist * Math.sin(rad);
        const endX = cx + endDist * Math.cos(rad);
        const endY = cy + endDist * Math.sin(rad);
        return (
          <React.Fragment key={angle}>
            <View style={{
              position: 'absolute',
              width: lineW, height: spokeLen,
              backgroundColor: color,
              left: midX - lineW / 2, top: midY - spokeLen / 2,
              transform: [{ rotate: `${angle + 90}deg` }],
            }} />
            <View style={{
              position: 'absolute',
              width: dotR * 2, height: dotR * 2, borderRadius: dotR,
              backgroundColor: color,
              left: endX - dotR, top: endY - dotR,
            }} />
          </React.Fragment>
        );
      })}
    </View>
  );
}

interface Props {
  card: TrendCardType;
  isLiked: boolean;
  onToggleLike: () => void;
  onHeartLongPress?: () => void;
  onRelated?: () => void;
}

export default function TrendCard({ card, isLiked, onToggleLike, onHeartLongPress, onRelated }: Props) {
  const { language } = useLanguage();
  const heartScale = useRef(new Animated.Value(1)).current;
  const longPressActiveRef = useRef(false);

  function handleLikePress() {
    if (longPressActiveRef.current) { longPressActiveRef.current = false; return; }
    Animated.sequence([
      Animated.spring(heartScale, { toValue: 1.4, useNativeDriver: true }),
      Animated.spring(heartScale, { toValue: 1, useNativeDriver: true }),
    ]).start();
    if (!isLiked) {
      trackEvent('card_like', { cardId: card.id, cardTitle: card.title });
    }
    onToggleLike();
  }

  function handleHeartLongPress() {
    longPressActiveRef.current = true;
    onHeartLongPress?.();
  }

  // questions = card.keywords (repurposed field)
  const questions = card.keywords;

  return (
    <View style={styles.card}>
      {/* Image */}
      <View style={styles.imageContainer}>
        {card.imageUrl ? (
          <Image source={{ uri: card.imageUrl }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={[styles.image, styles.imagePlaceholder]} />
        )}

        {/* Like button */}
        <TouchableOpacity
          style={styles.likeButton}
          onPress={handleLikePress}
          onLongPress={onHeartLongPress ? handleHeartLongPress : undefined}
          delayLongPress={600}
          activeOpacity={0.8}
        >
          <Animated.Text style={[styles.heartIcon, { transform: [{ scale: heartScale }] }]}>
            {isLiked ? '♥' : '♡'}
          </Animated.Text>
        </TouchableOpacity>
      </View>

      {/* Text section */}
      <ScrollView style={styles.textSection} contentContainerStyle={styles.textContent} showsVerticalScrollIndicator={false}>

        {/* Title shown as bold subtitle heading */}
        <Text style={styles.title}>{card.title}</Text>

        {/* First two paragraphs */}
        {card.excerpt ? (
          <Text style={styles.body}>{card.excerpt}</Text>
        ) : null}

        {/* "What would you do?" questions */}
        {questions.length > 0 && (
          <View style={styles.questionsSection}>
            <Text style={styles.questionsLabel}>{t(language, 'card_keywords')}</Text>
            {questions.map((q, i) => (
              <View key={i} style={styles.questionRow}>
                <View style={styles.questionNumber}>
                  <Text style={styles.questionNumberText}>{i + 1}</Text>
                </View>
                <Text style={styles.questionText}>{q}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Related Moves button */}
        {onRelated && (
          <TouchableOpacity style={styles.relatedBtn} onPress={() => {
            trackEvent('card_related', { cardId: card.id, cardTitle: card.title });
            onRelated();
          }} activeOpacity={0.75}>
            <HubIcon size={22} color="#111111" />
            <Text style={styles.relatedBtnText}>{t(language, 'card_related')}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  imageContainer: {
    position: 'relative',
    width: '100%',
    height: IMAGE_HEIGHT,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    backgroundColor: '#E0E0E0',
  },
  likeButton: {
    position: 'absolute',
    top: 12,
    right: 16,
    padding: 8,
  },
  heartIcon: {
    fontSize: 28,
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  textSection: {
    flex: 1,
  },
  textContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111111',
    marginBottom: 12,
    lineHeight: 24,
    letterSpacing: -0.3,
  },
  body: {
    fontSize: 15,
    color: '#333333',
    lineHeight: 23,
    marginBottom: 20,
  },
  questionsSection: {
    marginTop: 4,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E8E8E8',
  },
  questionsLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FE0437',
    letterSpacing: 1,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  questionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
    gap: 10,
  },
  questionNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FE0437',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  questionNumberText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  questionText: {
    flex: 1,
    fontSize: 14,
    color: '#222222',
    lineHeight: 21,
  },
  relatedBtn: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'flex-start',
  },
  relatedBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111111',
    letterSpacing: 0.8,
  },
});
