import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { TrendCategory } from '../lib/wixApi';
import { useLanguage } from '../contexts/LanguageContext';
import { t, tCategory } from '../lib/i18n';

interface Props {
  categories: TrendCategory[];
  filterCategoryIds: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
}

export default function FilterScreen({ categories, filterCategoryIds, onToggle, onClear }: Props) {
  const { language } = useLanguage();
  const hasFilter = filterCategoryIds.length > 0;

  return (
    <View style={styles.container}>
      {/* Header row: title left, Clear all right */}
      <View style={styles.header}>
        <Text style={styles.title}>{t(language, 'filter_title')}</Text>
        <TouchableOpacity
          style={[styles.clearButton, !hasFilter && styles.clearButtonHidden]}
          onPress={onClear}
          disabled={!hasFilter}
        >
          <Text style={styles.clearButtonText}>{t(language, 'filter_clear_all')}</Text>
        </TouchableOpacity>
      </View>

      {/* Category rows */}
      {categories.map((cat) => {
        const active = filterCategoryIds.includes(cat.id);
        return (
          <TouchableOpacity
            key={cat.id}
            style={styles.categoryRow}
            onPress={() => onToggle(cat.id)}
          >
            <Text style={[styles.checkbox, active && styles.checkboxActive]}>
              {active ? '☑' : '☐'}
            </Text>
            <Text style={styles.categoryLabel}>
              {tCategory(language, cat.label)}
              <Text style={styles.categoryCount}> ({cat.postCount})</Text>
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF',
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111',
  },
  clearButton: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  clearButtonHidden: {
    opacity: 0,
  },
  clearButtonText: {
    color: '#FE0437',
    fontSize: 14,
    fontWeight: '600',
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EEE',
  },
  checkbox: {
    fontSize: 22,
    color: '#CCC',
  },
  checkboxActive: {
    color: '#FE0437',
  },
  categoryLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#222',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginLeft: 14,
  },
  categoryCount: {
    fontSize: 12,
    fontWeight: '400',
    color: '#999',
    textTransform: 'none',
    letterSpacing: 0,
  },
});
