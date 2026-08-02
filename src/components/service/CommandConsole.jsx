import React, { useState } from 'react';
import { Send, Radio, RotateCcw, Eraser, Terminal } from 'lucide-react';
import toast from 'react-hot-toast';
import { sendServiceCommand } from '../../services/ServiceApi';

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
    const [raw, setRaw] = useState('{"cmd":"ping"}');
    const [busy, setBusy] = useState(false);

    const run = async (body, description) => {
        setBusy(true);
        try {
            const res = await sendServiceCommand(body);
            toast.success(`${description}${res.note ? ` — ${res.note}` : ''}`);
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="svc-card">
            <div className="svc-card-head">
                <h3>Command console</h3>
                <span className="svc-muted svc-small">
                    The node reads the retained topic on wake, so a command waits until the next cycle
                </span>
            </div>

            <div className="svc-btn-row">
                <button
                    className="svc-btn"
                    disabled={busy || !connected}
                    onClick={() => run({ cmd: 'ping' }, 'Ping published')}
                >
                    <Radio size={16} /> Ping
                </button>
                <button
                    className="svc-btn"
                    disabled={busy || !connected}
                    onClick={() => run({ cmd: 'reboot' }, 'Reboot published')}
                >
                    <RotateCcw size={16} /> Reboot
                </button>
                <button
                    className="svc-btn"
                    disabled={busy || !connected}
                    onClick={() => run({ cmd: 'clear' }, 'Topic cleared')}
                >
                    <Eraser size={16} /> Clear retained
                </button>
            </div>

            <label className="svc-kv-label" style={{ marginTop: '0.75rem' }}>
                <Terminal size={13} aria-hidden="true" /> Raw JSON
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
                    onClick={() => run({ cmd: 'raw', raw }, 'Raw payload published')}
                >
                    <Send size={16} /> Publish
                </button>
            </div>
            <p className="svc-muted svc-small svc-card-foot">
                Published with retain. The backend validates that it's JSON — parseCommand() discards
                anything that isn't, and the node would just continue its normal cycle without any warning.
            </p>
        </div>
    );
};

export default CommandConsole;
