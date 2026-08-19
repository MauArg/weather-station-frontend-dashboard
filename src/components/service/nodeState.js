import { Moon, Radio, AlertTriangle, HelpCircle } from 'lucide-react';

/**
 * Presentation for node.state, shared by the pinned strip at the top of the
 * service view and by the node health card.
 *
 * Presentation only: the label and the tooltip for each state live in the
 * dictionary, keyed by the same node.state value the backend sends. Colour is
 * paired with an icon on purpose — the green and the amber of this dashboard
 * separate by about ΔE 6.8 under protanopia, so the hue alone does not carry it.
 */
export const NODE_STATE_UI = {
    service_mode: { color: '#4dabf7', Icon: Radio },
    sleeping: { color: '#4ade80', Icon: Moon },
    overdue: { color: '#f87171', Icon: AlertTriangle },
    unknown: { color: '#a1a1aa', Icon: HelpCircle },
};

/** The backend can send a state this build does not know; fall back rather than crash. */
export const nodeStateKey = (state) => (NODE_STATE_UI[state] ? state : 'unknown');
