import { createContext, useContext } from 'react';

const MockMode = createContext(false);

export const MockModeProvider = MockMode.Provider;

/** True when the app runs on fixtures; the top bar then shows the "Mock data" badge (D2). */
export const useMockMode = () => useContext(MockMode);
