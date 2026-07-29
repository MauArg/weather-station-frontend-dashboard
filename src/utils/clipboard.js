/**
 * Copia texto al portapapeles, también fuera de un contexto seguro.
 *
 * `navigator.clipboard` sólo existe en secure contexts: HTTPS, o localhost. El
 * dashboard se sirve por nginx en HTTP plano sobre la LAN (`http://192.168.18.250`),
 * así que en campo la API entera es `undefined` y `navigator.clipboard.writeText(…)`
 * tira un TypeError antes de intentar copiar nada. Por eso los botones de copiar
 * fallaban en la Pi y funcionaban en desarrollo: `npm run dev` sirve desde
 * localhost, que sí califica como contexto seguro.
 *
 * El fallback es `document.execCommand('copy')`. Está deprecado, pero es lo único
 * que funciona sin TLS y sigue implementado en todos los browsers actuales. La
 * alternativa de fondo sería poner el dashboard detrás de HTTPS, que para una LAN
 * doméstica significa un certificado y un dominio para resolver un botón.
 *
 * Devuelve true si se copió.
 */

const legacyCopy = (value) => {
    const el = document.createElement('textarea');
    el.value = value;
    // readOnly y no disabled: un textarea deshabilitado no se puede seleccionar,
    // y sin selección execCommand('copy') no copia nada.
    el.readOnly = true;
    // Fuera de la vista pero participando del layout — `display:none` o
    // `visibility:hidden` lo dejarían sin selección posible. `fixed` evita además
    // que el scroll de la página salte al insertarlo.
    el.style.position = 'fixed';
    el.style.top = '-1000px';
    el.style.opacity = '0';
    el.setAttribute('aria-hidden', 'true');

    document.body.appendChild(el);
    try {
        el.select();
        el.setSelectionRange(0, value.length);
        return document.execCommand('copy');
    } catch (err) {
        console.warn('Fallback de copiado falló:', err);
        return false;
    } finally {
        el.remove();
    }
};

export const copyText = async (text) => {
    const value = String(text ?? '');
    if (!value) return false;

    // El guard por isSecureContext no es redundante con el feature detection: en
    // campo corta acá sin await de por medio, y eso importa porque execCommand
    // exige estar dentro del gesto del usuario que originó el click.
    if (window.isSecureContext && navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(value);
            return true;
        } catch (err) {
            // Puede fallar igual con el permiso denegado o el documento sin foco.
            console.warn('Clipboard API falló, probando el fallback:', err);
        }
    }

    return legacyCopy(value);
};
