import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

// Expo-sensors Accelerometer — only loaded on native (not web)
let Accelerometer: any = null;
try {
  if (Platform.OS !== 'web') {
    Accelerometer = require('expo-sensors').Accelerometer;
  }
} catch (_) {}

const THRESHOLD = 1.8;      // g-force delta to count as a shake
const COOLDOWN_MS = 1200;   // minimum ms between shake events

export function useShake(onShake: () => void) {
  const lastFire = useRef(0);
  const prev = useRef({ x: 0, y: 0, z: 0 });

  useEffect(() => {
    if (Platform.OS === 'web' || !Accelerometer) return;

    Accelerometer.setUpdateInterval(100);

    const sub = Accelerometer.addListener(({ x, y, z }: { x: number; y: number; z: number }) => {
      const dx = x - prev.current.x;
      const dy = y - prev.current.y;
      const dz = z - prev.current.z;
      prev.current = { x, y, z };

      const delta = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const now = Date.now();

      if (delta > THRESHOLD && now - lastFire.current > COOLDOWN_MS) {
        lastFire.current = now;
        onShake();
      }
    });

    return () => sub.remove();
  }, [onShake]);
}
