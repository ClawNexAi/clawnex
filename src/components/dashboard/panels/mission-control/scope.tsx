"use client";

import { createContext, useContext, type ReactNode } from "react";

interface MissionControlScope {
  selectedInstance: string;
}

const MissionControlScopeContext = createContext<MissionControlScope>({
  selectedInstance: "all",
});

export function MissionControlScopeProvider({
  selectedInstance,
  children,
}: {
  selectedInstance: string;
  children: ReactNode;
}) {
  return (
    <MissionControlScopeContext.Provider value={{ selectedInstance }}>
      {children}
    </MissionControlScopeContext.Provider>
  );
}

export function useMissionControlScope(): MissionControlScope {
  return useContext(MissionControlScopeContext);
}
