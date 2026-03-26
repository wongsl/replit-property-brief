import { useState, useEffect } from 'react';

const KEY = 'privacy_mode';
const EVENT = 'privacy-mode-change';

export const FAKE_ADDRESS = {
  addressNumber: '123',
  streetName: 'Alphabet',
  suffix: 'Street',
  city: 'San Francisco',
  county: 'San Francisco County',
};

export function usePrivacyMode() {
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem(KEY) === 'true'; } catch { return false; }
  });

  useEffect(() => {
    const handler = () => {
      try { setEnabled(localStorage.getItem(KEY) === 'true'); } catch {}
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);

  const toggle = () => {
    const next = !enabled;
    try { localStorage.setItem(KEY, String(next)); } catch {}
    window.dispatchEvent(new Event(EVENT));
  };

  return { privacyMode: enabled, togglePrivacyMode: toggle };
}

export function maskAnalysis(ai: any, privacyMode: boolean) {
  if (!privacyMode || !ai) return ai;
  return {
    ...ai,
    addressNumber: ai.addressNumber ? FAKE_ADDRESS.addressNumber : ai.addressNumber,
    streetName: ai.streetName ? FAKE_ADDRESS.streetName : ai.streetName,
    suffix: ai.suffix ? FAKE_ADDRESS.suffix : ai.suffix,
    city: ai.city ? FAKE_ADDRESS.city : ai.city,
    county: ai.county ? FAKE_ADDRESS.county : ai.county,
  };
}
