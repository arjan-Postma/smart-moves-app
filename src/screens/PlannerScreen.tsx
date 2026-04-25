import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  StyleSheet,
  TextInput,
  Modal,
  Platform,
  ScrollView,
} from 'react-native';
import { TrendCard } from '../lib/wixApi';
import { getPlannerData, savePlannerData, PlannerData, PlannedPost, PostState } from '../lib/plannerStorage';

type SortMode = 'recency' | 'alpha' | 'state' | 'category';

interface CategoryItem {
  id: string;
  label: string;
}

interface Props {
  cards: TrendCard[];
  categories: CategoryItem[];
}

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const WEEKDAY_LABELS = ['M','T','W','T','F','S','S'];

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayISO(): string {
  return toISODate(new Date());
}

function formatDateLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function PlannerScreen({ cards, categories }: Props) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(todayISO());
  const [plannerData, setPlannerData] = useState<PlannerData>({});
  const [sortMode, setSortMode] = useState<SortMode>('recency');
  const [searchQuery, setSearchQuery] = useState('');
  const [editCard, setEditCard] = useState<TrendCard | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editPublished, setEditPublished] = useState(false);
  const today_iso = todayISO();

  useEffect(() => {
    getPlannerData().then(setPlannerData);
  }, []);

  async function updatePlanner(next: PlannerData) {
    setPlannerData(next);
    await savePlannerData(next);
  }

  function toggleSchedule(cardId: string) {
    if (!selectedDate) return;
    const current = plannerData[cardId];
    const alreadyHere = current?.scheduledDate === selectedDate && current?.state === 'scheduled';
    const next = { ...plannerData };
    if (alreadyHere) {
      next[cardId] = { cardId, scheduledDate: null, state: 'unscheduled' };
    } else {
      next[cardId] = { cardId, scheduledDate: selectedDate, state: 'scheduled' };
    }
    updatePlanner(next);
  }

  function openEdit(card: TrendCard) {
    const post = plannerData[card.id];
    setEditCard(card);
    setEditDate(post?.scheduledDate || '');
    setEditPublished(post?.state === 'published');
  }

  function saveEdit() {
    if (!editCard) return;
    const isoDate = editDate.trim() || null;
    let state: PostState = 'unscheduled';
    if (isoDate && editPublished) state = 'published';
    else if (isoDate) state = 'scheduled';
    const next = { ...plannerData };
    next[editCard.id] = { cardId: editCard.id, scheduledDate: isoDate, state };
    updatePlanner(next);
    setEditCard(null);
  }

  // Calendar grid
  const firstDay = new Date(viewYear, viewMonth, 1);
  let startOffset = firstDay.getDay() - 1;
  if (startOffset < 0) startOffset = 6;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const scheduledDates = new Set(
    Object.values(plannerData)
      .filter(p => p.scheduledDate && (p.state === 'scheduled' || p.state === 'published'))
      .map(p => p.scheduledDate!)
  );

  function renderCalendarRows() {
    const cells: React.ReactNode[] = [];
    for (let i = 0; i < startOffset; i++) {
      cells.push(<View key={`e${i}`} style={cal.dayCell} />);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isToday = iso === today_iso;
      const isSelected = iso === selectedDate;
      const hasPosts = scheduledDates.has(iso);
      cells.push(
        <TouchableOpacity
          key={iso}
          style={[cal.dayCell, isSelected && cal.dayCellSelected, isToday && !isSelected && cal.dayCellToday]}
          onPress={() => setSelectedDate(iso === selectedDate ? null : iso)}
          hitSlop={{ top: 2, bottom: 2, left: 2, right: 2 }}
        >
          <Text style={[cal.dayText, isSelected && cal.dayTextSelected, isToday && !isSelected && cal.dayTextToday]}>
            {d}
          </Text>
          {hasPosts && <View style={[cal.dot, isSelected && cal.dotOnSelected]} />}
        </TouchableOpacity>
      );
    }

    const rows: React.ReactNode[] = [];
    for (let i = 0; i < cells.length; i += 7) {
      const chunk = cells.slice(i, i + 7);
      const padCount = 7 - chunk.length;
      rows.push(
        <View key={`row${i}`} style={cal.weekRow}>
          {chunk}
          {padCount > 0 && Array.from({ length: padCount }).map((_, j) => (
            <View key={`pad${j}`} style={cal.dayCell} />
          ))}
        </View>
      );
    }
    return rows;
  }

  // List data
  function getPost(cardId: string): PlannedPost | undefined {
    return plannerData[cardId];
  }
  function getState(cardId: string): PostState {
    return plannerData[cardId]?.state || 'unscheduled';
  }

  let displayCards = [...cards];
  if (searchQuery.length > 1) {
    const q = searchQuery.toLowerCase();
    displayCards = displayCards.filter(c =>
      c.title.toLowerCase().includes(q) || c.subtitle.toLowerCase().includes(q)
    );
  }
  if (sortMode === 'alpha') {
    displayCards.sort((a, b) => a.title.localeCompare(b.title));
  } else if (sortMode === 'recency') {
    displayCards.sort((a, b) => new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime());
  } else if (sortMode === 'state') {
    const order: Record<PostState, number> = { scheduled: 0, published: 1, unscheduled: 2 };
    displayCards.sort((a, b) => order[getState(a.id)] - order[getState(b.id)]);
  } else if (sortMode === 'category') {
    displayCards.sort((a, b) => (a.categoryIds[0] || '').localeCompare(b.categoryIds[0] || ''));
  }

  const STATE_COLORS: Record<PostState, string> = {
    scheduled: '#FE0437',
    published: '#22AA66',
    unscheduled: '#CCC',
  };

  function renderCard({ item }: { item: TrendCard }) {
    const post = getPost(item.id);
    const state = post?.state || 'unscheduled';
    const schedDate = post?.scheduledDate;
    const isChecked = selectedDate !== null && schedDate === selectedDate && state === 'scheduled';

    let stateLabel = 'Not scheduled';
    if (state === 'published' && schedDate) stateLabel = `Published ${formatDateLabel(schedDate)}`;
    else if (state === 'published') stateLabel = 'Published';
    else if (state === 'scheduled' && schedDate) stateLabel = formatDateLabel(schedDate);

    return (
      <View style={listS.row}>
        <TouchableOpacity
          style={listS.checkWrap}
          onPress={() => toggleSchedule(item.id)}
          disabled={!selectedDate}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[listS.check, !selectedDate && listS.checkDisabled]}>
            {isChecked ? '☑' : '☐'}
          </Text>
        </TouchableOpacity>

        <View style={listS.photoCol}>
          {item.imageUrl
            ? <Image source={{ uri: item.imageUrl }} style={listS.thumb} resizeMode="cover" />
            : <View style={[listS.thumb, listS.thumbEmpty]} />
          }
          <View style={listS.stateRow}>
            <View style={[listS.stateDot, { backgroundColor: STATE_COLORS[state] }]} />
            <Text style={listS.stateLabel} numberOfLines={2}>{stateLabel}</Text>
          </View>
        </View>

        <View style={listS.textCol}>
          <Text style={listS.title} numberOfLines={1}>{item.title}</Text>
          <Text style={listS.subtitle} numberOfLines={2}>{item.subtitle}</Text>
        </View>

        <TouchableOpacity style={listS.editBtn} onPress={() => openEdit(item)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Text style={listS.editBtnText}>✎</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const SORTS: { mode: SortMode; label: string }[] = [
    { mode: 'recency', label: 'Recent' },
    { mode: 'alpha', label: 'A–Z' },
    { mode: 'state', label: 'State' },
    { mode: 'category', label: 'Category' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: '#FFF' }}>

      {/* ── Calendar ── */}
      <View style={cal.container}>
        <View style={cal.header}>
          <TouchableOpacity onPress={prevMonth} style={cal.navBtn} hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}>
            <Text style={cal.navArrow}>‹</Text>
          </TouchableOpacity>
          <Text style={cal.monthTitle}>{MONTH_NAMES[viewMonth]} {viewYear}</Text>
          <TouchableOpacity onPress={nextMonth} style={cal.navBtn} hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}>
            <Text style={cal.navArrow}>›</Text>
          </TouchableOpacity>
        </View>

        <View style={cal.weekRow}>
          {WEEKDAY_LABELS.map((d, i) => (
            <View key={i} style={cal.dayCell}>
              <Text style={cal.weekdayText}>{d}</Text>
            </View>
          ))}
        </View>

        {renderCalendarRows()}
      </View>

      {/* ── Sort + Search bar ── */}
      <View style={toolbar.container}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={toolbar.sortScroll}
          contentContainerStyle={toolbar.sortRow}
        >
          {SORTS.map(({ mode, label }) => (
            <TouchableOpacity
              key={mode}
              style={[toolbar.sortBtn, sortMode === mode && toolbar.sortBtnActive]}
              onPress={() => setSortMode(mode)}
            >
              <Text style={[toolbar.sortText, sortMode === mode && toolbar.sortTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <View style={toolbar.searchBox}>
          {Platform.OS === 'web'
            ? (React.createElement as any)('input', {
                style: { flex: '1', height: '100%', background: 'transparent', border: 'none', outline: 'none', fontSize: 13, color: '#111', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
                placeholder: 'Search…',
                value: searchQuery,
                onChange: (e: any) => setSearchQuery(e.target.value),
                type: 'text',
              })
            : <TextInput
                style={toolbar.searchInput}
                placeholder="Search…"
                placeholderTextColor="#AAA"
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
              />
          }
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Text style={{ color: '#AAA', fontSize: 16, paddingRight: 4 }}>×</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Selected date banner */}
      {selectedDate && (
        <View style={listS.dateBanner}>
          <Text style={listS.dateBannerText}>
            {selectedDate === today_iso ? 'Today · ' : ''}{formatDateLabel(selectedDate)}
          </Text>
          <TouchableOpacity onPress={() => setSelectedDate(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={listS.dateBannerClear}>×</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Trend list ── */}
      <FlatList
        data={displayCards}
        keyExtractor={item => item.id}
        renderItem={renderCard}
        ListEmptyComponent={
          <View style={{ padding: 40, alignItems: 'center' }}>
            <Text style={{ color: '#999', fontSize: 14 }}>No trends found</Text>
          </View>
        }
      />

      {/* ── Edit modal ── */}
      <Modal
        visible={!!editCard}
        transparent
        animationType="slide"
        onRequestClose={() => setEditCard(null)}
      >
        <TouchableOpacity style={editModal.overlay} activeOpacity={1} onPress={() => setEditCard(null)}>
          <TouchableOpacity style={editModal.sheet} activeOpacity={1}>
            <View style={editModal.handle} />
            <Text style={editModal.cardTitle} numberOfLines={2}>{editCard?.title}</Text>

            <Text style={editModal.fieldLabel}>Scheduled date</Text>
            {Platform.OS === 'web'
              ? (React.createElement as any)('input', {
                  type: 'date',
                  style: {
                    height: 44,
                    border: '1.5px solid #111',
                    borderRadius: 6,
                    paddingLeft: 12,
                    paddingRight: 12,
                    fontSize: 16,
                    color: '#111',
                    background: '#FFF',
                    outline: 'none',
                    width: '100%',
                    boxSizing: 'border-box',
                    marginBottom: 16,
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                  },
                  value: editDate,
                  onChange: (e: any) => setEditDate(e.target.value),
                })
              : <TextInput
                  style={editModal.dateInput}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#AAA"
                  value={editDate}
                  onChangeText={setEditDate}
                  keyboardType="numbers-and-punctuation"
                />
            }

            <TouchableOpacity
              style={editModal.publishedRow}
              onPress={() => setEditPublished(p => !p)}
              activeOpacity={0.7}
            >
              <Text style={editModal.publishedCheck}>{editPublished ? '☑' : '☐'}</Text>
              <Text style={editModal.publishedLabel}>Mark as published</Text>
            </TouchableOpacity>

            <View style={editModal.buttonRow}>
              <TouchableOpacity
                style={editModal.cancelBtn}
                onPress={() => setEditCard(null)}
              >
                <Text style={editModal.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={editModal.saveBtn} onPress={saveEdit}>
                <Text style={editModal.saveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const cal = StyleSheet.create({
  container: {
    backgroundColor: '#FFF',
    paddingHorizontal: 6,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8E8E8',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  navBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navArrow: {
    fontSize: 26,
    color: '#111',
    lineHeight: 30,
  },
  monthTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111',
    letterSpacing: 0.3,
  },
  weekRow: {
    flexDirection: 'row',
  },
  weekdayText: {
    fontSize: 11,
    color: '#AAA',
    fontWeight: '600',
    textAlign: 'center',
  },
  dayCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    minHeight: 34,
  },
  dayCellSelected: {
    backgroundColor: '#FE0437',
    borderRadius: 17,
    marginHorizontal: 1,
    flex: 1,
  },
  dayCellToday: {
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: '#FE0437',
    marginHorizontal: 1,
    flex: 1,
  },
  dayText: {
    fontSize: 13,
    color: '#111',
    textAlign: 'center',
  },
  dayTextSelected: {
    color: '#FFF',
    fontWeight: '700',
  },
  dayTextToday: {
    color: '#FE0437',
    fontWeight: '700',
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#FE0437',
    marginTop: 1,
  },
  dotOnSelected: {
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
});

const toolbar = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8E8E8',
    gap: 8,
  },
  sortScroll: {
    flexShrink: 1,
  },
  sortRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  sortBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: '#F4F4F4',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  sortBtnActive: {
    backgroundColor: '#FFF',
    borderColor: '#111',
  },
  sortText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#888',
    letterSpacing: 0.2,
  },
  sortTextActive: {
    color: '#111',
  },
  searchBox: {
    flex: 1,
    height: 32,
    backgroundColor: '#F4F4F4',
    borderRadius: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 80,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#111',
    height: 32,
  },
});

const listS = StyleSheet.create({
  dateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 7,
    backgroundColor: '#FFF5F7',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0D0D6',
  },
  dateBannerText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FE0437',
  },
  dateBannerClear: {
    fontSize: 20,
    color: '#FE0437',
    lineHeight: 22,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8E8E8',
    backgroundColor: '#FFF',
  },
  checkWrap: {
    width: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    fontSize: 20,
    color: '#FE0437',
    lineHeight: 22,
  },
  checkDisabled: {
    color: '#CCC',
  },
  photoCol: {
    alignItems: 'center',
    marginRight: 10,
    width: 64,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 6,
  },
  thumbEmpty: {
    backgroundColor: '#E8E8E8',
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
    width: 64,
  },
  stateDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 3,
    flexShrink: 0,
  },
  stateLabel: {
    fontSize: 9,
    color: '#888',
    flex: 1,
    lineHeight: 12,
  },
  textCol: {
    flex: 1,
    paddingRight: 8,
  },
  title: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 3,
  },
  subtitle: {
    fontSize: 12,
    color: '#555',
    lineHeight: 17,
  },
  editBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: '#F4F4F4',
  },
  editBtnText: {
    fontSize: 15,
    color: '#555',
  },
});

const editModal = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 36,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#DDD',
    alignSelf: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111',
    marginBottom: 20,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  dateInput: {
    height: 44,
    borderWidth: 1.5,
    borderColor: '#111',
    borderRadius: 6,
    paddingHorizontal: 12,
    fontSize: 16,
    color: '#111',
    marginBottom: 16,
  },
  publishedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 20,
  },
  publishedCheck: {
    fontSize: 20,
    color: '#22AA66',
    lineHeight: 22,
    marginRight: 10,
  },
  publishedLabel: {
    fontSize: 14,
    color: '#333',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DDD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    fontSize: 14,
    color: '#555',
  },
  saveBtn: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: {
    fontSize: 14,
    color: '#FFF',
    fontWeight: '700',
  },
});
