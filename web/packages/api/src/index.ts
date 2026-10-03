export const apiBasePath = '/api/v1';

export {
  ApiRequestError,
  api,
  apiFetch,
  configureApi,
  demoApi,
  unwrap,
  type AccessTokenGetter,
  type ApiConfig,
} from './client.ts';
export { eventHub, type StreamListener } from './events.ts';
export {
  mergeActions,
  mergeMessages,
  subscribeToEvents,
  toolKey,
  useLiveSync,
  useStreamStatus,
  useToolDrift,
} from './live.ts';
export * from './queries.ts';
export type { StreamStatus } from './stream.ts';
export type * from './types.ts';
