import React from 'react';
import { Settings, Clock, RefreshCw, AlertCircle } from 'lucide-react';

function ChimeraTestConfig({
    flushTime,
    setFlushTime,
    recirculationMode,
    setRecirculationMode,
    recirculationDays,
    setRecirculationDays,
    recirculationHour,
    setRecirculationHour,
    recirculationMinute,
    setRecirculationMinute,
    serviceSequence,
    setServiceSequence,
    channelSettings,
    setChannelSettings,
    applyAllOpenTime,
    applyAllOpenTimeValue,
    setApplyAllOpenTimeValue,
    hasBlackBoxSelected
}) {

    const toggleServiceChannel = (index) => {
        setServiceSequence(prev => {
            const arr = prev.split('');
            arr[index] = arr[index] === '1' ? '0' : '1';
            return arr.join('');
        });
    };

    const updateChannelSetting = (channelNum, field, value) => {
        setChannelSettings(prev => ({
            ...prev,
            [channelNum]: {
                ...prev[channelNum],
                [field]: value
            }
        }));
    };

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            {/* Header */}
            <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Settings size={16} className="text-gray-500" />
                    <h2 className="font-semibold text-gray-900 text-sm">Chimera Settings</h2>
                </div>
            </div>

            <div className="p-4 space-y-4">
                {/* Global Settings - Compact Row */}
                <div className="flex flex-wrap items-start gap-6 text-sm">

                    {/* Flush Time */}
                    <div className="flex items-center gap-3 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
                        <div className="flex items-center gap-2 text-gray-600 font-medium">
                            <Clock size={14} />
                            <span>Flush Time</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min="1"
                                value={flushTime}
                                onChange={(e) => setFlushTime(parseInt(e.target.value) || 30)}
                                className="w-16 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white text-center"
                            />
                            <span className="text-xs text-gray-500">sec</span>
                        </div>
                    </div>

                    {/* Recirculation Mode */}
                    <div className="flex items-center gap-3 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
                        <div className="flex items-center gap-2 text-gray-600 font-medium">
                            <RefreshCw size={14} />
                            <span>Recirculation</span>
                        </div>
                        <div className="flex bg-white rounded border border-gray-200 p-0.5">
                            {[
                                { id: 'off', label: 'Off' },
                                { id: 'volume', label: 'Volume', disabled: !hasBlackBoxSelected },
                                { id: 'periodic', label: 'Periodic' }
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
                                >
                                    {mode.label}
                                </button>
                            ))}
                        </div>
                        {recirculationMode === 'volume' && !hasBlackBoxSelected && (
                            <span className="text-xs text-amber-600 flex items-center gap-1" title="Requires BlackBox device">
                                <AlertCircle size={12} />
                            </span>
                        )}
                    </div>

                    {/* Periodic Schedule - Inline */}
                    {recirculationMode === 'periodic' && (
                        <div className="flex items-center gap-4 bg-blue-50 px-3 py-2 rounded-lg border border-blue-100 animate-fadeIn">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-blue-800">Every</span>
                                <input
                                    type="number"
                                    min="1"
                                    value={recirculationDays}
                                    onChange={(e) => setRecirculationDays(parseInt(e.target.value) || 1)}
                                    className="w-12 px-1 py-0.5 border border-blue-200 rounded text-center text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                                <span className="text-xs text-blue-800">days</span>
                            </div>
                            <div className="w-px h-4 bg-blue-200"></div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-blue-800">At</span>
                                <div className="flex items-center gap-1">
                                    <input
                                        type="number"
                                        min="0"
                                        max="23"
                                        placeholder="HH"
                                        value={recirculationHour}
                                        onChange={(e) => setRecirculationHour(parseInt(e.target.value) || 0)}
                                        className="w-10 px-1 py-0.5 border border-blue-200 rounded text-center text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                    <span className="text-blue-400 font-bold">:</span>
                                    <input
                                        type="number"
                                        min="0"
                                        max="59"
                                        placeholder="MM"
                                        value={recirculationMinute}
                                        onChange={(e) => setRecirculationMinute(parseInt(e.target.value) || 0)}
                                        className="w-10 px-1 py-0.5 border border-blue-200 rounded text-center text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Channels Grid */}
                <div className="border rounded-lg border-gray-200 overflow-hidden">
                    <div className="bg-gray-50 px-3 py-2 border-b border-gray-200 flex items-center justify-between">
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Channel Configuration</h3>

                        {/* Bulk Apply */}
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">Set all open times:</span>
                            <div className="flex items-center gap-1">
                                <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={applyAllOpenTimeValue}
                                    onChange={(e) => setApplyAllOpenTimeValue(e.target.value === '' ? '' : parseInt(e.target.value))}
                                    className="w-14 px-1.5 py-0.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                                <button
                                    type="button"
                                    onClick={() => applyAllOpenTime(applyAllOpenTimeValue)}
                                    className="px-2 py-0.5 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors"
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="p-3 bg-gray-50/30">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2">
                            {Array.from({ length: 15 }, (_, i) => {
                                const channelNum = i + 1;
                                const isEnabled = serviceSequence[i] === '1';
                                const settings = channelSettings[channelNum] || {};

                                return (
                                    <div
                                        key={channelNum}
                                        className={`
                                            flex flex-col gap-2 p-2 rounded border transition-all
                                            ${isEnabled
                                                ? 'bg-white border-blue-200 shadow-sm'
                                                : 'bg-gray-50 border-gray-100 opacity-70'
                                            }
                                        `}
                                    >
                                        <div className="flex items-center justify-between">
                                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                                <input
                                                    type="checkbox"
                                                    checked={isEnabled}
                                                    onChange={() => toggleServiceChannel(i)}
                                                    className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                                />
                                                <span className={`text-xs font-bold ${isEnabled ? 'text-gray-800' : 'text-gray-400'}`}>
                                                    CH {channelNum}
                                                </span>
                                            </label>
                                        </div>

                                        <div className="flex items-center gap-1">
                                            <span className="text-[10px] text-gray-400 uppercase tracking-wide w-8">Open</span>
                                            <input
                                                type="number"
                                                min="1"
                                                step="1"
                                                value={isEnabled ? (settings.openTime || '') : ''}
                                                onChange={(e) => updateChannelSetting(channelNum, 'openTime', e.target.value)}
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
                                                <span className="text-[10px] text-gray-400 uppercase tracking-wide w-8">Vol</span>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    step="1"
                                                    value={isEnabled ? (settings.volumeThreshold || '') : ''}
                                                    onChange={(e) => updateChannelSetting(channelNum, 'volumeThreshold', e.target.value)}
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
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default ChimeraTestConfig;
