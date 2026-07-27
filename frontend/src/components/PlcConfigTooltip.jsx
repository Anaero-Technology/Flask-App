import React, { useState } from 'react';
import { useAuth } from './AuthContext';

//
// Hovering the test name on a PLC card shows what the machine is set to for
// that test, the same way the chimera and black box cards do.
//
// A PLC's configuration changes over the life of a test, so this shows the
// settings currently in force and says how many times they have been changed -
// the full history is in the test's export.
//
const PlcConfigTooltip = ({ testId, deviceId, activeTestName }) => {
    const { authFetch } = useAuth();
    const [config, setConfig] = useState(null);
    const [loading, setLoading] = useState(false);
    const [show, setShow] = useState(false);
    const [showDelay, setShowDelay] = useState(null);

    const fetchConfig = async () => {
        if (!testId || !deviceId || config) return;
        setLoading(true);
        try {
            const response = await authFetch(`/api/v1/plc/test/${testId}/configuration`);
            if (response.ok) {
                const data = await response.json();
                const forDevice = (data.plc_configurations || [])
                    .find(c => c.device_id === deviceId);
                setConfig(forDevice || null);
            }
        } catch (err) {
            console.error('Error fetching PLC config:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleMouseEnter = () => {
        const delay = setTimeout(() => {
            fetchConfig();
            setShow(true);
        }, 300);
        setShowDelay(delay);
    };

    const handleMouseLeave = () => {
        if (showDelay) clearTimeout(showDelay);
        setShow(false);
    };

    const pill = (
        <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-700 text-xs font-medium border border-purple-100 cursor-help">
            <span className="truncate max-w-[120px]" title={activeTestName}>{activeTestName}</span>
        </div>
    );

    if (!show) {
        return (
            <div onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
                {pill}
            </div>
        );
    }

    const settings = config?.settings || {};
    const changes = Math.max((config?.history?.length || 1) - 1, 0);

    // Same shape and wording as the test's entry in the database view, so the
    // two read as the same thing seen in two places.
    const sections = [
        ['Heaters', settings.heaters, (u) => `${u.target}°C`],
        ['Mixers', settings.mixers,
            (u) => ['always off', 'always on', `timed ${u.on_for}s / ${u.off_for}s`][u.mode] ?? `mode ${u.mode}`],
        ['Feeders', settings.feeders,
            (u) => (u.on_for ? `${u.on_for}s every ${u.off_for_minutes} min` : 'paused')],
        ['Agitators', settings.agitators,
            (u) => (u.pre_feed ? `${u.pre_feed}s pre-feed` : 'paused')],
    ].filter(([, units]) => units && units.length > 0);

    return (
        <div onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} className="relative">
            {pill}

            <div
                className="absolute top-1/2 left-full ml-2 -translate-y-1/2 z-50 bg-white rounded-lg shadow-lg border border-gray-200 p-3 w-[26rem] animate-in fade-in slide-in-from-left-2 duration-200"
                onMouseEnter={() => setShow(true)}
                onMouseLeave={handleMouseLeave}
            >
                {loading ? (
                    <div className="text-xs text-gray-500 text-center py-2">Loading…</div>
                ) : !config ? (
                    <div className="text-xs text-gray-500 text-center py-2">
                        No configuration recorded for this test yet.
                    </div>
                ) : (
                    <>
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2 border-b border-gray-200">
                            <h4 className="text-sm font-semibold text-gray-800">
                                PLC — {config.device_name || activeTestName}
                            </h4>
                            <span className="text-xs text-gray-500">
                                {config.model_id || config.machine_type}
                                {config.profile_name ? ` · profile ${config.profile_name}` : ''}
                            </span>
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            {sections.map(([label, units, describe]) => (
                                <div key={label}>
                                    <span className="text-xs uppercase text-gray-400 block mb-1">{label}</span>
                                    <ul className="text-sm text-gray-700 space-y-0.5">
                                        {units.map((u) => (
                                            <li key={u.number} className="flex justify-between gap-3">
                                                <span className="text-gray-500">{u.number}</span>
                                                <span>{describe(u)}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                        </div>

                        {/* A PLC's settings move during a run, unlike the other
                            devices, so the reading is dated rather than implied. */}
                        <p className="mt-3 pt-2 border-t border-gray-200 text-xs text-gray-500">
                            {changes > 0
                                ? `Current settings · ${changes} change${changes === 1 ? '' : 's'} during this test`
                                : 'Unchanged since the test started'}
                        </p>
                    </>
                )}
            </div>
        </div>
    );
};

export default PlcConfigTooltip;
