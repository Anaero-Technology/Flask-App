import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings, Clock, RefreshCw, AlertCircle } from 'lucide-react';

const sanitizeIntegerInput = (value) => {
    if (value === '' || value === null || value === undefined) return '';
    return String(value).replace(/\D/g, '');
};

const ChimeraChannelCard = React.memo(function ChimeraChannelCard({
    channelNum,
    isEnabled,
    isSelected,
    settings,
    recirculationMode,
    tPages,
    onToggleService,
    onOpenTimeChange,
    onVolumeChange,
    onSelectMouseDown,
    onSelectClick
}) {
    const baseClass = isEnabled
        ? 'bg-white border-blue-200 shadow-sm'
        : 'bg-gray-50 border-gray-100 opacity-70';
    const selectedClass = isSelected ? 'ring-2 ring-blue-300/60 ring-inset bg-blue-50/40 border-blue-200' : '';

    return (
        <div
            className={`
                flex flex-col gap-2 p-2 rounded border transition-all
                ${baseClass}
                ${selectedClass}
                hover:bg-blue-50/30 hover:border-blue-200/70
            `}
            onMouseDown={(event) => onSelectMouseDown(channelNum, event)}
            onPointerDown={(event) => onSelectMouseDown(channelNum, event)}
            onClick={(event) => onSelectClick(channelNum, event)}
        >
            <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={(event) => onToggleService(channelNum, event.target.checked)}
                        className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className={`text-xs font-bold ${isEnabled ? 'text-gray-800' : 'text-gray-400'}`}>
                        CH {channelNum}
                    </span>
                </label>
            </div>

            <div className="flex items-center gap-1">
                <span className="text-[10px] text-gray-400 uppercase tracking-wide w-8">{tPages('chimera_config.open')}</span>
                <input
                    type="text"
                    inputMode="numeric"
                    value={isEnabled ? (settings.openTime ?? '') : ''}
                    onInput={(e) => onOpenTimeChange(channelNum, sanitizeIntegerInput(e.target.value))}
                    disabled={!isEnabled}
                    className={`
                        w-full px-1.5 py-0.5 border rounded text-xs text-right
                        ${isEnabled
                            ? 'border-gray-300 focus:ring-1 focus:ring-blue-500 focus:border-blue-500'
                            : 'border-transparent bg-transparent text-gray-300'
                        }
                    `}
                />
                <span className="text-[10px] text-gray-400">s</span>
            </div>

            {recirculationMode === 'volume' && (
                <div className="flex items-center gap-1">
                    <span className="text-[10px] text-gray-400 uppercase tracking-wide w-8">{tPages('chimera_config.vol')}</span>
                    <input
                        type="text"
                        inputMode="numeric"
                        value={isEnabled ? (settings.volumeThreshold ?? '') : ''}
                        onInput={(e) => onVolumeChange(channelNum, sanitizeIntegerInput(e.target.value))}
                        disabled={!isEnabled}
                        className={`
                            w-full px-1.5 py-0.5 border rounded text-xs text-right
                            ${isEnabled
                                ? 'border-gray-300 focus:ring-1 focus:ring-blue-500 focus:border-blue-500'
                                : 'border-transparent bg-transparent text-gray-300'
                            }
                        `}
                    />
                    <span className="text-[10px] text-gray-400">mL</span>
                </div>
            )}
        </div>
    );
});

function ChimeraTestConfig({
    flushTime,
    setFlushTime,
    recirculationMode,
    setRecirculationMode,
    recirculationDelaySeconds,
    setRecirculationDelaySeconds,
    serviceSequence,
    setServiceSequence,
    channelSettings,
    setChannelSettings,
    applyAllOpenTime,
    applyAllOpenTimeValue,
    setApplyAllOpenTimeValue,
    hasBlackBoxSelected,
    hasRecirculationSupport = true
}) {
    const { t: tPages } = useTranslation('pages');
    const [selectedChannels, setSelectedChannels] = useState([]);
    const skipChannelClickRef = useRef(false);

    const isMultiSelectEvent = (event) => (
        event?.altKey
        || event?.metaKey
        || event?.shiftKey
        || event?.getModifierState?.('Alt')
        || event?.getModifierState?.('Meta')
        || event?.getModifierState?.('Shift')
    );

    const setServiceChannelState = (channelNumbers, enabled) => {
        setServiceSequence(prev => {
            const arr = prev.split('');
            channelNumbers.forEach(channelNum => {
                const idx = channelNum - 1;
                if (idx >= 0 && idx < arr.length) {
                    arr[idx] = enabled ? '1' : '0';
                }
            });
            return arr.join('');
        });
    };

    const toggleServiceChannel = (channelNum, enabled) => {
        const targets = selectedChannels.length > 1 && selectedChannels.includes(channelNum)
            ? selectedChannels
            : [channelNum];
        setServiceChannelState(targets, enabled);
    };

    const applyChannelSetting = (channelNum, field, value) => {
        const targets = selectedChannels.length > 1 && selectedChannels.includes(channelNum)
            ? selectedChannels
            : [channelNum];
        setChannelSettings(prev => {
            const next = { ...prev };
            targets.forEach(target => {
                next[target] = {
                    ...next[target],
                    [field]: value
                };
            });
            return next;
        });
    };

    const handleSelectMouseDown = (channelNum, event) => {
        if (!isMultiSelectEvent(event)) return;
        skipChannelClickRef.current = true;
        event.preventDefault();
        event.stopPropagation();
        setSelectedChannels(prev => (
            prev.includes(channelNum)
                ? prev.filter(item => item !== channelNum)
                : [...prev, channelNum]
        ));
    };

    const handleSelectClick = (channelNum, event) => {
        if (skipChannelClickRef.current) {
            skipChannelClickRef.current = false;
            return;
        }
        if (!isMultiSelectEvent(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setSelectedChannels(prev => (
            prev.includes(channelNum)
                ? prev.filter(item => item !== channelNum)
                : [...prev, channelNum]
        ));
    };

    const updateChannelSetting = (channelNum, field, value) => {
        applyChannelSetting(channelNum, field, value);
    };

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            {/* Header */}
            <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Settings size={16} className="text-gray-500" />
                    <h2 className="font-semibold text-gray-900 text-sm">{tPages('chimera_config.title')}</h2>
                </div>
            </div>

            <div className="p-4 space-y-4">
                {/* Global Settings - Compact Row */}
                <div className="flex flex-wrap items-start gap-6 text-sm">

                    {/* Flush Time */}
                    <div className="flex items-center gap-3 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
                        <div className="flex items-center gap-2 text-gray-600 font-medium">
                            <Clock size={14} />
                            <span>{tPages('chimera_config.flush')}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min="1"
                                value={flushTime}
                                onChange={(e) => setFlushTime(parseInt(e.target.value) || 30)}
                                className="w-16 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white text-center"
                            />
                            <span className="text-xs text-gray-500">{tPages('chimera_config.sec')}</span>
                        </div>
                    </div>

                    {/* Recirculation Mode */}
                    <div className="flex items-center gap-3 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
                        <div className="flex items-center gap-2 text-gray-600 font-medium">
                            <RefreshCw size={14} />
                            <span>{tPages('chimera_config.recirculation')}</span>
                        </div>
                        <div className="flex bg-white rounded border border-gray-200 p-0.5">
                            {[
                                { id: 'off', label: tPages('chimera_config.off') },
                                { id: 'volume', label: tPages('chimera_config.volume'), disabled: !hasBlackBoxSelected || !hasRecirculationSupport },
                                { id: 'periodic', label: tPages('chimera_config.periodic'), disabled: !hasRecirculationSupport }
                            ].map(mode => (
                                <button
                                    key={mode.id}
                                    onClick={() => !mode.disabled && setRecirculationMode(mode.id)}
                                    disabled={mode.disabled}
                                    className={`
                                        px-3 py-0.5 text-xs font-medium rounded transition-all
                                        ${recirculationMode === mode.id
                                            ? 'bg-blue-50 text-blue-700 shadow-sm ring-1 ring-blue-200'
                                            : mode.disabled
                                                ? 'text-gray-300 cursor-not-allowed'
                                                : 'text-gray-600 hover:bg-gray-100'
                                        }
                                    `}
                                    title={!hasRecirculationSupport && mode.id !== 'off' ? 'Recirculation only available for chimera-max devices' : undefined}
                                >
                                    {mode.label}
                                </button>
                            ))}
                        </div>
                        {(recirculationMode === 'volume' && !hasBlackBoxSelected) && (
                            <span className="text-xs text-amber-600 flex items-center gap-1" title="Requires BlackBox device">
                                <AlertCircle size={12} />
                            </span>
                        )}
                        {(recirculationMode !== 'off' && !hasRecirculationSupport) && (
                            <span className="text-xs text-amber-600 flex items-center gap-1" title="Recirculation only available for chimera-max devices">
                                <AlertCircle size={12} />
                            </span>
                        )}
                    </div>

                    {/* Periodic Delay - Inline */}
                    {recirculationMode === 'periodic' && (
                        <div className="flex items-center gap-4 bg-blue-50 px-3 py-2 rounded-lg border border-blue-100 animate-fadeIn">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-blue-800">{tPages('chimera_config.every')}</span>
                                <input
                                    type="number"
                                    min="0"
                                    value={Math.floor(recirculationDelaySeconds / 3600)}
                                    onChange={(e) => {
                                        const hours = parseInt(e.target.value) || 0;
                                        const currentMinutes = Math.floor((recirculationDelaySeconds % 3600) / 60);
                                        setRecirculationDelaySeconds(hours * 3600 + currentMinutes * 60);
                                    }}
                                    className="w-12 px-1 py-0.5 border border-blue-200 rounded text-center text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                                <span className="text-xs text-blue-800">{tPages('chimera_config.hrs')}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="number"
                                    min="0"
                                    max="59"
                                    value={Math.floor((recirculationDelaySeconds % 3600) / 60)}
                                    onChange={(e) => {
                                        const minutes = parseInt(e.target.value) || 0;
                                        const currentHours = Math.floor(recirculationDelaySeconds / 3600);
                                        setRecirculationDelaySeconds(currentHours * 3600 + minutes * 60);
                                    }}
                                    className="w-12 px-1 py-0.5 border border-blue-200 rounded text-center text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                                <span className="text-xs text-blue-800">{tPages('chimera_config.mins')}</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Channels Grid */}
                <div className="border rounded-lg border-gray-200 overflow-hidden">
                    <div className="bg-gray-50 px-3 py-2 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{tPages('chimera_config.channels')}</h3>

                        {/* Bulk Apply */}
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 hidden sm:inline">{tPages('chimera_config.set_all_open_times')}</span>
                            <div className="flex items-center gap-1">
                                <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={applyAllOpenTimeValue}
                                    onChange={(e) => setApplyAllOpenTimeValue(e.target.value === '' ? '' : parseInt(e.target.value))}
                                    className="w-14 px-1.5 py-0.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    placeholder={tPages('chimera_config.sec')}
                                />
                                <button
                                    type="button"
                                    onClick={() => applyAllOpenTime(applyAllOpenTimeValue)}
                                    className="px-2 py-0.5 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors"
                                >
                                    {tPages('chimera_config.apply_all')}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="p-3 bg-gray-50/30">
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                            {Array.from({ length: 15 }, (_, i) => {
                                const channelNum = i + 1;
                                const isEnabled = serviceSequence[i] === '1';
                                const settings = channelSettings[channelNum] || {};
                                const isSelected = selectedChannels.includes(channelNum);

                                return (
                                    <ChimeraChannelCard
                                        key={channelNum}
                                        channelNum={channelNum}
                                        isEnabled={isEnabled}
                                        isSelected={isSelected}
                                        settings={settings}
                                        recirculationMode={recirculationMode}
                                        tPages={tPages}
                                        onToggleService={toggleServiceChannel}
                                        onOpenTimeChange={(num, value) => updateChannelSetting(num, 'openTime', value)}
                                        onVolumeChange={(num, value) => updateChannelSetting(num, 'volumeThreshold', value)}
                                        onSelectMouseDown={handleSelectMouseDown}
                                        onSelectClick={handleSelectClick}
                                    />
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default ChimeraTestConfig;
