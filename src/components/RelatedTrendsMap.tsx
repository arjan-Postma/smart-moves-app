import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { TrendCard } from '../lib/wixApi';
import { SimilarityIndex, findRelated } from '../lib/similarity';
import { assignPositions, PositionedCard } from '../lib/semanticPosition';

// ── SVG layout constants ───────────────────────────────────────────────────
const SVG_W = 340;
const SVG_H = 360;
const CX = SVG_W / 2;        // 170
const CY = SVG_H / 2 - 10;   // slightly above center
const ORBIT_R = 120;
const CENTER_R = 46;
const NODE_R = 37;

// 6 slots clockwise from top — index matches semanticPosition SLOT_TARGETS
const ANGLES = [0, 60, 120, 180, 240, 300].map(
  (deg) => (deg - 90) * (Math.PI / 180)
);

// ── Helpers ────────────────────────────────────────────────────────────────

function nodePos(angle: number) {
  return {
    x: Math.round(CX + ORBIT_R * Math.cos(angle)),
    y: Math.round(CY + ORBIT_R * Math.sin(angle)),
  };
}

function scoreToOpacity(score: number, maxScore: number) {
  const t = maxScore > 0 ? Math.min(score / maxScore, 1) : 0;
  return (0.35 + 0.65 * t).toFixed(2);
}

/** Split a title into up to two lines that fit inside a node circle */
function splitTitle(title: string, maxChars: number): [string, string] {
  if (title.length <= maxChars) return [title, ''];
  const words = title.split(' ');
  let line1 = '';
  for (const w of words) {
    const candidate = line1 ? `${line1} ${w}` : w;
    if (candidate.length > maxChars) break;
    line1 = candidate;
  }
  if (!line1) line1 = title.slice(0, maxChars - 1) + '…';
  const rest = title.slice(line1.length).trim();
  const line2 = rest.length > maxChars ? rest.slice(0, maxChars - 1) + '…' : rest;
  return [line1, line2];
}

// ── Web SVG renderer ───────────────────────────────────────────────────────

function h(tag: string, attrs: Record<string, any>, ...children: any[]) {
  return React.createElement(tag, attrs, ...children);
}

interface NodeDatum {
  card: TrendCard;
  score: number;
  x: number;
  y: number;
  r: number;
  opacity: string;
  line1: string;
  line2: string;
  angle: number;
}

function buildNodes(positioned: PositionedCard[], maxScore: number): NodeDatum[] {
  return positioned.map((p) => {
    const angle = ANGLES[p.slotIndex];
    const { x, y } = nodePos(angle);
    const opacity = scoreToOpacity(p.score, maxScore);
    const [line1, line2] = splitTitle(p.card.title.toUpperCase(), 11);
    return { card: p.card, score: p.score, x, y, r: NODE_R, opacity, line1, line2, angle };
  });
}

function renderSVG(
  centerCard: TrendCard,
  nodes: NodeDatum[],
  onNodeClick: (card: TrendCard) => void
) {
  const [cLine1, cLine2] = splitTitle(centerCard.title.toUpperCase(), 14);
  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

  // Shorten the spoke so it ends before the text label, not at the node center
  function spokeEnd(n: NodeDatum, shorten: number) {
    const dx = n.x - CX, dy = n.y - CY;
    const len = Math.sqrt(dx * dx + dy * dy);
    const t = Math.max(0, (len - shorten) / len);
    return { x: CX + dx * t, y: CY + dy * t };
  }
  // Start point — stop just outside the center text area
  const CENTER_STOP = 28;

  return h('svg', {
    width: SVG_W,
    height: SVG_H,
    viewBox: `0 0 ${SVG_W} ${SVG_H}`,
    style: { display: 'block', overflow: 'visible' },
  },
    // White background
    h('rect', { width: SVG_W, height: SVG_H, fill: '#FFFFFF' }),

    // Spokes — plain thin dark lines, shortened before text
    ...nodes.map((n, i) => {
      const start = spokeEnd({ ...n, x: CX + (n.x - CX) * (CENTER_STOP / ORBIT_R), y: CY + (n.y - CY) * (CENTER_STOP / ORBIT_R) } as NodeDatum, 0);
      const end   = spokeEnd(n, 32);
      return h('line', {
        key: `line-${i}`,
        x1: CX + (n.x - CX) * (CENTER_STOP / ORBIT_R),
        y1: CY + (n.y - CY) * (CENTER_STOP / ORBIT_R),
        x2: end.x, y2: end.y,
        stroke: '#CCCCCC',
        strokeWidth: 1,
      });
    }),

    // Related nodes — text only, no circles
    ...nodes.map((n, i) =>
      h('g', {
        key: `node-${i}`,
        onClick: (e: any) => { e.stopPropagation(); onNodeClick(n.card); },
        onTouchEnd: (e: any) => { e.stopPropagation(); e.preventDefault(); onNodeClick(n.card); },
        style: { cursor: 'pointer', WebkitTapHighlightColor: 'transparent' },
      },
        // Invisible tap target — use fillOpacity so the rect still catches pointer events
        h('rect', {
          x: n.x - 44, y: n.y - 24,
          width: 88, height: 48,
          fill: '#000000',
          fillOpacity: 0,
        }),
        h('text', {
          x: n.x,
          y: n.y + (n.line2 ? -7 : 1),
          textAnchor: 'middle',
          dominantBaseline: 'middle',
          fill: '#111111',
          fontSize: 10,
          fontWeight: 700,
          fontFamily: FONT,
          pointerEvents: 'none',
        }, n.line1),
        n.line2 ? h('text', {
          x: n.x, y: n.y + 10,
          textAnchor: 'middle',
          dominantBaseline: 'middle',
          fill: '#111111',
          fontSize: 10,
          fontWeight: 700,
          fontFamily: FONT,
          pointerEvents: 'none',
        }, n.line2) : null,
      )
    ),

    // Center card — red bold text, no circle
    h('g', { key: 'center' },
      h('text', {
        x: CX,
        y: CY + (cLine2 ? -8 : 0),
        textAnchor: 'middle',
        dominantBaseline: 'middle',
        fill: '#FE0437',
        fontSize: 12,
        fontWeight: 700,
        fontFamily: FONT,
        pointerEvents: 'none',
      }, cLine1),
      cLine2 ? h('text', {
        x: CX, y: CY + 10,
        textAnchor: 'middle',
        dominantBaseline: 'middle',
        fill: '#FE0437',
        fontSize: 12,
        fontWeight: 700,
        fontFamily: FONT,
        pointerEvents: 'none',
      }, cLine2) : null,
    ),
  );
}

// ── Native fallback: horizontal scroll list ────────────────────────────────

function NativeRelatedList({
  related,
  onNodePress,
}: {
  related: Array<{ card: TrendCard; score: number }>;
  onNodePress: (card: TrendCard) => void;
}) {
  if (related.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No related trends found</Text>
      </View>
    );
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }}
    >
      {related.map(({ card, score }) => (
        <TouchableOpacity
          key={card.id}
          onPress={() => onNodePress(card)}
          style={styles.nativeNode}
          activeOpacity={0.7}
        >
          <Text style={styles.nativeNodeTitle} numberOfLines={2}>{card.title.toUpperCase()}</Text>
          <Text style={styles.nativeNodeScore}>{Math.round(score * 100)}% match</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface Props {
  sourceCard: TrendCard;
  allCards: TrendCard[];
  similarityIndex: SimilarityIndex | null;
  indexReady: boolean;
  onSelectCard: (card: TrendCard) => void;
  onClose: () => void;
}

export default function RelatedTrendsMap({
  sourceCard,
  allCards,
  similarityIndex,
  indexReady,
  onSelectCard,
  onClose,
}: Props) {
  const [centerCard, setCenterCard] = useState<TrendCard>(sourceCard);
  const [history, setHistory] = useState<TrendCard[]>([]);

  // Fetch more candidates so semantic assignment has enough to choose from.
  // Only include cards with a meaningful cosine similarity (≥ 0.08) so
  // far-fetched links are simply omitted — leaving that spoke slot empty.
  const related = (indexReady && similarityIndex
    ? findRelated(centerCard.id, allCards, similarityIndex, 12)
    : []
  ).filter((r) => r.card.title === r.card.title.toUpperCase() && r.score >= 0.08);

  const positioned = assignPositions(related);
  const maxScore = related.length > 0 ? related[0].score : 1;
  const nodes = buildNodes(positioned, maxScore);

  const exploreTo = useCallback((card: TrendCard) => {
    setHistory((prev) => [...prev, centerCard]);
    setCenterCard(card);
  }, [centerCard]);

  function handleSelect() {
    onSelectCard(centerCard);
    onClose();
  }

  return (
    <View style={styles.overlay}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />

      <View style={styles.modal}>
        {/* Header — title left, X always on right */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>RELATED TRENDS</Text>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Visualization */}
        <View style={styles.vizWrapper}>
          {!indexReady ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color="#FE0437" />
              <Text style={styles.loadingText}>Building trend map…</Text>
            </View>
          ) : Platform.OS === 'web' ? (
            <View style={{ alignItems: 'center' }}>
              {renderSVG(centerCard, nodes, exploreTo)}
            </View>
          ) : (
            <NativeRelatedList related={positioned.map(p => ({ card: p.card, score: p.score }))} onNodePress={exploreTo} />
          )}
        </View>

        {/* Hint + open button */}
        <View style={styles.footer}>
          <Text style={styles.hint}>Tap a node to explore</Text>
          <TouchableOpacity style={styles.openBtn} onPress={handleSelect} activeOpacity={0.8}>
            <Text style={styles.openBtnText}>OPEN THIS TREND</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'flex-end',
    zIndex: 200,
  },
  backdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  modal: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingBottom: 28,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 4,
  },
  headerTitle: {
    color: '#111111',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  closeBtn: {
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  closeBtnText: {
    color: '#111111',
    fontSize: 18,
    fontWeight: '400',
    lineHeight: 22,
  },
  vizWrapper: {
    minHeight: 180,
  },
  loadingContainer: {
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    color: '#999',
    fontSize: 13,
  },
  footer: {
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 4,
    paddingHorizontal: 20,
    gap: 10,
  },
  hint: {
    color: '#999999',
    fontSize: 11,
    fontWeight: '400',
    textAlign: 'center',
  },
  openBtn: {
    backgroundColor: '#111111',
    borderRadius: 24,
    height: 48,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  openBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
  },
  // Native list
  emptyContainer: {
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#999',
    fontSize: 13,
  },
  nativeNode: {
    backgroundColor: '#F7F7F7',
    borderRadius: 12,
    padding: 14,
    marginRight: 10,
    width: 160,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    justifyContent: 'space-between',
  },
  nativeNodeTitle: {
    color: '#111111',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
    marginBottom: 8,
  },
  nativeNodeScore: {
    color: '#FE0437',
    fontSize: 11,
    fontWeight: '600',
  },
});
