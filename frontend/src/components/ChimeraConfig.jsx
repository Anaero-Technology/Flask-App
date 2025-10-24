import React, { useState, useEffect } from 'react';

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
        <div className="mt-4">
            <div className="text-sm font-medium text-gray-700 mb-2">{progress.message}</div>
            <div className="w-full bg-gray-200 rounded-full h-4">
                <div
                    className="bg-orange-600 h-4 rounded-full transition-all duration-100"
                    style={{ width: `${currentProgress}%` }}
                />
            </div>
            <div className="text-xs text-gray-500 mt-1">
                {currentProgress.toFixed(0)}% - {progress.stage}
            </div>
        </div>
    );
}

function ChimeraConfig({ device }) {
    const [deviceConfig, setDeviceConfig] = useState({});
    const [loading, setLoading] = useState(true);
    const [isExpanded, setIsExpanded] = useState(false);
    const [calibrationProgress, setCalibrationProgress] = useState(null);

    useEffect(() => {
        fetchDeviceConfig();

        // Set up SSE connection for calibration progress
        const eventSource = new EventSource(`api/v1/chimera/${device.id}/stream`);

        eventSource.addEventListener('calibration_progress', (event) => {
            const data = JSON.parse(event.data);
            console.log('Calibration progress received:', data);

            // Map stage to message
            let message = '';
            switch (data.stage) {
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

            setCalibrationProgress({
                stage: data.stage,
                message: message,
                time_ms: data.time_ms,
                startTime: Date.now()
            });
        });

        eventSource.onerror = (error) => {
            console.error('SSE Error:', error);
        };

        // Listen for done calibrate to clear progress
        eventSource.addEventListener('message', (event) => {
            if (event.data.includes('done calibrate')) {
                setTimeout(() => setCalibrationProgress(null), 1000);
            }
        });

        return () => {
            eventSource.close();
        };
    }, [device.id]);

    const fetchDeviceConfig = async () => {
        setLoading(true);
        try {
            const config = {};

            // Fetch current service sequence from device
            const serviceResponse = await fetch(`/api/v1/chimera/${device.id}/service`);
            if (serviceResponse.ok) {
                const serviceData = await serviceResponse.json();
                if (serviceData.success) {
                    config.service_sequence = serviceData.service_sequence;
                }
            }

            // Fetch timing from device
            const timingResponse = await fetch(`/api/v1/chimera/${device.id}/timing`);
            if (timingResponse.ok) {
                const timingData = await timingResponse.json();
                if (timingData.success && timingData.timing) {
                    config.open_time = timingData.timing.open_time_ms;
                    config.flush_time = timingData.timing.flush_time_ms;
                }
            }

            // Fetch recirculation info from device
            const recircResponse = await fetch(`/api/v1/chimera/${device.id}/recirculation/info`);
            if (recircResponse.ok) {
                const recircData = await recircResponse.json();
                config.recirculation_enabled = recircData.recirculation_enabled || false;
                config.recirculation_days = recircData.days_between || 1;
                config.recirculation_hour = recircData.hour || 0;
                config.recirculation_minute = recircData.minute || 0;
                config.last_recirculation_date = recircData.last_recirculation_date;
            }

            setDeviceConfig(config);
        } catch (error) {
            console.error('Error fetching device config:', error);
        } finally {
            setLoading(false);
        }
    };

    const updateTiming = async (openTimeMs, flushTimeMs) => {
        try {
            const response = await fetch(`/api/v1/chimera/${device.id}/timing`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
            const response = await fetch(`/api/v1/chimera/${device.id}/calibrate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
            const response = await fetch(`/api/v1/chimera/${device.id}/${endpoint}`, {
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
            const response = await fetch(`/api/v1/chimera/${device.id}/recirculation/days`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
            const response = await fetch(`/api/v1/chimera/${device.id}/recirculation/time`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
            const response = await fetch(`/api/v1/chimera/${device.id}/service`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
            <div className="mb-8 bg-gray-50 rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-4">{device.name} (Chimera)</h3>
                <div className="text-gray-500">Loading configuration...</div>
            </div>
        );
    }

    return (
        <div className="mb-8 bg-gray-50 rounded-lg">
            {/* Collapsible Header */}
            <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-100 rounded-lg transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <h3 className="text-lg font-semibold">{device.name} (Chimera)</h3>
                <svg
                    className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </div>

            {/* Collapsible Content */}
            {isExpanded && (
                <div className="p-4 pt-0">
                    {/* Grid with 2 blocks per row */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                        {/* Timing Configuration */}
                        <div className="bg-white p-4 rounded border border-gray-200">
                            <h4 className="font-semibold mb-3 text-gray-700">Timing Configuration</h4>
                            <div className="text-sm text-gray-600 mb-3">
                                Configure how long valves stay open and the flush duration between measurements.
                            </div>
                            <div className="flex gap-4 items-end flex-wrap">
                                <div>
                                    <label className="block text-sm font-medium mb-1">Open Time (seconds)</label>
                                    <input
                                        type="number"
                                        id={`openTime-${device.id}`}
                                        step="0.1"
                                        min="0.1"
                                        className="border border-gray-300 rounded px-3 py-2 w-32 text-sm"
                                        defaultValue={(deviceConfig.open_time || 1000) / 1000}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">Flush Time (seconds)</label>
                                    <input
                                        type="number"
                                        id={`flushTime-${device.id}`}
                                        step="0.1"
                                        min="0.1"
                                        className="border border-gray-300 rounded px-3 py-2 w-32 text-sm"
                                        defaultValue={(deviceConfig.flush_time || 2000) / 1000}
                                    />
                                </div>
                                <button
                                    onClick={() => {
                                        const openTime = document.getElementById(`openTime-${device.id}`).value;
                                        const flushTime = document.getElementById(`flushTime-${device.id}`).value;
                                        updateTiming(parseInt(openTime * 1000), parseInt(flushTime * 1000));
                                    }}
                                    className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 font-medium"
                                >
                                    Update Timing
                                </button>
                            </div>
                            <div className="mt-2 text-xs text-gray-500">
                                Current: Open {(deviceConfig.open_time || 1000) / 1000}s, Flush {(deviceConfig.flush_time || 2000) / 1000}s
                            </div>
                        </div>

                        {/* Sensor Calibration */}
                        <div className="bg-white p-4 rounded border border-gray-200">
                            <h4 className="font-semibold mb-3 text-gray-700">Sensor Calibration</h4>
                            <div className="text-sm text-gray-600 mb-3">
                                Calibrate gas sensors with a known gas concentration.
                            </div>
                            <div className="flex gap-4 items-end flex-wrap">
                                <div>
                                    <label className="block text-sm font-medium mb-1">Sensor Number (1-8)</label>
                                    <input
                                        type="number"
                                        id={`sensorNumber-${device.id}`}
                                        min="1"
                                        max="8"
                                        className="border border-gray-300 rounded px-3 py-2 w-32 text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">Gas Percentage</label>
                                    <input
                                        type="number"
                                        id={`gasPercentage-${device.id}`}
                                        step="0.1"
                                        className="border border-gray-300 rounded px-3 py-2 w-32 text-sm"
                                    />
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
                                    className="px-4 py-2 bg-orange-600 text-white text-sm rounded hover:bg-orange-700 font-medium"
                                >
                                    Calibrate
                                </button>
                            </div>

                            {/* Calibration Progress Bar */}
                            {calibrationProgress && (
                                <CalibrationProgressBar progress={calibrationProgress} />
                            )}
                        </div>

                        {/* Recirculation Configuration */}
                        <div className="bg-white p-4 rounded border border-gray-200">
                            <h4 className="font-semibold mb-3 text-gray-700">Recirculation Configuration</h4>
                            <div className="text-sm text-gray-600 mb-3">
                                Enable periodic recirculation to mix gas in the headspace during long-term experiments.
                            </div>
                            <div className="space-y-3">
                                {/* Status and Control Buttons */}
                                <div className="flex gap-3 items-center flex-wrap">
                                    <div className="flex gap-2 items-center">
                                        <span className="text-sm font-medium">Status:</span>
                                        <span className={`text-sm font-semibold ${deviceConfig.recirculation_enabled ? 'text-green-600' : 'text-red-600'}`}>
                                            {deviceConfig.recirculation_enabled ? 'Enabled' : 'Disabled'}
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => toggleRecirculation(true)}
                                        className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 font-medium"
                                    >
                                        Enable
                                    </button>
                                    <button
                                        onClick={() => toggleRecirculation(false)}
                                        className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700 font-medium"
                                    >
                                        Disable
                                    </button>
                                </div>

                                {/* Last Recirculation Date */}
                                {deviceConfig.last_recirculation_date && (
                                    <div className="text-xs text-gray-600">
                                        Last recirculation: {deviceConfig.last_recirculation_date.year}/{deviceConfig.last_recirculation_date.month}/{deviceConfig.last_recirculation_date.day}
                                    </div>
                                )}
                                <div className="flex gap-3 items-end">
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Days Between Runs</label>
                                        <input
                                            type="number"
                                            id={`recirculationDays-${device.id}`}
                                            min="1"
                                            className="border border-gray-300 rounded px-3 py-2 w-32 text-sm"
                                            defaultValue={deviceConfig.recirculation_days || 1}
                                        />
                                    </div>
                                    <button
                                        onClick={() => {
                                            const days = document.getElementById(`recirculationDays-${device.id}`).value;
                                            if (days) {
                                                updateRecirculationDays(days);
                                            } else {
                                                alert('Please enter number of days');
                                            }
                                        }}
                                        className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 font-medium"
                                    >
                                        Update Days
                                    </button>
                                </div>
                                <div className="flex gap-3 items-end flex-wrap">
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Hour (0-23)</label>
                                        <input
                                            type="number"
                                            id={`recirculationHour-${device.id}`}
                                            min="0"
                                            max="23"
                                            className="border border-gray-300 rounded px-3 py-2 w-20 text-sm"
                                            defaultValue={deviceConfig.recirculation_hour || 0}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Minute (0-59)</label>
                                        <input
                                            type="number"
                                            id={`recirculationMinute-${device.id}`}
                                            min="0"
                                            max="59"
                                            className="border border-gray-300 rounded px-3 py-2 w-20 text-sm"
                                            defaultValue={deviceConfig.recirculation_minute || 0}
                                        />
                                    </div>
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
                                        className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 font-medium"
                                    >
                                        Update Time
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Service Configuration */}
                        <div className="bg-white p-4 rounded border border-gray-200">
                            <h4 className="font-semibold mb-3 text-gray-700">Service Configuration</h4>
                            <div className="text-sm text-gray-600 mb-3">
                                Enable/disable service for each of the 15 channels.
                            </div>
                            <div className="space-y-3">
                                <div className="grid grid-cols-5 gap-3">
                                    {Array.from({ length: 15 }, (_, i) => {
                                        const channelNum = i + 1;
                                        const currentSequence = deviceConfig.service_sequence || '111111111111111';
                                        const isEnabled = currentSequence[i] === '1';
                                        return (
                                            <div key={channelNum} className="flex items-center space-x-2">
                                                <input
                                                    type="checkbox"
                                                    id={`channel${channelNum}-${device.id}`}
                                                    defaultChecked={isEnabled}
                                                    className="h-4 w-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                                                />
                                                <label
                                                    htmlFor={`channel${channelNum}-${device.id}`}
                                                    className={`text-sm font-medium ${isEnabled ? 'text-green-600' : 'text-red-600'}`}
                                                >
                                                    Ch {channelNum}
                                                </label>
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="flex justify-end items-center pt-2">
                                    <button
                                        onClick={() => {
                                            let sequence = '';
                                            for (let i = 1; i <= 15; i++) {
                                                const checkbox = document.getElementById(`channel${i}-${device.id}`);
                                                sequence += checkbox.checked ? '1' : '0';
                                            }
                                            updateService(sequence);
                                        }}
                                        className="px-4 py-2 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 font-medium"
                                    >
                                        Update Service
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
