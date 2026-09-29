// src/input/haptics.ts
// Native iOS build: real Taptic Engine feedback via Capacitor Haptics. Web:
// navigator.vibrate (Android only; iOS Safari has no vibration API).
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

export type Feel = "success" | "error" | "warning" | "tick";

export const NATIVE = Capacitor.isNativePlatform();

export function feel(kind: Feel): void {
  try {
    if (NATIVE) {
      if (kind === "tick") void Haptics.impact({ style: ImpactStyle.Light });
      else
        void Haptics.notification({
          type:
            kind === "success"
              ? NotificationType.Success
              : kind === "error"
                ? NotificationType.Error
                : NotificationType.Warning,
        });
    } else {
      navigator.vibrate?.(kind === "success" ? 18 : kind === "tick" ? 6 : [10, 40, 10]);
    }
  } catch {
    /* unsupported */
  }
}
