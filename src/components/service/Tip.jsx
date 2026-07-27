import React from 'react';

/**
 * Hover/focus explanation for a piece of jargon.
 *
 * This view is full of terms whose meaning lives in the firmware, not on screen —
 * "atrasado" against which interval, why 4.00 V is the flashing threshold, that
 * dht11_ok is really a DHT22. Rendered via a CSS pseudo-element rather than the
 * native title attribute so it matches the dashboard and appears without the
 * browser's delay.
 *
 * tabIndex makes it reachable by keyboard, since :focus-visible also shows the tip.
 */
const Tip = ({ text, children, className = '', ...rest }) => (
    <span className={`svc-tip ${className}`.trim()} data-tip={text} tabIndex={0} {...rest}>
        {children}
    </span>
);

export default Tip;
