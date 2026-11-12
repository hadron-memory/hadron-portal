import type { TaskWarning } from './warnings';

/** One explicit acknowledgement's result; permission remains the server's decision. */
export type AlarmAckResult = {
  eventId: string;
  kind: 'acknowledged' | 'already-acknowledged' | 'refused' | 'uncertain';
  code?: string;
  message?: string;
  warnings?: TaskWarning[];
  more?: number;
};
