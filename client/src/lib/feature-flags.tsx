import React, { createContext, useContext, useEffect, useState } from "react";

type FeatureFlagsContextType = {
  flags: Set<string>;
  isEnabled: (key: string) => boolean;
};

const FeatureFlagsContext = createContext<FeatureFlagsContextType>({
  flags: new Set(),
  isEnabled: () => false,
});

export function FeatureFlagsProvider({ children }: { children: React.ReactNode }) {
  const [flags, setFlags] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/feature-flags/', { credentials: 'include' })
      .then(r => r.json())
      .then((keys: string[]) => setFlags(new Set(keys)))
      .catch(() => {});
  }, []);

  return (
    <FeatureFlagsContext.Provider value={{ flags, isEnabled: (key) => flags.has(key) }}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

export function useFeatureFlags() {
  return useContext(FeatureFlagsContext);
}
