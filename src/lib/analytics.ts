/**
 * Lightweight analytics client.
 *
 * Events are POSTed fire-and-forget to /api/track on the same server.
 * On native, set EXPO_PUBLIC_APP_URL to the Railway URL (e.g. https://my-app.up.railway.app).
 * On web the request goes to the current origin automatically.
 *
 * Each device gets a random persistent ID stored in AsyncStorage (no PII).
 * A new session ID is generated every time the app launches.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const DEVICE_KEY = 'trend_device_id';
let _deviceId: string | null = null;
const _sessionId: string =
  Date.now().toString(36) + Math.random().toString(36).slice(2);

async function getDeviceId(): Promise<string> {
  if (_deviceId) return _deviceId;
  try {
    let id = await AsyncStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = Date.now().toString(36) + Math.random().toString(36).slice(2);
      await AsyncStorage.setItem(DEVICE_KEY, id);
    }
    _deviceId = id;
    return id;
  } catch {
    return 'anon';
  }
}

export interface TrackData {
  cardId?: string;
  cardTitle?: string;
  cardCategory?: string;
  collectionId?: string;
  query?: string;
}

export async function trackEvent(
  eventName: string,
  data?: TrackData,
): Promise<void> {
  try {
    const deviceId = await getDeviceId();

    // On web the server is the same origin so we can use a relative URL.
    // On native, EXPO_PUBLIC_APP_URL must be set to the Railway deployment URL.
    const base =
      Platform.OS === 'web'
        ? ''
        : ((process.env as any).EXPO_PUBLIC_APP_URL ?? '');
    if (Platform.OS !== 'web' && !base) return; // native without URL configured

    fetch(`${base}/api/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: _sessionId,
        deviceId,
        eventName,
        platform: Platform.OS,
        ...(data ?? {}),
      }),
    }).catch(() => {}); // fire-and-forget; never block the UI
  } catch {
    // analytics must never crash the app
  }
}
