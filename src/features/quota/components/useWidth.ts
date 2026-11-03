import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Live content width of a container, for charts drawn in plain SVG. A callback
 * ref, so a container that mounts after the first render is still observed.
 */
export function useWidth<T extends HTMLElement = HTMLDivElement>() {
  const observerRef = useRef<ResizeObserver | null>(null);
  const [width, setWidth] = useState(0);
  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    observerRef.current = observer;
  }, []);
  useEffect(() => () => observerRef.current?.disconnect(), []);
  return { ref, width };
}
