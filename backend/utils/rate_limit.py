"""Minimal in-memory sliding-window rate limiter.

Deliberately dependency-free: this app runs as a single gunicorn worker on a
Raspberry Pi (see start.sh -w 1), so per-process state is sufficient. If the
worker count is ever raised, move this to Redis (already a dependency).
"""

import threading
import time


class RateLimiter:
    def __init__(self):
        self._events = {}  # key -> list of timestamps
        self._lock = threading.Lock()

    def is_allowed(self, key: str, limit: int, window_seconds: float) -> bool:
        """Record an attempt for `key` and return False if over the limit."""
        now = time.monotonic()
        cutoff = now - window_seconds
        with self._lock:
            timestamps = [t for t in self._events.get(key, []) if t > cutoff]
            if len(timestamps) >= limit:
                self._events[key] = timestamps
                return False
            timestamps.append(now)
            self._events[key] = timestamps

            # Opportunistic cleanup so idle keys don't accumulate forever
            if len(self._events) > 1000:
                self._events = {
                    k: [t for t in v if t > cutoff]
                    for k, v in self._events.items()
                    if any(t > cutoff for t in v)
                }
            return True

    def reset(self, key: str) -> None:
        """Clear attempts for a key (e.g. after a successful login)."""
        with self._lock:
            self._events.pop(key, None)


# Shared limiter for authentication endpoints
auth_limiter = RateLimiter()

# 10 failed attempts per 5 minutes per (IP, username)
LOGIN_LIMIT = 10
LOGIN_WINDOW_SECONDS = 300
