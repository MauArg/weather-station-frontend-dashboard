import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Radio, RotateCcw, Eraser, Terminal } from 'lucide-react';
import toast from 'react-hot-toast';
import { sendServiceCommand } from '../../services/ServiceApi';
import { apiNote } from '../../i18n/apiText';

/**
 * Direct access to the command topic.
 *
 * Only the commands the firmware actually implements are exposed as buttons.
 * CONFIG and CALIBRATE parse fine in command.cpp but their handlers in main.cpp
 * are still TODO stubs that fall through to a normal telemetry cycle — worse,
 * neither clears the retained topic, so they would re-fire on every wake. They
 * stay out until the firmware side exists; the raw field is there if you want to
 * experiment deliberately.
 */
const CommandConsole = ({ connected }) => {
    const { t } = useTranslation('service');
    const [raw, setRaw] = useState('{"cmd":"ping"}');
    const [busy, setBusy] = useState(false);

    const run = async (body, description) => {
        setBusy(true);
        try {
            const res = await sendServiceCommand(body);
            const note = apiNote(t, 'note', res.noteCode, res.note);
            toast.success(`${description}${note ? ` — ${note}` : ''}`);
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="svc-card">
            <div className="svc-card-head">
                <h3>{t('console.title')}</h3>
                <span className="svc-muted svc-small">{t('console.subtitle')}</span>
            </div>

            <div className="svc-btn-row">
                <button
                    className="svc-btn"
                    disabled={busy || !connected}
                    onClick={() => run({ cmd: 'ping' }, t('console.toast.ping'))}
                >
                    <Radio size={16} /> {t('console.ping')}
                </button>
                <button
                    className="svc-btn"
                    disabled={busy || !connected}
                    onClick={() => run({ cmd: 'reboot' }, t('console.toast.reboot'))}
                >
                    <RotateCcw size={16} /> {t('console.reboot')}
                </button>
                <button
                    className="svc-btn"
                    disabled={busy || !connected}
                    onClick={() => run({ cmd: 'clear' }, t('console.toast.cleared'))}
                >
                    <Eraser size={16} /> {t('console.clearRetained')}
                </button>
            </div>

            <label className="svc-kv-label" style={{ marginTop: '0.75rem' }}>
                <Terminal size={13} aria-hidden="true" /> {t('console.rawJson')}
            </label>
            <div className="svc-raw-row">
                <input
                    className="svc-input"
                    value={raw}
                    onChange={(e) => setRaw(e.target.value)}
                    spellCheck={false}
                    placeholder='{"cmd":"maintenance","timeout_min":10}'
                />
                <button
                    className="svc-btn"
                    disabled={busy || !connected}
                    onClick={() => run({ cmd: 'raw', raw }, t('console.toast.raw'))}
                >
                    <Send size={16} /> {t('console.publish')}
                </button>
            </div>
            <p className="svc-muted svc-small svc-card-foot">{t('console.footer')}</p>
        </div>
    );
};

export default CommandConsole;
