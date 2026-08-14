import { useSyncExternalStore } from 'react';

/**
 * True while the viewport is narrow enough that `.charts-grid` has collapsed to
 * a single column.
 *
 * The 900px here mirrors the media query in `index.css` and has to stay in step
 * with it: this hook exists so the chart internals (axis widths, margins) can
 * follow the same breakpoint the layout already uses. A chart that keeps its
 * desktop gutters inside a phone-width card spends most of the card on empty
 * margin instead of on the plot.
 */
const NARROW_QUERY = '(max-width: 900px)';

const subscribe = (onChange) => {
    const mql = window.matchMedia(NARROW_QUERY);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
};

const getSnapshot = () => window.matchMedia(NARROW_QUERY).matches;

export const useNarrowLayout = () => useSyncExternalStore(subscribe, getSnapshot, () => false);
