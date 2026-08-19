import React, { useRef } from 'react';

/**
 * The service view's tab bar.
 *
 * These tabs switch *visibility*, never mounting — the panels all stay in the
 * tree and the inactive ones are hidden. See the note in ServiceMode.jsx for
 * why; it is not a detail, it is what keeps an in-flight capture command from
 * losing the state that tracks it.
 *
 * First ARIA tablist in this codebase, so it follows the two idioms already
 * here rather than inventing a third: the labelled wrapper of `.lang-toggle`'s
 * role="group", and the discipline of `.time-range-btn`, whose CSS keys off the
 * ARIA state so the style and the screen-reader state cannot drift apart.
 *
 * Roving tabIndex: only the selected tab is in the page's tab order, and the
 * arrows move between them. That is the tablist contract — tabbing through four
 * buttons to reach the panel would make the keyboard path longer than the
 * pointer one.
 *
 * `badge` is a sentence, not a flag, and it is carried twice on purpose. A dot
 * alone would be colour communicating by itself, which this view does not do:
 * sighted readers get the sentence from the tooltip the rest of the view already
 * uses, and assistive tech gets it from visually hidden text, since a CSS
 * pseudo-element is not reliably announced. The dot itself is decorative.
 * It stays a dot rather than the sentence inline because a tab that changes
 * width when a capture starts drags the whole bar with it.
 */
const TabBar = ({ tabs, active, onChange, label }) => {
    const refs = useRef({});

    const onKeyDown = (event) => {
        const current = tabs.findIndex((tab) => tab.id === active);
        const last = tabs.length - 1;

        let target = null;
        if (event.key === 'ArrowRight') target = current === last ? 0 : current + 1;
        else if (event.key === 'ArrowLeft') target = current === 0 ? last : current - 1;
        else if (event.key === 'Home') target = 0;
        else if (event.key === 'End') target = last;
        if (target === null) return;

        // Automatic activation: the panel is already mounted, so showing it costs
        // nothing and arrowing through the bar behaves like arrowing through radio
        // buttons. Manual activation exists for tabs that are expensive to reveal.
        event.preventDefault();
        const next = tabs[target].id;
        onChange(next);
        refs.current[next]?.focus();
    };

    return (
        <div className="svc-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
            {tabs.map((tab) => {
                const selected = tab.id === active;
                const Icon = tab.Icon;
                return (
                    <button
                        key={tab.id}
                        ref={(el) => { refs.current[tab.id] = el; }}
                        id={`svc-tab-${tab.id}`}
                        type="button"
                        role="tab"
                        className={tab.badge ? 'svc-tab svc-tip' : 'svc-tab'}
                        data-tip={tab.badge || undefined}
                        aria-selected={selected}
                        aria-controls={`svc-tabpanel-${tab.id}`}
                        tabIndex={selected ? 0 : -1}
                        onClick={() => onChange(tab.id)}
                    >
                        {Icon && <Icon size={15} aria-hidden="true" />}
                        {tab.label}
                        {tab.badge && (
                            <>
                                <span className="svc-tab-dot" aria-hidden="true" />
                                <span className="svc-sr-only">{tab.badge}</span>
                            </>
                        )}
                    </button>
                );
            })}
        </div>
    );
};

export default TabBar;
