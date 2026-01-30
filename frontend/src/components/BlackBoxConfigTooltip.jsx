import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import { useTranslation } from 'react-i18next';

const BlackBoxConfigTooltip = ({ testId, deviceId, activeTestName }) => {
    const { authFetch } = useAuth();
    const { t: tPages } = useTranslation('pages');
    const [config, setConfig] = useState(null);
    const [loading, setLoading] = useState(false);
    const [show, setShow] = useState(false);
    const [showDelay, setShowDelay] = useState(null);

    const fetchConfig = async () => {
        if (!testId || !deviceId || config) return;
        setLoading(true);
        try {
            const response = await authFetch(`/api/v1/tests/${testId}/blackbox-configuration/${deviceId}`);
            if (response.ok) {
                const data = await response.json();
                setConfig(data);
            }
        } catch (err) {
            console.error('Error fetching blackbox config:', err);
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

    // Group channels by sample name
    const groupChannelsBySample = (channels) => {
        const groups = {};
        channels.forEach(ch => {
            const sample = ch.sample_name || tPages('config_tooltip.unconfigured');
            if (!groups[sample]) {
                groups[sample] = [];
            }
            groups[sample].push(ch.channel_number);
        });
        return groups;
    };

    if (!show || !config?.channels) {
        return (
            <div
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-700 text-xs font-medium border border-purple-100 cursor-help"
            >
                <span className="truncate max-w-[120px]" title={activeTestName}>{activeTestName}</span>
            </div>
        );
    }

    const channels = config.channels || [];
    const channelsBySample = groupChannelsBySample(channels);

    return (
        <div
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            className="relative"
        >
            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-700 text-xs font-medium border border-purple-100 cursor-help">
                <span className="truncate max-w-[120px]" title={activeTestName}>{activeTestName}</span>
            </div>

            {/* Hover Tooltip */}
            {show && (
                <div
                    className="absolute top-1/2 left-full ml-2 -translate-y-1/2 z-50 bg-white rounded-lg shadow-lg border border-gray-200 p-3 w-96 animate-in fade-in slide-in-from-left-2 duration-200"
                    onMouseEnter={() => setShow(true)}
                    onMouseLeave={handleMouseLeave}
                >
                    {loading ? (
                        <div className="text-xs text-gray-500 text-center py-2">{tPages('config_tooltip.loading')}</div>
                    ) : (
                        <>
                            {/* Header */}
                            <div className="mb-2 pb-2 border-b border-gray-200">
                                <p className="text-xs font-bold text-gray-900">{config.test_name}</p>
                                <p className="text-xs text-gray-500">{tPages('config_tooltip.test_configuration')} - {config.device_name}</p>
                            </div>

                            {/* Channels Grouped by Sample */}
                            <div className="pt-2">
                                <p className="text-xs font-semibold text-gray-600 mb-2">
                                    {tPages('config_tooltip.channels')} ({channels.length}/15)
                                </p>
                                <div className="space-y-1.5">
                                    {Object.entries(channelsBySample).map(([sample, chNumbers]) => (
                                        <div key={sample}>
                                            <p className="text-xs font-medium text-gray-700 mb-1 truncate" title={sample}>
                                                {sample}
                                            </p>
                                            <div className="flex flex-wrap gap-1.5">
                                                {chNumbers.map(ch => (
                                                    <div
                                                        key={ch}
                                                        className="flex items-center justify-center px-2 py-1 rounded text-xs font-semibold bg-gray-100 text-gray-600 border border-gray-300"
                                                    >
                                                        {ch}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default BlackBoxConfigTooltip;
