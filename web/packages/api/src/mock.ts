// Mock mode entry. Import it dynamically behind VITE_BETSEE_MOCK so real builds leave it out.
export { createMockFetch, type MockFetchOptions, type MockHandler } from './mock/fetch.ts';
export { createMockWorld, type MockWorld } from './mock/generator.ts';
export { ANALYZER_LABEL, CONTROLS, HUMANS, MOCK_ME, ORGANIZATION, USE_CASES } from './mock/world.ts';
