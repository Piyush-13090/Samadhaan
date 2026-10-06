'use client';

import { useEffect, useRef, useState } from 'react';
import type { ResolutionStreamEvent } from '@samadhaan/shared';
import { roomStreamUrl } from '@/services/resolution.service';

export type StreamMode = 'connecting' | 'live' | 'polling';

const POLL_MS = 15_000;
const RETRY_LIVE_MS = 60_000;
const EVENT_TYPES: ResolutionStreamEvent['type'][] = [
  'message.created',
  'message.updated',
  'activity',
  'room.closed',
];

/**
 * Live room updates over Server-Sent Events, with a polling fallback.
 *
 * If the stream cannot be opened or drops (a proxy that buffers, an expired
 * session, a server restart), the hook switches to calling `onPoll` every
 * 15 seconds and tries the stream again a minute later. Either way the room
 * keeps up; only latency differs, and `mode` says which is in effect.
 */
export function useRoomStream(
  roomId: string,
  handlers: { onEvent: (event: ResolutionStreamEvent) => void; onPoll: () => void },
  enabled = true,
): StreamMode {
  const [mode, setMode] = useState<StreamMode>('connecting');
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;
    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    };

    const fallBack = () => {
      source?.close();
      source = null;
      if (disposed) return;
      setMode('polling');
      if (!pollTimer) pollTimer = setInterval(() => latest.current.onPoll(), POLL_MS);
      if (!retryTimer) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          connect();
        }, RETRY_LIVE_MS);
      }
    };

    function connect() {
      if (disposed) return;
      if (typeof EventSource === 'undefined') {
        fallBack();
        return;
      }
      source = new EventSource(roomStreamUrl(roomId), { withCredentials: true });
      source.onopen = () => {
        setMode('live');
        stopPolling();
        // Catch up on anything that happened while not live.
        latest.current.onPoll();
      };
      source.onerror = () => fallBack();
      for (const type of EVENT_TYPES) {
        source.addEventListener(type, (message) => {
          try {
            latest.current.onEvent(JSON.parse((message as MessageEvent<string>).data));
          } catch {
            // A malformed frame is ignored; the next poll reconciles.
          }
        });
      }
    }

    connect();
    return () => {
      disposed = true;
      source?.close();
      stopPolling();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [roomId, enabled]);

  return enabled ? mode : 'polling';
}
