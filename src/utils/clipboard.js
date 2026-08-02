/**
 * Copies text to the clipboard, including outside a secure context.
 *
 * `navigator.clipboard` only exists in secure contexts: HTTPS, or localhost. The
 * dashboard is served by nginx over plain HTTP on the LAN (`http://192.168.18.250`),
 * so in the field the whole API is `undefined` and `navigator.clipboard.writeText(…)`
 * throws a TypeError before it even attempts to copy anything. That's why the copy
 * buttons failed on the Pi but worked in development: `npm run dev` serves from
 * localhost, which does qualify as a secure context.
 *
 * The fallback is `document.execCommand('copy')`. It's deprecated, but it's the
 * only thing that works without TLS and it's still implemented in every current
 * browser. The real fix would be putting the dashboard behind HTTPS, which for a
 * home LAN means a certificate and a domain just to fix a button.
 *
 * Returns true if the copy succeeded.
 */

const legacyCopy = (value) => {
    const el = document.createElement('textarea');
    el.value = value;
    // readOnly, not disabled: a disabled textarea can't be selected, and without
    // a selection execCommand('copy') copies nothing.
    el.readOnly = true;
    // Off-screen but still part of the layout — `display:none` or
    // `visibility:hidden` would leave it unselectable. `fixed` also keeps the
    // page from jumping on scroll when it's inserted.
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
        console.warn('Copy fallback failed:', err);
        return false;
    } finally {
        el.remove();
    }
};

export const copyText = async (text) => {
    const value = String(text ?? '');
    if (!value) return false;

    // The isSecureContext guard isn't redundant with feature detection: in the
    // field it short-circuits here with no await in between, and that matters
    // because execCommand needs to run inside the user gesture that started the
    // click.
    if (window.isSecureContext && navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(value);
            return true;
        } catch (err) {
            // Can still fail on a denied permission or an unfocused document.
            console.warn('Clipboard API failed, trying fallback:', err);
        }
    }

    return legacyCopy(value);
};
