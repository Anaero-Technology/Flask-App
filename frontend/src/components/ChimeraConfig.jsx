import React, { useState, useEffect } from 'react';
import { ChevronDown, Clock, Settings, RefreshCw, Activity, Server, Save, Play } from 'lucide-react';
import { useCalibration } from './ChimeraContext';
import { useAuth } from './AuthContext';

// Calibration Progress Bar Component
function CalibrationProgressBar({ progress }) {
    const [currentProgress, setCurrentProgress] = useState(0);

    useEffect(() => {
        // Reset progress when stage changes
        setCurrentProgress(0);

        if (progress.time_ms > 0) {
            const startTime = progress.startTime;
            const duration = progress.time_ms;

            const interval = setInterval(() => {
                const elapsed = Date.now() - startTime;
                const progressPercent = Math.min((elapsed / duration) * 100, 100);
                setCurrentProgress(progressPercent);

                if (progressPercent >= 100) {
                    clearInterval(interval);
                }
            }, 50); // Update every 50ms for smooth animation

            return () => clearInterval(interval);
        }
    }, [progress.stage, progress.time_ms, progress.startTime]);

    return (
        <div className="mt-4 bg-orange-50 p-4 rounded-lg border border-orange-100">
            <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-orange-800 flex items-center gap-2">
                    <Activity size={16} className="animate-pulse" />
                    {progress.message}
                </div>
                <div className="text-xs font-bold text-orange-600">
                    {currentProgress.toFixed(0)}%
                </div>
            </div>
            <div className="w-full bg-orange-200 rounded-full h-2 overflow-hidden">
                <div
                    className="bg-orange-500 h-2 rounded-full transition-all duration-100 ease-out"
                    style={{ width: `${currentProgress}%` }}
                />
            </div>
            <div className="text-xs text-orange-600 mt-2 font-mono">
                Stage: {progress.stage}
            </div>
        </div>
    );
}

function ChimeraConfig({ device }) {
    const { authFetch } = useAuth();
    const [deviceConfig, setDeviceConfig] = useState({});
    const [loading, setLoading] = useState(true);
    const [isExpanded, setIsExpanded] = useState(false);
    const [serviceSequence, setServiceSequence] = useState('111111111111111');
    // Per-channel settings: { 1: { openTime: 1 }, 2: {...}, ... }
    const [channelSettings, setChannelSettings] = useState({});

    // Use global calibration context for SSE updates
    const { subscribeToDevice, calibrationStates } = useCalibration();
    // Local state for immediate display while context loads
    const [localCalibrationProgress, setLocalCalibrationProgress] = useState(null);

    // Use context state if available, otherwise use local state
    const calibrationProgress = calibrationStates[device.id] || localCalibrationProgress;

    // Fetch calibration state directly on mount for immediate display
    useEffect(() => {
        const fetchCalibrationState = async () => {
            try {
                const response = await authFetch(`/api/v1/chimera/${device.id}/sensor_info`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.is_calibrating) {
                        let message = '';
                        switch (data.is_calibrating.stage) {
                            case 'starting':
                                message = 'Flushing sensor to get zero value';
                                break;
                            case 'opening':
                                message = 'Opening sensor for gas accumulation';
                                break;
                            case 'info':
                                message = 'Accumulating gas';
                                break;
                            case 'reading':
                                message = 'Reading sensor values';
                                break;
                            case 'finishing':
                                message = 'Flushing sensor to finish';
                                break;
                            default:
                                message = 'Calibrating...';
                        }
                        setLocalCalibrationProgress({
                            stage: data.is_calibrating.stage,
                            message: message,
                            time_ms: data.is_calibrating.time_ms || 0,
                            startTime: Date.now()
                        });
                    }
                }
            } catch (err) {
                console.error('Failed to fetch calibration state:', err);
            }
        };

        fetchDeviceConfig();
        fetchCalibrationState();
        // Subscribe to SSE for this device (handled globally by context)
        subscribeToDevice(device.id);
    }, [device.id]);

    const fetchDeviceConfig = async () => {
        setLoading(true);
        try {
            const config = {};

            // Fetch current service sequence from device
            const serviceResponse = await authFetch(`/api/v1/chimera/${device.id}/service`);
            if (serviceResponse.ok) {
                const serviceData = await serviceResponse.json();
                if (serviceData.success) {
                    config.service_sequence = serviceData.service_sequence;
                }
            }

            // Fetch timing from device
            const timingResponse = await authFetch(`/api/v1/chimera/${device.id}/timing`);
            if (timingResponse.ok) {
                const timingData = await timingResponse.json();
                if (timingData.success && timingData.timing) {
                    const channelTimes = timingData.timing.channel_times_ms || [];
                    config.open_time = channelTimes[0] || 600000;
                    config.channel_times_ms = channelTimes;
                    config.flush_time = timingData.timing.flush_time_ms;
                }
            }

            // Fetch recirculation info from device
            const recircResponse = await authFetch(`/api/v1/chimera/${device.id}/recirculation/info`);
            if (recircResponse.ok) {
                const recircData = await recircResponse.json();
                config.recirculation_enabled = recircData.recirculation_enabled || false;
                config.recirculation_days = recircData.days_between || 1;
                config.recirculation_hour = recircData.hour || 0;
                config.recirculation_minute = recircData.minute || 0;
                config.last_recirculation_date = recircData.last_recirculation_date;
            }

            setDeviceConfig(config);
            if (config.service_sequence) {
                setServiceSequence(config.service_sequence);
            }
        } catch (error) {
            console.error('Error fetching device config:', error);
        } finally {
            setLoading(false);
        }
    };

    const toggleChannel = (index) => {
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

    const updateTiming = async (openTimeMs, flushTimeMs) => {
        try {
            const response = await authFetch(`/api/v1/chimera/${device.id}/timing`, {
                method: 'POST',
                body: JSON.stringify({ open_time_ms: openTimeMs, flush_time_ms: flushTimeMs })
            });

            if (response.ok) {
                const data = await response.json();
                alert(data.message || 'Timing updated successfully');
                fetchDeviceConfig();
            } else {
                const errorData = await response.json();
                alert(errorData.error || 'Failed to update timing');
            }
        } catch (error) {
            console.error('Error updating timing:', error);
            alert('Failed to update timing');
        }
    };

    const calibrateSensor = async (sensorNumber, gasPercentage) => {
        try {
            const response = await authFetch(`/api/v1/chimera/${device.id}/calibrate`, {
                method: 'POST',
                body: JSON.stringify({ sensor_number: sensorNumber, gas_percentage: gasPercentage })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    alert('Sensor calibrated successfully');
                } else {
                    alert(`Failed to calibrate sensor: ${data.message}`);
                }
            }
        } catch (error) {
            console.error('Calibration error:', error);
            alert('Failed to calibrate sensor');
        }
    };

    const toggleRecirculation = async (enable) => {
        try {
            const endpoint = enable ? 'recirculation/enable' : 'recirculation/disable';
            const response = await authFetch(`/api/v1/chimera/${device.id}/${endpoint}`, {
                method: 'POST'
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    alert(data.message || `Recirculation ${enable ? 'enabled' : 'disabled'}`);
                    // Update the config state immediately
                    setDeviceConfig(prev => ({
                        ...prev,
                        recirculation_enabled: enable
                    }));
                } else {
                    alert(data.message || 'Failed to update recirculation');
                }
            } else {
                const errorData = await response.json();
                alert(errorData.error || 'Failed to update recirculation');
            }
        } catch (error) {
            console.error('Error toggling recirculation:', error);
            alert('Failed to update recirculation');
        }
    };

    const updateRecirculationDays = async (days) => {
        try {
            const response = await authFetch(`/api/v1/chimera/${device.id}/recirculation/days`, {
                method: 'POST',
                body: JSON.stringify({ days: parseInt(days) })
            });

            if (response.ok) {
                const data = await response.json();
                alert(data.message || 'Recirculation days updated');
                fetchDeviceConfig();
            } else {
                const errorData = await response.json();
                alert(errorData.error || 'Failed to update days');
            }
        } catch (error) {
            console.error('Error updating days:', error);
            alert('Failed to update days');
        }
    };

    const updateRecirculationTime = async (hour, minute) => {
        try {
            const response = await authFetch(`/api/v1/chimera/${device.id}/recirculation/time`, {
                method: 'POST',
                body: JSON.stringify({ hour: parseInt(hour), minute: parseInt(minute) })
            });

            if (response.ok) {
                const data = await response.json();
                alert(data.message || 'Recirculation time updated');
                fetchDeviceConfig();
            } else {
                const errorData = await response.json();
                alert(errorData.error || 'Failed to update time');
            }
        } catch (error) {
            console.error('Error updating time:', error);
            alert('Failed to update time');
        }
    };

    const updateService = async (serviceSequence) => {
        try {
            const response = await authFetch(`/api/v1/chimera/${device.id}/service`, {
                method: 'POST',
                body: JSON.stringify({ service_sequence: serviceSequence })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    alert('Service configuration updated successfully');
                    fetchDeviceConfig();
                } else {
                    alert(`Failed to update service: ${data.message}`);
                }
            }
        } catch (error) {
            console.error('Service configuration error:', error);
            alert('Failed to update service configuration');
        }
    };

    if (loading) {
        return (
            <div className="mb-8 bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
                <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
                <div className="h-4 bg-gray-100 rounded w-1/2"></div>
            </div>
        );
    }

    return (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm transition-all hover:shadow-md">
            {/* Collapsible Header */}
            <div
                className="flex items-center justify-between p-4 bg-gray-50 cursor-pointer border-b border-gray-100 hover:bg-gray-100 transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-orange-100 text-orange-600 rounded-lg">
                        <Server size={20} />
                    </div>
                    <div>
                        <h3 className="font-semibold text-gray-900">{device.name}</h3>
                        <p className="text-xs text-gray-500">Chimera Control Unit</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className={`p-1 rounded-full transition-transform duration-200 ${isExpanded ? 'bg-gray-200 rotate-180' : 'bg-transparent'}`}>
                        <ChevronDown size={20} className="text-gray-500" />
                    </div>
                </div>
            </div>

            {/* Collapsible Content */}
            {isExpanded && (
                <div className="p-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                        {/* Timing Configuration */}
                        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100">
                                <Clock size={18} className="text-blue-500" />
                                <h4 className="font-semibold text-gray-900">Timing Configuration</h4>
                            </div>

                            <div className="grid grid-cols-2 gap-4 mb-4">
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">Open Time (s)</label>
                                    <input
                                        type="number"
                                        id={`openTime-${device.id}`}
                                        step="0.1"
                                        min="0.1"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                                        defaultValue={(deviceConfig.open_time || 1000) / 1000}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">Flush Time (s)</label>
                                    <input
                                        type="number"
                                        id={`flushTime-${device.id}`}
                                        step="0.1"
                                        min="0.1"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                                        defaultValue={(deviceConfig.flush_time || 2000) / 1000}
                                    />
                                </div>
                            </div>

                            <button
                                onClick={() => {
                                    const openTime = document.getElementById(`openTime-${device.id}`).value;
                                    const flushTime = document.getElementById(`flushTime-${device.id}`).value;
                                    updateTiming(parseInt(openTime * 1000), parseInt(flushTime * 1000));
                                }}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                            >
                                <Save size={16} />
                                Update Timing
                            </button>
                        </div>

                        {/* Sensor Calibration */}
                        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100">
                                <Settings size={18} className="text-orange-500" />
                                <h4 className="font-semibold text-gray-900">Sensor Calibration</h4>
                            </div>

                            <div className="grid grid-cols-2 gap-4 mb-4">
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">Sensor (1-8)</label>
                                    <input
                                        type="number"
                                        id={`sensorNumber-${device.id}`}
                                        min="1"
                                        max="8"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">Gas %</label>
                                    <input
                                        type="number"
                                        id={`gasPercentage-${device.id}`}
                                        step="0.1"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all text-sm"
                                    />
                                </div>
                            </div>

                            <button
                                onClick={() => {
                                    const sensorNumber = document.getElementById(`sensorNumber-${device.id}`).value;
                                    const gasPercentage = document.getElementById(`gasPercentage-${device.id}`).value;
                                    if (sensorNumber && gasPercentage) {
                                        calibrateSensor(parseInt(sensorNumber), parseFloat(gasPercentage));
                                    } else {
                                        alert('Please enter both sensor number and gas percentage');
                                    }
                                }}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700 transition-colors"
                            >
                                <Play size={16} />
                                Start Calibration
                            </button>

                            {/* Calibration Progress Bar */}
                            {calibrationProgress && (
                                <CalibrationProgressBar progress={calibrationProgress} />
                            )}
                        </div>

                        {/* Chimera Recirculation Settings */}
                        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm lg:col-span-2">
                            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
                                <div className="flex items-center gap-2">
                                    <RefreshCw size={18} className="text-green-500" />
                                    <h4 className="font-semibold text-gray-900">Recirculation Settings</h4>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${deviceConfig.recirculation_enabled ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                        {deviceConfig.recirculation_enabled ? 'ENABLED' : 'DISABLED'}
                                    </span>
                                    <button
                                        onClick={() => toggleRecirculation(!deviceConfig.recirculation_enabled)}
                                        className={`text-xs px-3 py-1 rounded-lg font-medium transition-colors ${deviceConfig.recirculation_enabled
                                                ? 'bg-red-50 text-red-600 hover:bg-red-100'
                                                : 'bg-green-50 text-green-600 hover:bg-green-100'
                                            }`}
                                    >
                                        {deviceConfig.recirculation_enabled ? 'Disable' : 'Enable'}
                                    </button>
                                </div>
                            </div>

                            {/* Periodic Schedule Settings */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                                {/* Frequency */}
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">Frequency (Days)</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="number"
                                            id={`recirculationDays-${device.id}`}
                                            min="1"
                                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-sm"
                                            defaultValue={deviceConfig.recirculation_days || 1}
                                        />
                                        <button
                                            onClick={() => {
                                                const days = document.getElementById(`recirculationDays-${device.id}`).value;
                                                if (days) {
                                                    updateRecirculationDays(days);
                                                } else {
                                                    alert('Please enter number of days');
                                                }
                                            }}
                                            className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
                                        >
                                            Set
                                        </button>
                                    </div>
                                    {deviceConfig.last_recirculation_date && (
                                        <p className="text-xs text-gray-400 mt-2">
                                            Last run: {deviceConfig.last_recirculation_date.year}/{deviceConfig.last_recirculation_date.month}/{deviceConfig.last_recirculation_date.day}
                                        </p>
                                    )}
                                </div>

                                {/* Schedule Time */}
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">Schedule Time (HH:MM)</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="number"
                                            id={`recirculationHour-${device.id}`}
                                            min="0"
                                            max="23"
                                            placeholder="HH"
                                            className="w-20 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-sm"
                                            defaultValue={deviceConfig.recirculation_hour || 0}
                                        />
                                        <span className="self-center text-gray-400">:</span>
                                        <input
                                            type="number"
                                            id={`recirculationMinute-${device.id}`}
                                            min="0"
                                            max="59"
                                            placeholder="MM"
                                            className="w-20 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-sm"
                                            defaultValue={deviceConfig.recirculation_minute || 0}
                                        />
                                        <button
                                            onClick={() => {
                                                const hour = document.getElementById(`recirculationHour-${device.id}`).value;
                                                const minute = document.getElementById(`recirculationMinute-${device.id}`).value;
                                                if (hour !== '' && minute !== '') {
                                                    updateRecirculationTime(hour, minute);
                                                } else {
                                                    alert('Please enter both hour and minute');
                                                }
                                            }}
                                            className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
                                        >
                                            Set
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Channel Selection - always visible */}
                            <div className="border-t border-gray-100 pt-4">
                                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                                    Channels in Service
                                </label>
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-3 mb-4">
                                    {Array.from({ length: 15 }, (_, i) => {
                                        const channelNum = i + 1;
                                        const isEnabled = serviceSequence[i] === '1';
                                        const settings = channelSettings[channelNum] || {};
                                        return (
                                            <div
                                                key={channelNum}
                                                className={`p-3 rounded-lg border transition-colors ${
                                                    isEnabled
                                                        ? 'border-green-300 bg-green-50'
                                                        : 'border-gray-200 bg-gray-50'
                                                }`}
                                            >
                                                <label className="flex items-center gap-2 cursor-pointer mb-2">
                                                    <input
                                                        type="checkbox"
                                                        checked={isEnabled}
                                                        onChange={() => toggleChannel(i)}
                                                        className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
                                                    />
                                                    <span className="text-sm font-semibold text-gray-700">CH {channelNum}</span>
                                                </label>
                                                {isEnabled && (
                                                    <div className="pl-6">
                                                        <label className="block text-xs text-gray-500 mb-1">Open Time (s)</label>
                                                        <input
                                                            type="number"
                                                            min="0.1"
                                                            step="0.1"
                                                            value={settings.openTime || ''}
                                                            onChange={(e) => updateChannelSetting(channelNum, 'openTime', e.target.value)}
                                                            placeholder="e.g., 1"
                                                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="flex justify-end">
                                    <button
                                        onClick={() => updateService(serviceSequence)}
                                        className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
                                    >
                                        <Save size={16} />
                                        Save Channel Selection
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default ChimeraConfig;
