'use client';

import { useState } from 'react';

export type LocateState = 'idle' | 'locating' | 'shared' | 'refused' | 'unsupported';

export interface SharedPosition {
  latitude: number;
  longitude: number;
}

/**
 * Asks the browser where the person is, and says plainly when it will not.
 *
 * Every location field in the app is typeable by hand, because coordinates are a
 * requirement the interface can meet without a sensor and because permission is a
 * request that can reasonably be refused. This only fills the boxes in; it never
 * decides anything on its own, and each caller renders its own sentence for the
 * outcome so the wording can match what the field is for.
 *
 * A refusal and an absence of geolocation are reported separately. "Your browser
 * does not offer this" and "you said no" are different problems with different
 * fixes, and merging them into one message would send half the people who read it
 * to the wrong one.
 */
export function useGeolocation() {
  const [state, setState] = useState<LocateState>('idle');
  const [position, setPosition] = useState<SharedPosition | null>(null);

  async function locate(): Promise<SharedPosition | null> {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setState('unsupported');
      return null;
    }

    setState('locating');

    const fix = await new Promise<GeolocationPosition | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (value) => resolve(value),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
      );
    });

    if (!fix) {
      setState('refused');
      return null;
    }

    const shared = { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
    setPosition(shared);
    setState('shared');
    return shared;
  }

  return { state, position, locate };
}

/** What each outcome should read as, when the caller has no better wording. */
export function locateMessage(state: LocateState): string | null {
  switch (state) {
    case 'locating':
      return 'Finding your location…';
    case 'refused':
      return 'Your location was not shared. You can type the coordinates instead.';
    case 'unsupported':
      return 'This browser cannot share a location. You can type the coordinates instead.';
    default:
      return null;
  }
}
