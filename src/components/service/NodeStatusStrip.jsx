import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatClock } from '../../utils/timezone';
import { apiText } from '../../i18n/apiText';
import { useNow } from '../../hooks/useNow';
import { NODE_STATE_UI, nodeStateKey } from './nodeState';
import Tip from './Tip';

/**
 * Where the node is in its duty cycle, pinned above the tabs.
 *
 * This lives outside the tab panels because almost every action in this view
 * needs it as context: whether a command will be picked up in seconds or in a
 * minute, whether a transfer can happen at all, whether "no telemetry" means
 * broken or means a session is open. Behind a tab it would be the one thing you
 * have to leave what you are doing to go check.
 *
 * The counters are derived from absolute instants against a running clock rather
 * than from the integers the backend sent, for the same reason the health card
 * does it: between pushes those numbers go stale, and the case worth showing
 * most —the node that never comes back— is exactly the one with no new pushes.
 */
const NodeStatusStrip = ({ node }) => {
    const { t } = useTranslation('service');
    const now = useNow(1000);

    const stateKey = nodeStateKey(node?.state);
    const ui = NODE_STATE_UI[stateKey];
    const StateIcon = ui.Icon;

    const lastSeenMs = node?.lastSeenAt ? new Date(node.lastSeenAt).getTime() : null;
    const nextMs = node?.nextExpectedAt ? new Date(node.nextExpectedAt).getTime() : null;
    const secondsSince = lastSeenMs != null ? Math.round((now - lastSeenMs) / 1000) : null;
    const secondsUntil = nextMs != null ? Math.round((nextMs - now) / 1000) : null;

    const countdownClass = node?.state === 'overdue'
        ? 'svc-countdown svc-countdown-late'
        : secondsUntil != null && secondsUntil <= 0
            ? 'svc-countdown svc-countdown-due'
            : 'svc-countdown';

    return (
        <div className="svc-pinned">
            <Tip className="svc-tip-left" text={t(`health.state.${stateKey}Tip`)}>
                <span className="svc-status-pill" style={{ borderColor: ui.color, color: ui.color }}>
                    <StateIcon size={15} aria-hidden="true" /> {t(`health.state.${stateKey}`)}
                </span>
            </Tip>

            <div className="svc-pinned-item">
                <span className="svc-kv-label">{t('health.lastSeen')}</span>
                <span className="svc-kv-value">
                    {node?.lastSeenAt ? formatClock(node.lastSeenAt) : '—'}
                    {/* A backend enum, same family as tier and the sensor keys, so it
                        resolves through apiText into the `api` namespace. */}
                    {node?.lastSeenSource && (
                        <span className="svc-muted svc-small">
                            {' '}({apiText(t, 'lastSeenSource', node.lastSeenSource, node.lastSeenSource)})
                        </span>
                    )}
                    {secondsSince != null && secondsSince >= 0 && (
                        <span className="svc-muted svc-small">{t('health.secondsAgo', { sec: secondsSince })}</span>
                    )}
                </span>
            </div>

            <div className="svc-pinned-item svc-pinned-next">
                <span className="svc-kv-label">
                    {node?.state === 'overdue' ? t('health.wasExpected') : t('health.nextExpected')}
                </span>
                <span className="svc-kv-value">
                    {node?.nextExpectedAt ? `~${formatClock(node.nextExpectedAt)}` : '—'}
                    {secondsUntil != null && (
                        <Tip
                            className="svc-tip-right"
                            text={
                                secondsUntil > 0
                                    ? t('health.countdownTipFuture', { sec: node.expectedIntervalSec })
                                    : t('health.countdownTipPast', { sec: Math.abs(secondsUntil) })
                            }
                        >
                            {' '}
                            <span className={countdownClass}>
                                · {secondsUntil >= 0
                                    ? t('health.countdownIn', { sec: secondsUntil })
                                    : t('health.countdownLate', { sec: secondsUntil })}
                            </span>
                        </Tip>
                    )}
                </span>
            </div>
        </div>
    );
};

export default NodeStatusStrip;
