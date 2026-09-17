import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

type HostContextValue = {
  selectedHostId: number | null;
  setSelectedHostId: (id: number | null) => void;
};

const HostContext = createContext<HostContextValue | undefined>(undefined);

export function HostProvider({ children }: { children: ReactNode }) {
  const [selectedHostId, setSelectedHostId] = useState<number | null>(null);

  return (
    <HostContext.Provider value={{ selectedHostId, setSelectedHostId }}>
      {children}
    </HostContext.Provider>
  );
}

export function useHostContext() {
  const context = useContext(HostContext);

  if (!context) {
    throw new Error("useHostContext must be used inside HostProvider.");
  }

  return context;
}
