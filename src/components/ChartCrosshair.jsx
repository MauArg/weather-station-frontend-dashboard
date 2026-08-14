import { useCallback, useRef, useState } from 'react';

/**
 * The colour both halves of the crosshair share, lifted from Grafana's own
 * cursor (uPlot's `.u-cursor-x` / `.u-cursor-y`, read off the running instance).
 *
 * The value is the whole trick behind "subtle but visible": a neutral grey at
 * half alpha sits close enough to the plot background not to compete with the
 * series, while white at any alpha reads as a third line on the chart. The
 * previous 0.5-alpha white was brighter than the gridlines it crossed.
 *
 * It lives here and not in `index.css` because the vertical half is drawn by
 * recharts as an SVG presentation attribute, where a `var(--…)` reference is not
 * a valid value. One JS constant is the only way the two halves can be
 * guaranteed to match.
 */
export const CROSSHAIR_STROKE = 'rgba(120, 120, 130, 0.5)';

/**
 * Crosshair thickness, in CSS pixels, for one physical pixel on this display.
 *
 * Grafana renders its cursor at `1 / devicePixelRatio`, which is why it stays a
 * true hairline on a HiDPI screen instead of doubling in weight. Read once at
 * module load: a browser window can be dragged to a monitor with a different
 * ratio, but the cost of that is a hairline half a pixel off, which is not
 * worth a subscription for.
 */
export const CROSSHAIR_WIDTH = 1 / (window.devicePixelRatio || 1);

/**
 * Chart wrapper that adds the horizontal half of a Grafana-style crosshair.
 *
 * The vertical half is recharts' own tooltip cursor, which snaps to the hovered
 * sample so it always agrees with the number in the tooltip. The horizontal one
 * follows the pointer instead of snapping, which is the behaviour worth copying
 * from Grafana: parking the cursor on a peak and reading straight across to see
 * whether anything else in the window comes close only works if the line sits
 * exactly where the eye already is.
 *
 * It is a DOM overlay rather than a recharts `ReferenceLine` on purpose. A
 * ReferenceLine needs a value on a specific axis, and the thermal-lag chart has
 * two of them — a line pinned to the temperature axis would read as a claim
 * about the daylight series too. Sitting above the SVG, the overlay is a
 * pointer-position marker and nothing else, and it works the same on all four
 * charts. This also sidesteps the recharts mouse-handler API, which is what
 * silently broke the previous attempt at this.
 */
const ChartCrosshair = ({ children }) => {
    const hostRef = useRef(null);
    const [line, setLine] = useState(null);

    /*
      The plot rectangle is read per move rather than cached: the axis widths
      shift whenever the domain grows a digit (the temperature axis is on
      'auto'), and a stale rectangle would leave the line hanging over the axis
      labels. Two getBoundingClientRect calls per mousemove is well inside
      budget for a 300px card.
    */
    const handleMove = useCallback((event) => {
        const host = hostRef.current;
        const plot = host?.querySelector('.recharts-cartesian-grid');
        if (!plot) return;

        const hostRect = host.getBoundingClientRect();
        const plotRect = plot.getBoundingClientRect();

        const inside =
            event.clientX >= plotRect.left && event.clientX <= plotRect.right &&
            event.clientY >= plotRect.top && event.clientY <= plotRect.bottom;

        if (!inside) {
            setLine(null);
            return;
        }

        setLine({
            top: event.clientY - hostRect.top,
            left: plotRect.left - hostRect.left,
            width: plotRect.width,
        });
    }, []);

    const clear = useCallback(() => setLine(null), []);

    return (
        <div
            ref={hostRef}
            className="chart-wrapper"
            onMouseMove={handleMove}
            onMouseLeave={clear}
        >
            {children}
            {line && (
                <div
                    className="chart-crosshair-y"
                    style={{
                        top: `${line.top}px`,
                        left: `${line.left}px`,
                        width: `${line.width}px`,
                        borderTopColor: CROSSHAIR_STROKE,
                        borderTopWidth: `${CROSSHAIR_WIDTH}px`,
                    }}
                />
            )}
        </div>
    );
};

export default ChartCrosshair;
