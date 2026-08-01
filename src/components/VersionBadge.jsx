import React, { useEffect, useState } from 'react';
import { getBackendVersion } from '../services/ApiService';

/**
 * Which builds are running, tucked into the bottom corner.
 *
 * It exists to answer one question — "did the deploy I just did actually land?"
 * — so it is legible when looked for and invisible otherwise. Deliberately not
 * in the navbar: the navbar is for things you act on, and this is something you
 * check maybe twice a release.
 *
 * The dashboard's number is compiled in from package.json at build time; the
 * backend's is fetched once on mount. They are independent releases, and a
 * mismatch is the point of showing both — the two images are pushed separately
 * and it is entirely possible to update one and forget the other.
 *
 * The backend half degrades to a dash rather than disappearing. A missing number
 * still occupies its slot, so "the backend did not answer" reads differently
 * from "the backend is the same version", which is a distinction worth keeping
 * on a line whose whole job is telling you what is deployed.
 */
const VersionBadge = () => {
    const [backend, setBackend] = useState(undefined); // undefined = still asking

    useEffect(() => {
        let isMounted = true;
        getBackendVersion().then((v) => isMounted && setBackend(v));
        return () => { isMounted = false; };
    }, []);

    const backendLabel = backend === undefined ? '…' : (backend ?? '—');

    return (
        <div
            className="version-badge"
            title={`Dashboard ${__APP_VERSION__} · backend ${backendLabel}.\nSe versionan por separado: cada uno tiene su propia imagen y se despliegan de forma independiente. La versión del nodo se ve en service mode.`}
        >
            ui {__APP_VERSION__} · api {backendLabel}
        </div>
    );
};

export default VersionBadge;
