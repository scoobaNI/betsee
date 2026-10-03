import { createContext, useContext } from 'react';

const MockMode = createContext(false);

export const MockModeProvider = MockMode.Provider;

/** True when the app runs on fixtures; the header then shows a "Mock data" label (D2). */
export const useMockMode = () => useContext(MockMode);
