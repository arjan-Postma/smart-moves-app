import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'trend_last_card_id';

export async function getLastCardId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function saveLastCardId(id: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, id);
  } catch {}
}
