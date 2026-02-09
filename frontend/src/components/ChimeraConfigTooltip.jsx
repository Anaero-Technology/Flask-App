import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from './AuthContext';

const ChimeraConfigTooltip = ({ testId, activeTestName, currentChannel, isFlushing, deviceName }) => {
    const { authFetch } = useAuth();
    const { t: tPages } = useTranslation('pages');
    const [config, setConfig] = useState(null);
    const [loading, setLoading] = useState(false);
    const [show, setShow] = useState(false);
    const [showDelay, setShowDelay] = useState(null);

    const fetchConfig = async () => {
        if (!testId || config) return;
        setLoading(true);
        try {
            const response = await authFetch(`/api/v1/tests/${testId}/chimera-configuration`);
            if (response.ok) {
                const data = await response.json();
                setConfig(data);
            }
        } catch (err) {
            console.error('Error fetching test config:', err);
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

    const formatTime = (seconds) => {
        if (!seconds && seconds !== 0) return tPages('chimera_config.na');
        if (seconds < 60) return `${Math.round(seconds)}s`;
        if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
        return `${Math.round(seconds / 3600)}h`;
    };

    const getServiceChannels = (serviceSequence) => {
        if (!serviceSequence) return [];
        return serviceSequence
            .split('')
            .map((isActive, idx) => isActive === '1' ? idx + 1 : null)
            .filter(ch => ch !== null);
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

    if (!show || !config?.chimera_config) {
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

    const chimera = config.chimera_config;
    const serviceChannels = getServiceChannels(chimera.service_sequence);
    const channels = (config.channels || []).filter(channel => serviceChannels.includes(channel.channel_number));
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
                        <div className="text-xs text-gray-500 text-center py-2">{tPages('chimera_config.loading')}</div>
                    ) : (
                        <>
                            {/* Header */}
                            <div className="mb-2 pb-2 border-b border-gray-200">
                                <p className="text-xs font-bold text-gray-900">{config.test_name}</p>
                                <p className="text-xs text-gray-500">{tPages('chimera_config.test_configuration')} - {deviceName}</p>
                            </div>

                            {/* Timing */}
                            <div className="space-y-1 text-xs mb-3 pb-2 border-b border-gray-200">
                                <div className="flex justify-between">
                                    <span className="text-gray-600">{tPages('chimera_config.flush')}:</span>
                                    <span className="font-semibold text-gray-900">{formatTime(chimera.flush_time_seconds)}</span>
                                </div>

                                <div className="flex justify-between">
                                    <span className="text-gray-600">{tPages('chimera_config.recirculation')}:</span>
                                    <span className="font-semibold text-gray-900 capitalize">
                                        {chimera.recirculation_mode === 'off'
                                            ? tPages('chimera_config.off')
                                            : chimera.recirculation_mode === 'periodic'
                                            ? `${formatTime(chimera.recirculation_delay_seconds)}`
                                            : tPages('chimera_config.volume')}
                                    </span>
                                </div>
                            </div>

                            {/* Channels Grouped by Sample with Opening Times */}
                            <div className="pt-2">
                                <p className="text-xs font-semibold text-gray-600 mb-2">
                                    {tPages('chimera_config.channels')} ({serviceChannels.length}/15)
                                </p>
                                <div className="space-y-1.5">
                                    {Object.entries(channelsBySample).map(([sample, chNumbers]) => (
                                        <div key={sample}>
                                            <p className="text-xs font-medium text-gray-700 mb-1 truncate" title={sample}>
                                                {sample}
                                            </p>
                                            <div className="flex flex-wrap gap-1.5">
                                                {chNumbers.map(ch => {
                                                    const channelData = channels.find(c => c.channel_number === ch);
                                                    const openTime = channelData ? formatTime(channelData.open_time_seconds) : tPages('chimera_config.na');
                                                    const volumeThreshold = chimera.recirculation_mode === 'volume' && channelData && channelData.volume_threshold_ml
                                                        ? `${channelData.volume_threshold_ml}mL`
                                                        : '';
                                                    const isActive = ch === currentChannel;
                                                    const status = isFlushing ? 'flushing' : (isActive ? 'reading' : '');

                                                    return (
                                                        <div
                                                            key={ch}
                                                            className={`flex flex-col items-center justify-center px-2 py-1 rounded text-xs font-semibold transition-all ${
                                                                isActive
                                                                    ? status === 'flushing'
                                                                        ? 'bg-orange-200 text-orange-900 border border-orange-400 ring-1 ring-orange-300'
                                                                        : 'bg-green-200 text-green-900 border border-green-400 ring-1 ring-green-300'
                                                                    : 'bg-gray-100 text-gray-600 border border-gray-300'
                                                            }`}
                                                            title={isActive ? (isFlushing ? tPages('device_status.flushing') : tPages('device_status.reading')) : tPages('device_status.idle')}
                                                        >
                                                            <span>{ch}</span>
                                                            <span className="opacity-70 text-xs leading-none">{openTime}</span>
                                                            {volumeThreshold && <span className="opacity-60 text-xs leading-none">{volumeThreshold}</span>}
                                                        </div>
                                                    );
                                                })}
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

export default ChimeraConfigTooltip;
