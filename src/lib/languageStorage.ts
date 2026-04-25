import AsyncStorage from '@react-native-async-storage/async-storage';

export type AppLanguage = 'en' | 'nl';

const LANG_KEY = 'app_language';

export async function getLanguage(): Promise<AppLanguage> {
  try {
    const val = await AsyncStorage.getItem(LANG_KEY);
    if (val === 'nl') return 'nl';
    return 'en';
  } catch {
    return 'en';
  }
}

export async function saveLanguage(lang: AppLanguage): Promise<void> {
  try {
    await AsyncStorage.setItem(LANG_KEY, lang);
  } catch {}
}
