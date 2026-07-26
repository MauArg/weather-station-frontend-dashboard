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
                <h3>Consola de comandos</h3>
                <span className="svc-muted svc-small">
                    El nodo lee el topic retenido al despertar, así que un comando espera al próximo ciclo
                </span>
            </div>

            <div className="svc-btn-row">
                <button
                    className="svc-btn"
                    disabled={busy || !connected}
                    onClick={() => run({ cmd: 'ping' }, 'Ping publicado')}
                >
                    <Radio size={16} /> Ping
                </button>
                <button
                    className="svc-btn"
                    disabled={busy || !connected}
                    onClick={() => run({ cmd: 'reboot' }, 'Reboot publicado')}
                >
                    <RotateCcw size={16} /> Reboot
                </button>
                <button
                    className="svc-btn"
                    disabled={busy || !connected}
                    onClick={() => run({ cmd: 'clear' }, 'Topic limpiado')}
                >
                    <Eraser size={16} /> Limpiar retained
                </button>
            </div>

            <label className="svc-kv-label" style={{ marginTop: '0.75rem' }}>
                <Terminal size={13} aria-hidden="true" /> JSON crudo
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
                    onClick={() => run({ cmd: 'raw', raw }, 'Payload crudo publicado')}
                >
                    <Send size={16} /> Publicar
                </button>
            </div>
            <p className="svc-muted svc-small svc-card-foot">
                Se publica con retain. El backend valida que sea JSON — parseCommand() descarta cualquier
                cosa que no lo sea, y el nodo seguiría su ciclo normal sin avisar.
            </p>
        </div>
    );
};

export default CommandConsole;
