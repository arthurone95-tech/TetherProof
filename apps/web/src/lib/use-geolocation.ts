'use client';

import { useState } from 'react';

export type LocateState = 'idle' | 'locating' | 'shared' | 'refused' | 'unsupported' | 'failed';

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
 *
 * A transient failure is retried once before it is reported as one. Once the
 * person has granted permission, the likely causes of an empty answer are a slow
 * first fix or a dropped response, and both usually succeed on the second
 * attempt. A refusal is not retried — the person already answered, and asking
 * again is both rude and pointless.
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

    const first = await ask();
    if (first.position) {
      const shared = toShared(first.position);
      setPosition(shared);
      setState('shared');
      return shared;
    }
    if (first.refused) {
      setState('refused');
      return null;
    }

    setState('locating');
    const second = await ask();
    if (second.position) {
      const shared = toShared(second.position);
      setPosition(shared);
      setState('shared');
      return shared;
    }

    setState(second.refused ? 'refused' : 'failed');
    return null;
  }

  return { state, position, locate };
}

function toShared(fix: GeolocationPosition): SharedPosition {
  return { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
}

/** One attempt at the sensor, reporting whether the person refused it. */
function ask(): Promise<{ position: GeolocationPosition | null; refused: boolean }> {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (value) => resolve({ position: value, refused: false }),
      (error) => resolve({ position: null, refused: error.code === 1 /* PERMISSION_DENIED */ }),
      // Two attempts share the old single-attempt time budget, so the total
      // worst case is roughly the same but a slow first fix no longer ends it.
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  });
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
    case 'failed':
      return 'Your location could not be found right now. You can type the coordinates instead.';
    default:
      return null;
  }
}