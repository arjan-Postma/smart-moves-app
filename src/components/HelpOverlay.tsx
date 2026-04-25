import React, { useState, useRef, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';

// ── Slide data ─────────────────────────────────────────────────────────────────

interface Slide {
  accent: string;
  Illustration: React.FC;
  title: string;
  bullets: string[];
}

// Mini illustrations built entirely from View + Text primitives

function IllustrationDeck() {
  return (
    <View style={{ alignItems: 'center', gap: 6 }}>
      {/* Card mockup */}
      <View style={{ width: 180, height: 90, backgroundColor: '#111', borderRadius: 10, overflow: 'hidden', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: '#FE0437', paddingHorizontal: 10, paddingVertical: 6 }}>
          <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 13, letterSpacing: 1 }}>BIOMETRICS</Text>
        </View>
      </View>
      {/* Swipe arrows */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 28, marginTop: 4 }}>
        <Text style={{ fontSize: 22, color: '#FE0437' }}>◀</Text>
        <Text style={{ fontSize: 11, color: '#AAA', fontWeight: '600', letterSpacing: 0.5 }}>SWIPE</Text>
        <Text style={{ fontSize: 22, color: '#FE0437' }}>▶</Text>
      </View>
    </View>
  );
}

function IllustrationSearch() {
  return (
    <View style={{ gap: 10, width: 220 }}>
      {/* Search bar */}
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#F4F4F4', borderRadius: 10, paddingHorizontal: 14, height: 38, gap: 8 }}>
        <Text style={{ flex: 1, fontSize: 13, color: '#AAA' }}>Search trend cards…</Text>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#FE0437' }} />
        <View style={{ gap: 3 }}>
          <View style={{ width: 16, height: 2, backgroundColor: '#FE0437', borderRadius: 1 }} />
          <View style={{ width: 11, height: 2, backgroundColor: '#FE0437', borderRadius: 1, alignSelf: 'center' }} />
          <View style={{ width: 6, height: 2, backgroundColor: '#FE0437', borderRadius: 1, alignSelf: 'center' }} />
        </View>
      </View>
      {/* Labels */}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 18, paddingRight: 4 }}>
        <Text style={{ fontSize: 10, color: '#FE0437', fontWeight: '600' }}>Unread</Text>
        <Text style={{ fontSize: 10, color: '#FE0437', fontWeight: '600' }}>Filter</Text>
      </View>
    </View>
  );
}

function IllustrationHeart() {
  return (
    <View style={{ alignItems: 'center', gap: 14 }}>
      <View style={{ flexDirection: 'row', gap: 24, alignItems: 'center' }}>
        <View style={{ alignItems: 'center', gap: 5 }}>
          <Text style={{ fontSize: 36, color: '#FE0437' }}>♥</Text>
          <Text style={{ fontSize: 10, color: '#555', fontWeight: '600' }}>TAP</Text>
        </View>
        <View style={{ width: 1, height: 40, backgroundColor: '#EEE' }} />
        <View style={{ alignItems: 'center', gap: 5 }}>
          <Text style={{ fontSize: 36, color: '#FE0437' }}>♥</Text>
          <Text style={{ fontSize: 10, color: '#555', fontWeight: '600' }}>LONG-PRESS</Text>
        </View>
      </View>
      {/* Collection picker hint */}
      <View style={{ backgroundColor: '#F8F8F8', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, width: 200 }}>
        <Text style={{ fontSize: 11, color: '#999', marginBottom: 8, textAlign: 'center' }}>Add to collection</Text>
        {['Session 2028', 'Strategy meeting'].map(n => (
          <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
            <Text style={{ fontSize: 13, color: '#FE0437' }}>☑</Text>
            <Text style={{ fontSize: 12, color: '#333' }}>{n}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function IllustrationRelated() {
  const cx = 70, cy = 70, r = 52;
  const angles = [0, 60, 120, 180, 240, 300].map(d => (d - 90) * Math.PI / 180);
  const labels = ['AGENTIC AI', 'AI ALIGN.', 'CLOSED LOOP', 'HACKING GR.', 'CIRCULAR…', 'TEAM OF T.'];
  return (
    <View style={{ width: 140, height: 140, position: 'relative' }}>
      {/* Spokes + labels */}
      {angles.slice(0, 5).map((a, i) => {
        const x = cx + r * Math.cos(a);
        const y = cy + r * Math.sin(a);
        return (
          <React.Fragment key={i}>
            <View style={{ position: 'absolute', left: cx - 0.5, top: cy, width: 1, height: r, backgroundColor: '#DDD',
              transform: [{ rotate: `${(i * 60 - 90)}deg` }, { translateY: -r / 2 }] }} />
            <Text style={{ position: 'absolute', left: x - 28, top: y - 8, width: 56, fontSize: 8, fontWeight: '700', color: '#111', textAlign: 'center' }}>{labels[i]}</Text>
          </React.Fragment>
        );
      })}
      {/* Center */}
      <Text style={{ position: 'absolute', left: 0, right: 0, top: cy - 8, textAlign: 'center', fontSize: 9, fontWeight: '800', color: '#FE0437' }}>CLOSED LOOP AI</Text>
    </View>
  );
}

function IllustrationKeyword() {
  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      {/* Keyword chips */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', maxWidth: 220 }}>
        {['BIOMETRICS', 'FACIAL RECOGNITION', 'VOICE AUTH.', 'DIGITAL IDENTITY'].map(k => (
          <View key={k} style={{ backgroundColor: '#FFF0F3', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4 }}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: '#FE0437' }}>{k}</Text>
          </View>
        ))}
      </View>
      {/* Popup */}
      <View style={{ backgroundColor: '#FFF', borderRadius: 12, padding: 14, width: 200, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: '#FE0437' }}>FACIAL RECOGNITION</Text>
          <Text style={{ fontSize: 13, color: '#999' }}>✕</Text>
        </View>
        <Text style={{ fontSize: 12, color: '#444', lineHeight: 17 }}>Technology that identifies people by analyzing facial features.</Text>
      </View>
    </View>
  );
}

function IllustrationList() {
  const rows = [
    { title: 'IN ORBIT REFUELING', sub: 'Gas station in space', unseen: false },
    { title: 'CONVERGENCE', sub: 'Where technologies meet', unseen: true },
    { title: 'WIRELESS ENERGY', sub: 'Power without plugs', unseen: false },
  ];
  return (
    <View style={{ width: 220, gap: 0, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#EEE' }}>
      {rows.map((r, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', padding: 10, gap: 10, borderBottomWidth: i < rows.length - 1 ? 1 : 0, borderBottomColor: '#F0F0F0', backgroundColor: '#FFF' }}>
          <View style={{ width: 36, height: 36, backgroundColor: '#222', borderRadius: 6 }} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 10, fontWeight: '800', color: '#111' }}>{r.title}</Text>
            <Text style={{ fontSize: 10, color: '#888' }}>{r.sub}</Text>
          </View>
          {r.unseen && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#3B82F6' }} />}
        </View>
      ))}
    </View>
  );
}

function IllustrationShare() {
  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      <View style={{ backgroundColor: '#FFF', borderRadius: 14, padding: 16, width: 220, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 3 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: '#111', textAlign: 'center', marginBottom: 4 }}>Share collection</Text>
        <Text style={{ fontSize: 11, color: '#999', textAlign: 'center', marginBottom: 12 }}>Copy this code and share it</Text>
        <View style={{ backgroundColor: '#F4F4F4', borderRadius: 8, padding: 8, marginBottom: 12 }}>
          <Text style={{ fontSize: 10, color: '#555', fontFamily: 'monospace' }} numberOfLines={1}>AgAQU3RyYXRlZ3kgbWVl…</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1, height: 34, backgroundColor: '#111', borderRadius: 17, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '700' }}>Copy code</Text>
          </View>
          <View style={{ flex: 1, height: 34, backgroundColor: '#F4F4F4', borderRadius: 17, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#555', fontSize: 11, fontWeight: '600' }}>Share via…</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function IllustrationProfile() {
  return (
    <View style={{ alignItems: 'center', gap: 12 }}>
      {/* Language toggle */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ fontSize: 13, color: '#555' }}>Language:</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {['EN', 'NL'].map((l, i) => (
            <View key={l} style={{ borderWidth: 1.5, borderColor: '#111', borderRadius: 4, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: i === 0 ? '#111' : '#FFF' }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: i === 0 ? '#FFF' : '#111' }}>{l}</Text>
            </View>
          ))}
        </View>
      </View>
      {/* Landscape hint */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F8F8F8', borderRadius: 10, padding: 12, width: 210 }}>
        <Text style={{ fontSize: 24 }}>📱</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: '#111', marginBottom: 2 }}>Landscape mode</Text>
          <Text style={{ fontSize: 10, color: '#777', lineHeight: 14 }}>Tilt phone sideways for full-screen image view</Text>
        </View>
      </View>
    </View>
  );
}

const SLIDES: Slide[] = [
  {
    accent: '#FE0437',
    Illustration: IllustrationDeck,
    title: 'Swipe through Smart Moves',
    bullets: [
      'Swipe left or right to browse the deck of Smart Moves',
      'Type /R in search for a random move — /R3 gives you three at once',
      'The counter shows your position (e.g. 4 / 60)',
    ],
  },
  {
    accent: '#111111',
    Illustration: IllustrationSearch,
    title: 'Search & filter by category',
    bullets: [
      'Type anything to search by move name or content',
      'The dot toggles unread-only mode — see only moves you haven\'t opened',
      'Three-bar icon opens the category filter: Change, Design, Learn, and more',
    ],
  },
  {
    accent: '#FE0437',
    Illustration: IllustrationHeart,
    title: 'Save & collect moves',
    bullets: [
      'Tap ♡ to save a move to your Liked list',
      'Long-press ♡ to add it directly to a named collection',
      'Access your saved moves anytime in the LIKED tab',
    ],
  },
  {
    accent: '#333',
    Illustration: IllustrationRelated,
    title: 'Explore connected moves',
    bullets: [
      'Tap RELATED MOVES at the bottom of any card',
      'A wheel shows semantically connected moves around the current one',
      'Tap any node to shift focus — tap OPEN THIS TREND to view it',
    ],
  },
  {
    accent: '#FE0437',
    Illustration: IllustrationKeyword,
    title: 'What would you do?',
    bullets: [
      'Each move ends with 3 action questions in red',
      'Use them to spark discussion or personal reflection',
      'Great for workshops, strategy sessions, or team check-ins',
    ],
  },
  {
    accent: '#111111',
    Illustration: IllustrationList,
    title: 'List view',
    bullets: [
      'LIST shows all moves in a scrollable, searchable view',
      'A blue dot next to a move means you haven\'t seen it yet',
      'Tap any row to open the full card and start swiping from there',
    ],
  },
  {
    accent: '#FE0437',
    Illustration: IllustrationShare,
    title: 'Collections & sharing',
    bullets: [
      'In LIKED, create named collections — e.g. "Team workshop"',
      'Tap the share icon to generate a unique code for your collection',
      'Paste the code in WhatsApp, email or a message to share instantly',
    ],
  },
  {
    accent: '#111111',
    Illustration: IllustrationProfile,
    title: 'Profile & language',
    bullets: [
      'Switch between English and Dutch — more languages coming soon',
      'Tilt your phone sideways for a full-screen landscape image view',
      'Log in to save your data and collections when switching devices',
    ],
  },
];

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function HelpOverlay({ visible, onClose }: Props) {
  const [page, setPage] = useState(0);
  const touchStartX = useRef(0);

  // Reset to first slide whenever the overlay is opened
  useEffect(() => {
    if (visible) setPage(0);
  }, [visible]);

  function goNext() { setPage((p) => Math.min(p + 1, SLIDES.length - 1)); }
  function goPrev() { setPage((p) => Math.max(p - 1, 0)); }

  const slide = SLIDES[page];
  const isLast = page === SLIDES.length - 1;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        {/* Backdrop tap to close */}
        <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={onClose} />

        <View
          style={styles.sheet}
          onStartShouldSetResponder={() => true}
          onResponderGrant={(e) => { touchStartX.current = e.nativeEvent.pageX; }}
          onResponderRelease={(e) => {
            const diff = touchStartX.current - e.nativeEvent.pageX;
            if (Math.abs(diff) > 40) { diff > 0 ? goNext() : goPrev(); }
          }}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft} />
            <Text style={styles.headerTitle}>HOW TO USE</Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Illustration */}
          <View style={[styles.illustrationArea, { borderBottomColor: slide.accent }]}>
            <slide.Illustration />
          </View>

          {/* Title */}
          <Text style={styles.title}>{slide.title}</Text>

          {/* Bullets */}
          <View style={styles.bullets}>
            {slide.bullets.map((b, i) => (
              <View key={i} style={styles.bulletRow}>
                <View style={[styles.bulletDot, { backgroundColor: slide.accent }]} />
                <Text style={styles.bulletText}>{b}</Text>
              </View>
            ))}
          </View>

          {/* Dot pagination */}
          <View style={styles.dots}>
            {SLIDES.map((_, i) => (
              <TouchableOpacity key={i} onPress={() => setPage(i)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                <View style={[styles.dot, i === page && styles.dotActive, i === page && { backgroundColor: slide.accent }]} />
              </TouchableOpacity>
            ))}
          </View>

          {/* Navigation */}
          <View style={styles.navRow}>
            <TouchableOpacity
              onPress={goPrev}
              style={[styles.navBtn, page === 0 && styles.navBtnHidden]}
              disabled={page === 0}
            >
              <Text style={styles.navBtnText}>← PREV</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={isLast ? onClose : goNext}
              style={[styles.navBtnPrimary, { backgroundColor: slide.accent }]}
            >
              <Text style={styles.navBtnPrimaryText}>{isLast ? 'DONE' : 'NEXT →'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  headerLeft: {
    width: 28,
  },
  headerTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#111',
    letterSpacing: 1.5,
  },
  closeBtn: {
    width: 28,
    alignItems: 'flex-end',
  },
  closeBtnText: {
    fontSize: 18,
    color: '#111',
    lineHeight: 22,
  },
  illustrationArea: {
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    borderBottomWidth: 2,
    marginHorizontal: 20,
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111',
    paddingHorizontal: 24,
    marginBottom: 14,
    letterSpacing: -0.3,
  },
  bullets: {
    paddingHorizontal: 24,
    gap: 10,
    marginBottom: 20,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 6,
    flexShrink: 0,
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    color: '#444',
    lineHeight: 20,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 20,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#DDD',
  },
  dotActive: {
    width: 20,
    borderRadius: 4,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    gap: 12,
  },
  navBtn: {
    height: 44,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnHidden: {
    opacity: 0,
  },
  navBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
    letterSpacing: 0.5,
  },
  navBtnPrimary: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnPrimaryText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
  },
});
