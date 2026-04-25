import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  StyleSheet,
  Modal,
  TextInput,
  Platform,
  Alert,
  ScrollView,
} from 'react-native';
import { TrendCard } from '../lib/wixApi';
import { useLanguage } from '../contexts/LanguageContext';
import { t } from '../lib/i18n';
import { useCollections } from '../hooks/useCollections';
import { Collection } from '../lib/collectionsStorage';
import { trackEvent } from '../lib/analytics';

// ── Share code encoding / decoding ───────────────────────────────────────────
// V2 binary format — no server required, ~55% smaller than v1 JSON.
//
// Binary layout (then base64):
//   [0]      version = 2
//   [1-2]    name byte length (uint16 big-endian)
//   [3..N]   name bytes (UTF-8 via unescape/encodeURIComponent)
//   [N+1-2]  id count (uint16 big-endian)
//   [N+3..]  16 bytes per UUID (dashes stripped, hex→bytes)
//
// V1 JSON codes are still decoded for backward compatibility.

function uuidToBytes(uuid: string): number[] | null {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const out: number[] = [];
  for (let i = 0; i < 32; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

function bytesToUuid(bytes: number[]): string {
  const h = bytes.map(b => ('0' + b.toString(16)).slice(-2)).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

function encodeCollection(col: Collection): string {
  // Try V2 binary (requires all IDs to be standard UUIDs)
  const idBytes: number[] = [];
  for (const id of col.cardIds) {
    const b = uuidToBytes(id);
    if (!b) { idBytes.length = 0; break; } // not a UUID — fall through to v1
    idBytes.push(...b);
  }
  if (idBytes.length === col.cardIds.length * 16) {
    const nameEncoded = unescape(encodeURIComponent(col.name));
    const nameBytes = Array.from(nameEncoded).map(c => c.charCodeAt(0));
    const n = col.cardIds.length;
    const nl = nameBytes.length;
    const allBytes = [
      2,
      (nl >> 8) & 0xff, nl & 0xff,
      ...nameBytes,
      (n >> 8) & 0xff, n & 0xff,
      ...idBytes,
    ];
    return btoa(String.fromCharCode(...allBytes));
  }
  // Fallback: V1 JSON
  return btoa(unescape(encodeURIComponent(JSON.stringify({ v: 1, n: col.name, ids: col.cardIds }))));
}

function tryDecodeToken(token: string): { name: string; cardIds: string[] } | null {
  try {
    const bin = atob(token);
    const bytes = Array.from(bin).map(c => c.charCodeAt(0));

    // V2 binary
    if (bytes[0] === 2 && bytes.length > 5) {
      let i = 1;
      const nl = (bytes[i] << 8) | bytes[i + 1]; i += 2;
      const name = decodeURIComponent(escape(String.fromCharCode(...bytes.slice(i, i + nl)))); i += nl;
      const n = (bytes[i] << 8) | bytes[i + 1]; i += 2;
      if (bytes.length < i + n * 16) return null;
      const cardIds: string[] = [];
      for (let j = 0; j < n; j++, i += 16) cardIds.push(bytesToUuid(bytes.slice(i, i + 16)));
      return { name, cardIds };
    }

    // V1 JSON (backward compat)
    const data = JSON.parse(decodeURIComponent(escape(bin)));
    if (data.v === 1 && typeof data.n === 'string' && Array.isArray(data.ids)) {
      return { name: data.n, cardIds: data.ids as string[] };
    }
  } catch { /* next token */ }
  return null;
}

function decodeShareCode(raw: string): { name: string; cardIds: string[] } | null {
  // Try each whitespace-separated token so pasting the full invite text works too
  for (const token of raw.trim().split(/\s+/)) {
    const result = tryDecodeToken(token);
    if (result) return result;
  }
  return null;
}

async function copyText(text: string): Promise<void> {
  try {
    await (globalThis as any).navigator?.clipboard?.writeText(text);
  } catch {
    // Fallback: select a temp textarea (web only)
    const el = (globalThis as any).document?.createElement('textarea');
    if (!el) return;
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    (globalThis as any).document.body.appendChild(el);
    el.focus(); el.select();
    (globalThis as any).document.execCommand('copy');
    (globalThis as any).document.body.removeChild(el);
  }
}

interface Props {
  cards: TrendCard[];
  likedIds: Set<string>;
  likedOrder?: string[];
  activeCardId?: string;
  searchQuery?: string;
  onSelectCard: (index: number, context?: TrendCard[]) => void;
}

export default function LikedScreen({
  cards,
  likedIds,
  likedOrder = [],
  activeCardId,
  searchQuery = '',
  onSelectCard,
}: Props) {
  const { language } = useLanguage();
  const { collections, createCollection, deleteCollection, toggleCard, removeCardFromAll, importCollection, renameCollection } = useCollections();

  const [selectedColId, setSelectedColId] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [pickerCardId, setPickerCardId] = useState<string | null>(null);
  const [newColModal, setNewColModal] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [newColFromCardId, setNewColFromCardId] = useState<string | null>(null);

  // Rename
  const [renameModal, setRenameModal] = useState(false);
  const [renameColName, setRenameColName] = useState('');

  // Share
  const [shareModal, setShareModal] = useState(false);
  const [shareCode, setShareCode] = useState('');
  const [copied, setCopied] = useState(false);

  // Import
  const [importModal, setImportModal] = useState(false);
  const [importCode, setImportCode] = useState('');
  const [importError, setImportError] = useState(false);

  // On web (iOS Safari): track keyboard height so the modal sheet slides above it
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const vv = (globalThis as any).window?.visualViewport;
    if (!vv) return;
    const update = () => {
      const gap = (globalThis as any).window.innerHeight - vv.height - vv.offsetTop;
      setKeyboardOffset(Math.max(0, gap));
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); };
  }, []);

  const prevLikedRef = useRef<Set<string>>(new Set());
  // When a card is unliked, remove it from all collections
  useEffect(() => {
    const prev = prevLikedRef.current;
    prev.forEach((id) => {
      if (!likedIds.has(id)) removeCardFromAll(id);
    });
    prevLikedRef.current = new Set(likedIds);
  }, [likedIds]);

  // If selected collection was deleted, reset to "View all"
  useEffect(() => {
    if (selectedColId && !collections.find((c) => c.id === selectedColId)) {
      setSelectedColId(null);
    }
  }, [collections]);

  // Sort liked cards newest-first using the stored like order.
  // Cards not yet in likedOrder (e.g. liked before this update) go to the end.
  const likedCards = cards
    .filter((c) => likedIds.has(c.id))
    .sort((a, b) => {
      const ia = likedOrder.indexOf(a.id);
      const ib = likedOrder.indexOf(b.id);
      const ra = ia === -1 ? Number.MAX_SAFE_INTEGER : ia;
      const rb = ib === -1 ? Number.MAX_SAFE_INTEGER : ib;
      return ra - rb;
    });
  const selectedCol = collections.find((c) => c.id === selectedColId) ?? null;
  const q = searchQuery.trim().toLowerCase();

  const baseCards = selectedCol
    ? likedCards.filter((c) => selectedCol.cardIds.includes(c.id))
    : likedCards;

  const visibleCards = q
    ? baseCards.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.subtitle.toLowerCase().includes(q) ||
          c.keywords.some((k) => k.toLowerCase().includes(q))
      )
    : baseCards;

  function handleCreateCollection() {
    const trimmed = newColName.trim();
    if (!trimmed) return;
    const id = createCollection(trimmed);
    if (newColFromCardId && id) toggleCard(id, newColFromCardId);
    setNewColName('');
    setNewColModal(false);
    setNewColFromCardId(null);
  }

  function handleDeleteCollection() {
    if (!selectedColId) return;
    const col = collections.find((c) => c.id === selectedColId);
    const name = col?.name ?? 'this collection';
    if (Platform.OS === 'web') {
      if (!window.confirm(`${t(language, 'col_delete_confirm')} "${name}"`)) return;
      deleteCollection(selectedColId);
      setSelectedColId(null);
    } else {
      Alert.alert(
        t(language, 'col_delete_confirm'),
        `"${name}"`,
        [
          { text: t(language, 'col_cancel'), style: 'cancel' },
          {
            text: t(language, 'col_done'),
            style: 'destructive',
            onPress: () => { deleteCollection(selectedColId); setSelectedColId(null); },
          },
        ]
      );
    }
  }

  function handleOpenRename() {
    if (!selectedCol) return;
    setRenameColName(selectedCol.name);
    setRenameModal(true);
  }

  function handleRenameCollection() {
    if (!selectedColId || !renameColName.trim()) return;
    renameCollection(selectedColId, renameColName);
    setRenameModal(false);
  }

  function openNewCollectionFromPicker(cardId: string) {
    setPickerCardId(null);
    setNewColFromCardId(cardId);
    setNewColModal(true);
  }

  function handleOpenShare() {
    if (!selectedCol) return;
    setShareCode(encodeCollection(selectedCol));
    setCopied(false);
    setShareModal(true);
    trackEvent('collection_share', { collectionId: selectedCol.id });
  }

  function shareText() {
    const name = selectedCol?.name ?? '';
    return `I would like to invite you to my trend collection "${name}"...\n\n${shareCode}\n\nwww.futuresacademy.org`;
  }

  async function handleCopy() {
    await copyText(shareText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function handleNativeShare() {
    const nav = (globalThis as any).navigator;
    if (nav?.share) {
      await nav.share({ title: selectedCol?.name, text: shareText() });
    } else {
      await handleCopy();
    }
  }

  function handleImport() {
    const result = decodeShareCode(importCode);
    if (!result) { setImportError(true); return; }
    importCollection(result.name, result.cardIds);
    trackEvent('collection_import');
    setImportCode('');
    setImportError(false);
    setImportModal(false);
  }

  // ── Empty states ──────────────────────────────────────────────────────────
  if (likedCards.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyHeart}>♡</Text>
        <Text style={styles.emptyTitle}>{t(language, 'liked_empty_title')}</Text>
        <Text style={styles.emptySubtitle}>{t(language, 'liked_empty_subtitle')}</Text>
      </View>
    );
  }

  // ── Render card row ───────────────────────────────────────────────────────
  function renderItem({ item }: { item: TrendCard }) {
    const originalIndex = cards.indexOf(item);
    const isActive = item.id === activeCardId;
    const inCurrentCol = selectedCol?.cardIds.includes(item.id) ?? false;

    // When inside a collection, pass visibleCards as context so the swipe
    // deck is bounded to just that collection's cards.
    function handlePress() {
      if (selectedCol) {
        onSelectCard(visibleCards.indexOf(item), visibleCards);
      } else {
        onSelectCard(originalIndex);
      }
    }

    return (
      <TouchableOpacity
        style={[styles.row, isActive && styles.rowActive]}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        {item.imageUrl ? (
          <Image source={{ uri: item.imageUrl }} style={styles.thumbnail} resizeMode="cover" />
        ) : (
          <View style={[styles.thumbnail, styles.thumbnailPlaceholder]} />
        )}
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.rowSubtitle} numberOfLines={2}>{item.subtitle || item.excerpt}</Text>
        </View>

        {selectedCol ? (
          // In a collection view: × removes from this collection
          <TouchableOpacity
            style={styles.rowAction}
            onPress={() => toggleCard(selectedCol.id, item.id)}
          >
            <Text style={styles.removeIcon}>✕</Text>
          </TouchableOpacity>
        ) : (
          // In "View all": folder icon opens collection picker
          <TouchableOpacity
            style={styles.rowAction}
            onPress={() => setPickerCardId(item.id)}
          >
            <FolderIcon size={18} color={
              collections.some((c) => c.cardIds.includes(item.id)) ? '#FE0437' : '#CCC'
            } />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  }

  const dropdownLabel = selectedCol ? selectedCol.name : t(language, 'col_view_all');

  return (
    <View style={styles.root}>

      {/* ── Top bar ── */}
      <View style={styles.topBar}>
        {/* Dropdown box — contains trash icon on right when a collection is active */}
        <View style={styles.dropdown}>
          <TouchableOpacity
            style={styles.dropdownTouchable}
            onPress={() => setDropdownOpen((v) => !v)}
            activeOpacity={0.7}
          >
            <Text style={styles.dropdownText} numberOfLines={1}>{dropdownLabel}</Text>
            <Text style={styles.dropdownArrow}>{dropdownOpen ? '▴' : '▾'}</Text>
          </TouchableOpacity>
          {selectedCol && (
            <>
              <TouchableOpacity
                style={styles.dropdownEditBtn}
                onPress={handleOpenRename}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <EditIcon color="#BBB" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.dropdownTrashBtn}
                onPress={handleDeleteCollection}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <SmallTrashIcon color="#BBB" />
              </TouchableOpacity>
            </>
          )}
        </View>

        {selectedCol ? (
          /* Collection selected: only share button */
          <TouchableOpacity
            style={styles.topBarBtn}
            onPress={handleOpenShare}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <ShareIcon />
          </TouchableOpacity>
        ) : (
          /* View all: import + new collection */
          <>
            <TouchableOpacity
              style={styles.topBarBtn}
              onPress={() => { setImportCode(''); setImportError(false); setImportModal(true); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <ImportIcon />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.topBarBtn}
              onPress={() => { setNewColFromCardId(null); setNewColModal(true); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.plusIcon}>＋</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* ── Dropdown overlay ── */}
      {dropdownOpen && (
        <View style={styles.dropdownList}>
          <TouchableOpacity
            style={[styles.dropdownItem, !selectedColId && styles.dropdownItemActive]}
            onPress={() => { setSelectedColId(null); setDropdownOpen(false); }}
          >
            <Text style={[styles.dropdownItemText, !selectedColId && styles.dropdownItemTextActive]}>
              {t(language, 'col_view_all')}
            </Text>
          </TouchableOpacity>
          {collections.map((col) => (
            <TouchableOpacity
              key={col.id}
              style={[styles.dropdownItem, selectedColId === col.id && styles.dropdownItemActive]}
              onPress={() => { setSelectedColId(col.id); setDropdownOpen(false); }}
            >
              <Text style={[styles.dropdownItemText, selectedColId === col.id && styles.dropdownItemTextActive]}>
                {col.name}
              </Text>
              <Text style={styles.dropdownItemCount}>({col.cardIds.length})</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── Card list ── */}
      <FlatList
        data={visibleCards}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={
          <Text style={styles.header}>
            {t(language, 'liked_count', {
              n: visibleCards.length,
              s: visibleCards.length !== 1 ? 's' : '',
              en: visibleCards.length !== 1 ? 'en' : '',
            })}
          </Text>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {selectedCol ? `${selectedCol.name} is empty` : t(language, 'liked_empty_title')}
            </Text>
          </View>
        }
        onScrollBeginDrag={() => setDropdownOpen(false)}
      />

      {/* ── Collection picker modal ── */}
      <Modal visible={!!pickerCardId} transparent animationType="slide" onRequestClose={() => setPickerCardId(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setPickerCardId(null)}>
          <TouchableOpacity style={styles.pickerSheet} activeOpacity={1}>
            <View style={styles.pickerHandle} />
            <Text style={styles.pickerTitle}>{t(language, 'col_add_to')}</Text>

            {collections.length === 0 ? (
              <Text style={styles.pickerEmpty}>No collections yet</Text>
            ) : (
              collections.map((col) => {
                const included = col.cardIds.includes(pickerCardId!);
                return (
                  <TouchableOpacity
                    key={col.id}
                    style={styles.pickerRow}
                    onPress={() => toggleCard(col.id, pickerCardId!)}
                  >
                    <Text style={styles.pickerCheck}>{included ? '☑' : '☐'}</Text>
                    <Text style={styles.pickerColName}>{col.name}</Text>
                  </TouchableOpacity>
                );
              })
            )}

            <TouchableOpacity
              style={styles.pickerNewBtn}
              onPress={() => openNewCollectionFromPicker(pickerCardId!)}
            >
              <Text style={styles.pickerNewText}>{t(language, 'col_new_plus')}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.pickerDoneBtn} onPress={() => setPickerCardId(null)}>
              <Text style={styles.pickerDoneText}>{t(language, 'col_done')}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── New collection modal ── */}
      <Modal visible={newColModal} transparent animationType="slide" onRequestClose={() => setNewColModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setNewColModal(false)}>
          <TouchableOpacity style={[styles.newColBox, keyboardOffset > 0 && { marginBottom: keyboardOffset }]} activeOpacity={1}>
            <Text style={styles.newColTitle}>{t(language, 'col_new')}</Text>
            {Platform.OS === 'web'
              ? (React.createElement as any)('input', {
                  // No autoFocus on web: iOS Safari raises the keyboard before the
                  // sheet animation finishes, covering the modal. User taps to focus.
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
                    marginBottom: 12,
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                  },
                  placeholder: t(language, 'col_name_placeholder'),
                  value: newColName,
                  onChange: (e: any) => setNewColName(e.target.value),
                  onKeyDown: (e: any) => { if (e.key === 'Enter') handleCreateCollection(); },
                  type: 'text',
                })
              : (
                <TextInput
                  style={styles.newColInput}
                  placeholder={t(language, 'col_name_placeholder')}
                  placeholderTextColor="#AAA"
                  value={newColName}
                  onChangeText={setNewColName}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={handleCreateCollection}
                />
              )}
            <View style={styles.newColButtons}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setNewColModal(false); setNewColName(''); }}>
                <Text style={styles.cancelBtnText}>{t(language, 'col_cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.createBtn, !newColName.trim() && styles.createBtnDisabled]}
                onPress={handleCreateCollection}
                disabled={!newColName.trim()}
              >
                <Text style={styles.createBtnText}>{t(language, 'col_create')}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Rename modal ── */}
      <Modal visible={renameModal} transparent animationType="slide" onRequestClose={() => setRenameModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setRenameModal(false)}>
          <TouchableOpacity style={[styles.newColBox, keyboardOffset > 0 && { marginBottom: keyboardOffset }]} activeOpacity={1}>
            <Text style={styles.newColTitle}>{t(language, 'col_rename')}</Text>
            {Platform.OS === 'web'
              ? (React.createElement as any)('input', {
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
                    marginBottom: 12,
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                  },
                  placeholder: t(language, 'col_name_placeholder'),
                  value: renameColName,
                  onChange: (e: any) => setRenameColName(e.target.value),
                  onKeyDown: (e: any) => { if (e.key === 'Enter') handleRenameCollection(); },
                  type: 'text',
                })
              : (
                <TextInput
                  style={styles.newColInput}
                  placeholder={t(language, 'col_name_placeholder')}
                  placeholderTextColor="#AAA"
                  value={renameColName}
                  onChangeText={setRenameColName}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={handleRenameCollection}
                />
              )}
            <View style={styles.newColButtons}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setRenameModal(false); }}>
                <Text style={styles.cancelBtnText}>{t(language, 'col_cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.createBtn, !renameColName.trim() && styles.createBtnDisabled]}
                onPress={handleRenameCollection}
                disabled={!renameColName.trim()}
              >
                <Text style={styles.createBtnText}>{t(language, 'col_rename_save')}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Share modal ── */}
      <Modal visible={shareModal} transparent animationType="slide" onRequestClose={() => setShareModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShareModal(false)}>
          <TouchableOpacity style={[styles.newColBox, keyboardOffset > 0 && { marginBottom: keyboardOffset }]} activeOpacity={1}>
            {/* X close button — top right */}
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setShareModal(false)}>
              <Text style={styles.modalCloseText}>✕</Text>
            </TouchableOpacity>

            <Text style={styles.newColTitle}>{t(language, 'col_share_title')}</Text>
            <Text style={styles.shareSubtitle}>{t(language, 'col_share_subtitle')}</Text>

            {/* Scrollable code box */}
            <ScrollView
              style={styles.codeBox}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              <Text selectable style={styles.codeText}>{shareCode}</Text>
            </ScrollView>

            <View style={styles.newColButtons}>
              <TouchableOpacity style={[styles.createBtn, copied && styles.createBtnCopied]} onPress={handleCopy}>
                <Text style={styles.createBtnText}>
                  {copied ? t(language, 'col_copied') : t(language, 'col_copy_code')}
                </Text>
              </TouchableOpacity>
              {!!(globalThis as any).navigator?.share && (
                <TouchableOpacity style={styles.cancelBtn} onPress={handleNativeShare}>
                  <Text style={styles.cancelBtnText}>{t(language, 'col_native_share')}</Text>
                </TouchableOpacity>
              )}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Import modal ── */}
      <Modal visible={importModal} transparent animationType="slide" onRequestClose={() => setImportModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setImportModal(false)}>
          <TouchableOpacity style={[styles.newColBox, keyboardOffset > 0 && { marginBottom: keyboardOffset }]} activeOpacity={1}>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setImportModal(false)}>
              <Text style={styles.modalCloseText}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.newColTitle}>{t(language, 'col_import_title')}</Text>

            {Platform.OS === 'web'
              ? (React.createElement as any)('textarea', {
                  rows: 4,
                  style: {
                    border: importError ? '1.5px solid #FE0437' : '1.5px solid #111',
                    borderRadius: 6,
                    padding: 10,
                    fontSize: 13,
                    fontFamily: 'monospace',
                    color: '#111',
                    background: '#F9F9F9',
                    outline: 'none',
                    width: '100%',
                    boxSizing: 'border-box',
                    marginBottom: 4,
                    resize: 'none',
                  },
                  placeholder: t(language, 'col_import_placeholder'),
                  value: importCode,
                  onChange: (e: any) => { setImportCode(e.target.value); setImportError(false); },
                })
              : (
                <TextInput
                  style={[styles.newColInput, { height: 80, textAlignVertical: 'top', paddingTop: 10 },
                    importError && { borderColor: '#FE0437' }]}
                  placeholder={t(language, 'col_import_placeholder')}
                  placeholderTextColor="#AAA"
                  value={importCode}
                  onChangeText={(v) => { setImportCode(v); setImportError(false); }}
                  multiline
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              )}
            {importError && (
              <Text style={styles.importError}>{t(language, 'col_import_invalid')}</Text>
            )}

            <View style={[styles.newColButtons, { marginTop: 12 }]}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setImportModal(false)}>
                <Text style={styles.cancelBtnText}>{t(language, 'col_cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.createBtn, !importCode.trim() && styles.createBtnDisabled]}
                onPress={handleImport}
                disabled={!importCode.trim()}
              >
                <Text style={styles.createBtnText}>{t(language, 'col_import_btn')}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

    </View>
  );
}

// ── Small icons ───────────────────────────────────────────────────────────────

function FolderIcon({ size = 18, color = '#CCC' }: { size?: number; color?: string }) {
  const w = size;
  const h = Math.round(size * 0.78);
  const tabW = Math.round(w * 0.42);
  const tabH = Math.round(size * 0.18);
  return (
    <View style={{ width: w, height: h, justifyContent: 'flex-end' }}>
      <View style={{ position: 'absolute', top: 0, left: 0, width: tabW, height: tabH, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: color }} />
      <View style={{ width: w, height: h - tabH + 2, borderRadius: 3, borderTopLeftRadius: 0, backgroundColor: color, position: 'absolute', bottom: 0 }} />
    </View>
  );
}

function EditIcon({ color = '#AAA' }: { color?: string }) {
  return (
    <View style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
      {/* All parts stacked vertically, then rotated as one unit */}
      <View style={{ alignItems: 'center', transform: [{ rotate: '-45deg' }] }}>
        {/* Eraser cap — fully rounded top */}
        <View style={{ width: 6, height: 3, backgroundColor: color, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
        {/* Body */}
        <View style={{ width: 6, height: 8, backgroundColor: color }} />
        {/* Pointed tip — CSS triangle */}
        <View style={{ width: 0, height: 0, borderLeftWidth: 3, borderRightWidth: 3, borderTopWidth: 4, borderStyle: 'solid', borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: color }} />
      </View>
    </View>
  );
}

function SmallTrashIcon({ color = '#CCC' }: { color?: string }) {
  return (
    <View style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'flex-end' }}>
      <View style={{ width: 7, height: 2, backgroundColor: color, marginBottom: 0 }} />
      <View style={{ width: 12, height: 2, backgroundColor: color, marginBottom: 2 }} />
      <View style={{ width: 10, height: 8, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, backgroundColor: color }} />
    </View>
  );
}

// Arrow up — share
function ShareIcon() {
  return (
    <View style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
      {/* shaft */}
      <View style={{ width: 2, height: 9, backgroundColor: '#888', marginTop: 4 }} />
      {/* arrowhead */}
      <View style={{ position: 'absolute', top: 0, width: 8, height: 8,
        borderTopWidth: 2, borderLeftWidth: 2, borderColor: '#888',
        transform: [{ rotate: '45deg' }], marginTop: 1 }} />
    </View>
  );
}

// Arrow down — import
function ImportIcon() {
  return (
    <View style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
      {/* shaft */}
      <View style={{ width: 2, height: 9, backgroundColor: '#888', marginBottom: 4 }} />
      {/* arrowhead */}
      <View style={{ position: 'absolute', bottom: 0, width: 8, height: 8,
        borderBottomWidth: 2, borderRightWidth: 2, borderColor: '#888',
        transform: [{ rotate: '45deg' }], marginBottom: 1 }} />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFF' },

  /* Top bar */
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8E8E8',
    gap: 8,
  },
  dropdown: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    backgroundColor: '#F4F4F4',
    borderRadius: 8,
    overflow: 'hidden',
  },
  dropdownTouchable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 6,
    height: '100%',
  },
  dropdownText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#111',
    letterSpacing: 0.3,
  },
  dropdownArrow: { fontSize: 22, color: '#888', lineHeight: 22 },
  dropdownEditBtn: {
    paddingHorizontal: 10,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: '#E0E0E0',
  },
  dropdownTrashBtn: {
    paddingHorizontal: 10,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F4F4F4',
    borderRadius: 8,
  },
  plusIcon: { fontSize: 20, color: '#555', lineHeight: 22 },

  /* Dropdown list */
  dropdownList: {
    position: 'absolute',
    top: 57,
    left: 16,
    right: 60,
    backgroundColor: '#FFF',
    borderRadius: 10,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    zIndex: 100,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E8E8E8',
    overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  dropdownItemActive: { backgroundColor: '#FFF5F6' },
  dropdownItemText: { flex: 1, fontSize: 14, color: '#333', fontWeight: '500' },
  dropdownItemTextActive: { color: '#FE0437', fontWeight: '700' },
  dropdownItemCount: { fontSize: 12, color: '#AAA', marginLeft: 6 },

  /* Card list header */
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 11,
    fontWeight: '700',
    color: '#999',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8E8E8',
    backgroundColor: '#FAFAFA',
  },

  /* Card row */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8E8E8',
    backgroundColor: '#FFF',
  },
  rowActive: { backgroundColor: '#FFF8F4' },
  thumbnail: { width: 64, height: 64, borderRadius: 6, marginRight: 12 },
  thumbnailPlaceholder: { backgroundColor: '#E0E0E0' },
  rowText: { flex: 1 },
  rowTitle: {
    fontSize: 13, fontWeight: '700', color: '#111',
    marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.3,
  },
  rowSubtitle: { fontSize: 13, color: '#555', lineHeight: 18 },
  rowAction: {
    // Stretch full row height so the entire right-side strip is tappable —
    // no gaps above/below the icon where the parent row handler can steal the press.
    alignSelf: 'stretch',
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeIcon: { fontSize: 16, color: '#CCC', fontWeight: '300' },

  /* Empty */
  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40,
  },
  emptyHeart: { fontSize: 56, color: '#FE0437', marginBottom: 20 },
  emptyTitle: {
    fontSize: 16, fontWeight: '700', color: '#333',
    textAlign: 'center', marginBottom: 10,
  },
  emptySubtitle: {
    fontSize: 14, color: '#999', textAlign: 'center', lineHeight: 21,
  },

  /* Modal overlay */
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },

  /* Collection picker sheet */
  pickerSheet: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 32,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  pickerHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#DDD', alignSelf: 'center', marginBottom: 16,
  },
  pickerTitle: {
    fontSize: 16, fontWeight: '700', color: '#111',
    marginBottom: 16, textAlign: 'center',
  },
  pickerEmpty: { fontSize: 14, color: '#AAA', textAlign: 'center', marginBottom: 16 },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  pickerCheck: { fontSize: 20, color: '#FE0437', marginRight: 12, width: 24 },
  pickerColName: { fontSize: 15, color: '#222' },
  pickerNewBtn: { paddingVertical: 14 },
  pickerNewText: { fontSize: 14, color: '#FE0437', fontWeight: '600' },
  pickerDoneBtn: {
    marginTop: 8, backgroundColor: '#111',
    borderRadius: 24, height: 48,
    alignItems: 'center', justifyContent: 'center',
  },
  pickerDoneText: { color: '#FFF', fontSize: 14, fontWeight: '700', letterSpacing: 1 },

  /* New collection modal */
  newColBox: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 32,
  },
  newColTitle: {
    fontSize: 17, fontWeight: '700', color: '#111',
    marginBottom: 16, textAlign: 'center',
  },
  newColInput: {
    height: 44, borderWidth: 1.5, borderColor: '#111',
    borderRadius: 6, paddingHorizontal: 12,
    fontSize: 16, color: '#111', marginBottom: 12,
  },
  newColButtons: { flexDirection: 'row', gap: 10 },
  cancelBtn: {
    flex: 1, height: 46, borderRadius: 23,
    borderWidth: 1.5, borderColor: '#DDD',
    alignItems: 'center', justifyContent: 'center',
  },
  cancelBtnText: { fontSize: 14, fontWeight: '600', color: '#888' },
  createBtn: {
    flex: 1, height: 46, borderRadius: 23,
    backgroundColor: '#111',
    alignItems: 'center', justifyContent: 'center',
  },
  createBtnDisabled: { backgroundColor: '#CCC' },
  createBtnCopied: { backgroundColor: '#22A86E' },
  createBtnText: { fontSize: 14, fontWeight: '700', color: '#FFF', letterSpacing: 0.5 },

  /* Modal close button (X) — top right corner */
  modalCloseBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 4,
    zIndex: 10,
  },
  modalCloseText: {
    fontSize: 16,
    color: '#CCC',
    fontWeight: '300',
  },

  /* Share modal */
  shareSubtitle: {
    fontSize: 13, color: '#888', textAlign: 'center',
    marginBottom: 16, marginTop: -8,
  },
  codeBox: {
    backgroundColor: '#F4F4F4',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    maxHeight: 72,
  },
  codeText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 11,
    color: '#333',
    letterSpacing: 0.3,
  },

  /* Import modal */
  importError: {
    fontSize: 12, color: '#FE0437',
    marginBottom: 4, marginTop: -2,
  },
});
