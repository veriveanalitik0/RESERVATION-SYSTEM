/**
 * Real-time event subscription hook.
 *
 * Bağlanır: /api/events SSE stream'ine (access token ile).
 * Otomatik reconnect: EventSource native.
 * Hot reload safe: cleanup'ta source.close().
 */
import { useEffect, useRef } from 'react';
import { subscribeEvents } from '../services/api';
import type { SubjectKind } from '../types';

export type RealtimeHandler = (type: string, data: unknown) => void;

export function useRealtimeEvents(
  kind: SubjectKind | null,
  handler: RealtimeHandler
): void {
  const handlerRef = useRef<RealtimeHandler>(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!kind) return undefined;
    const sub = subscribeEvents(kind, (t, d) => handlerRef.current(t, d));
    return () => {
      sub?.close();
    };
  }, [kind]);
}
