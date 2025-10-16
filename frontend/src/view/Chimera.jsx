import React, { useState, useEffect } from "react";
import DeviceCard from '../components/deviceCard';
import ChimeraPlot from '../components/ChimeraPlot';
import ChimeraImage from '../assets/chimera.jpg';
import refreshIcon from '../assets/refresh.svg';

function Chimera() {
    const [chimeras, setChimeras] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedDevice, setSelectedDevice] = useState(null);
    const [files, setFiles] = useState([]);
    const [loadingFiles, setLoadingFiles] = useState(false);
    const [showFileManager, setShowFileManager] = useState(false);
    const [showConfig, setShowConfig] = useState(false);
    const [loggingStates, setLoggingStates] = useState({});
    const [deviceConfig, setDeviceConfig] = useState({});

    const fetchChimeras = async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/v1/chimera/connected');
            if (response.ok) {
                const data = await response.json();
                setChimeras(data);
                
                // Initialize logging states
                const states = {};
                data.forEach(device => {
                    states[device.device_id] = device.logging;
                });
                setLoggingStates(states);
            }
        } catch (error) {
            console.error('Error fetching chimeras:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleNameUpdate = (deviceId, newName) => {
        setChimeras(prevDevices => 
            prevDevices.map(device => 
                device.device_id === deviceId ? { ...device, name: newName } : device
            )
        );
    };

    const fetchFiles = async (deviceId) => {
        setLoadingFiles(true);
        try {
            const response = await fetch(`/api/v1/chimera/${deviceId}/files`);
            if (response.ok) {
                const data = await response.json();
                setFiles(data.files || []);
            } else {
                alert('Failed to fetch files');
            }
        } catch (error) {
            console.error('Error fetching files:', error);
            alert('Error fetching files');
        } finally {
            setLoadingFiles(false);
        }
    };

    const fetchDeviceConfig = async (deviceId) => {
        try {
            const response = await fetch(`/api/v1/chimera/${deviceId}/info`);
            if (response.ok) {
                const data = await response.json();
                setDeviceConfig(data);
            }
        } catch (error) {
            console.error('Error fetching device config:', error);
        }
    };

    const handleFileView = (device) => {
        setSelectedDevice(device);
        setShowFileManager(true);
        fetchFiles(device.device_id);
    };

    const handleConfigView = (device) => {
        setSelectedDevice(device);
        setShowConfig(true);
        fetchDeviceConfig(device.device_id);
    };

    const downloadFile = async (filename) => {
        try {
            const response = await fetch(`/api/v1/chimera/${selectedDevice.device_id}/download`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ filename })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    const fileContent = data.data.join('\n');
                    const blob = new Blob([fileContent], { type: 'text/plain' });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                } else {
                    alert(`Failed to download: ${data.error}`);
                }
            }
        } catch (error) {
            console.error('Download error:', error);
            alert('Download failed');
        }
    };

    const deleteFile = async (filename) => {
        if (!confirm(`Are you sure you want to delete ${filename}?`)) {
            return;
        }

        try {
            const response = await fetch(`/api/v1/chimera/${selectedDevice.device_id}/delete_file`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ filename })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    alert('File deleted successfully');
                    fetchFiles(selectedDevice.device_id);
                } else {
                    alert(`Failed to delete: ${data.message}`);
                }
            }
        } catch (error) {
            console.error('Delete error:', error);
            alert('Delete failed');
        }
    };

    const toggleLogging = async (deviceId) => {
        const isLogging = loggingStates[deviceId];
        
        try {
            let response;
            if (isLogging) {
                response = await fetch(`/api/v1/chimera/${deviceId}/stop_logging`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({})
                });
            } else {
                response = await fetch(`/api/v1/chimera/${deviceId}/start_logging`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        test_name: `Chimera Test - ${new Date().toLocaleString()}`
                    })
                });
            }

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    setLoggingStates(prev => ({
                        ...prev,
                        [deviceId]: !isLogging
                    }));
                    alert(data.message || (isLogging ? 'Logging stopped' : 'Logging started'));
                } else {
                    alert(data.message || 'Operation failed');
                }
            }
        } catch (error) {
            console.error('Logging toggle error:', error);
            alert('Operation failed');
        }
    };

    const updateTiming = async (openTime, flushTime) => {
        try {
            const response = await fetch(`/api/v1/chimera/${selectedDevice.device_id}/timing`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ open_time_ms: openTime, flush_time_ms: flushTime })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    alert('Timing updated successfully');
                    fetchDeviceConfig(selectedDevice.device_id);
                } else {
                    alert(`Failed to update timing: ${data.message}`);
                }
            }
        } catch (error) {
            console.error('Update timing error:', error);
            alert('Failed to update timing');
        }
    };

    const calibrateSensor = async (sensorNumber, gasPercentage) => {
        try {
            const response = await fetch(`/api/v1/chimera/${selectedDevice.device_id}/calibrate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
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
            const endpoint = enable ? 'enable' : 'disable';
            const response = await fetch(`/api/v1/chimera/${selectedDevice.device_id}/recirculation/${endpoint}`, {
                method: 'POST'
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    alert(`Recirculation ${enable ? 'enabled' : 'disabled'} successfully`);
                    fetchDeviceConfig(selectedDevice.device_id);
                } else {
                    alert(`Failed to ${enable ? 'enable' : 'disable'} recirculation: ${data.message}`);
                }
            }
        } catch (error) {
            console.error('Recirculation error:', error);
            alert('Failed to update recirculation');
        }
    };

    const updateRecirculationDays = async (days) => {
        try {
            const response = await fetch(`/api/v1/chimera/${selectedDevice.device_id}/recirculation/days`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ days: parseInt(days) })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    alert('Recirculation days updated successfully');
                    fetchDeviceConfig(selectedDevice.device_id);
                } else {
                    alert(`Failed to update recirculation days: ${data.message}`);
                }
            }
        } catch (error) {
            console.error('Recirculation days error:', error);
            alert('Failed to update recirculation days');
        }
    };

    const updateRecirculationTime = async (hour, minute) => {
        try {
            const response = await fetch(`/api/v1/chimera/${selectedDevice.device_id}/recirculation/time`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ hour: parseInt(hour), minute: parseInt(minute) })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    alert('Recirculation time updated successfully');
                    fetchDeviceConfig(selectedDevice.device_id);
                } else {
                    alert(`Failed to update recirculation time: ${data.message}`);
                }
            }
        } catch (error) {
            console.error('Recirculation time error:', error);
            alert('Failed to update recirculation time');
        }
    };

    const updateService = async (serviceSequence) => {
        try {
            const response = await fetch(`/api/v1/chimera/${selectedDevice.device_id}/service`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ service_sequence: serviceSequence })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    alert('Service configuration updated successfully');
                    fetchDeviceConfig(selectedDevice.device_id);
                } else {
                    alert(`Failed to update service configuration: ${data.message}`);
                }
            }
        } catch (error) {
            console.error('Service configuration error:', error);
            alert('Failed to update service configuration');
        }
    };

    useEffect(() => {
        fetchChimeras();
    }, []);

    return (
        <div>
            <h1 className="text-4xl font-bold text-black pl-6 m-6">Chimera Devices</h1>
            <div className="p-6 pt-6">
                {chimeras.length === 0 && !loading && (
                    <div className="text-center text-gray-500 py-8">
                        No connected Chimera devices found
                    </div>
                )}
                
                {chimeras.map((device) => (
                    <div key={device.device_id} className="mb-6">
                        <DeviceCard 
                            deviceId={device.device_id}
                            deviceType="chimera"
                            title="Chimera" 
                            name={device.name}
                            logging={loggingStates[device.device_id]}
                            port={device.port}
                            image={ChimeraImage}
                            onNameUpdate={handleNameUpdate}
                        />
                        
                        {/* Chimera specific controls */}
                        <div className="bg-gray-50 rounded-lg p-4 mt-4 flex gap-4 flex-wrap">
                            <button
                                onClick={() => handleFileView(device)}
                                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
                            >
                                File View
                            </button>
                            
                            <button
                                onClick={() => handleConfigView(device)}
                                className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 font-medium"
                            >
                                Configure
                            </button>
                            
                            <button
                                onClick={() => toggleLogging(device.device_id)}
                                className={`px-4 py-2 rounded font-medium ${
                                    loggingStates[device.device_id]
                                        ? 'bg-red-600 text-white hover:bg-red-700'
                                        : 'bg-green-600 text-white hover:bg-green-700'
                                }`}
                            >
                                {loggingStates[device.device_id] ? 'Stop Logging' : 'Start Logging'}
                            </button>
                        </div>

                        {/* Real-time Plot Section */}
                        <ChimeraPlot deviceId={device.device_id} />
                    </div>
                ))}
                
                <div className="flex justify-center mt-6">
                    <img 
                        src={refreshIcon}
                        onClick={fetchChimeras}
                        className={`w-8 h-8 cursor-pointer hover:scale-110 transition-transform ${loading ? 'animate-spin' : ''}`}
                        style={{ filter: 'invert(0.4)' }}
                        alt="Refresh"
                    />
                </div>
            </div>

            {/* File Manager Modal */}
            {showFileManager && (
                <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 w-3/4 max-w-4xl">
                    <div className="bg-white rounded-lg p-6 max-h-[80vh] overflow-y-auto shadow-2xl border">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-2xl font-bold">
                                Files on {selectedDevice?.name}
                            </h2>
                            <button
                                onClick={() => setShowFileManager(false)}
                                className="text-gray-500 hover:text-gray-700 text-2xl"
                            >
                                ×
                            </button>
                        </div>
                        
                        {loadingFiles ? (
                            <div className="text-center py-8">Loading files...</div>
                        ) : (
                            <div>
                                {files.length === 0 ? (
                                    <div className="text-center text-gray-500 py-8">
                                        No files found
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {files.map((file, index) => (
                                            <div key={index} className="flex items-center justify-between p-3 border rounded">
                                                <div>
                                                    <span className="font-medium">{file.name}</span>
                                                    <span className="text-gray-500 ml-2">
                                                        ({(file.size / 1024).toFixed(1)} KB)
                                                    </span>
                                                </div>
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => downloadFile(file.name)}
                                                        className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 font-medium"
                                                    >
                                                        Download
                                                    </button>
                                                    <button
                                                        onClick={() => deleteFile(file.name)}
                                                        className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700 font-medium"
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                
                                <div className="mt-6 flex justify-end">
                                    <button
                                        onClick={() => fetchFiles(selectedDevice.device_id)}
                                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
                                    >
                                        Refresh Files
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Configuration Modal */}
            {showConfig && (
                <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 w-3/4 max-w-4xl">
                    <div className="bg-white rounded-lg p-6 max-h-[80vh] overflow-y-auto shadow-2xl border">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-2xl font-bold">
                                Configure {selectedDevice?.name}
                            </h2>
                            <button
                                onClick={() => setShowConfig(false)}
                                className="text-gray-500 hover:text-gray-700 text-2xl"
                            >
                                ×
                            </button>
                        </div>
                        
                        <div className="space-y-6">
                            {/* Device Info */}
                            <div className="bg-gray-50 p-4 rounded">
                                <h3 className="text-lg font-semibold mb-2">Device Information</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>Current Channel: {deviceConfig.current_channel || 'N/A'}</div>
                                    <div>Seconds Elapsed: {deviceConfig.seconds_elapsed || 0}</div>
                                    <div>MAC Address: {deviceConfig.mac_address || 'N/A'}</div>
                                    <div>Logging: {deviceConfig.is_logging ? 'Yes' : 'No'}</div>
                                </div>
                            </div>

                            {/* Timing Configuration */}
                            <div className="bg-gray-50 p-4 rounded">
                                <h3 className="text-lg font-semibold mb-2">Timing Configuration</h3>
                                <div className="flex gap-4 items-end">
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Open Time (seconds)</label>
                                        <input 
                                            type="number" 
                                            id="openTime"
                                            step="0.1"
                                            className="border rounded px-3 py-2 w-32"
                                            defaultValue={(deviceConfig.open_time || 1000) / 1000}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Flush Time (seconds)</label>
                                        <input 
                                            type="number" 
                                            id="flushTime"
                                            step="0.1"
                                            className="border rounded px-3 py-2 w-32"
                                            defaultValue={(deviceConfig.flush_time || 2000) / 1000}
                                        />
                                    </div>
                                    <button
                                        onClick={() => {
                                            const openTime = document.getElementById('openTime').value;
                                            const flushTime = document.getElementById('flushTime').value;
                                            updateTiming(parseInt(openTime * 1000), parseInt(flushTime * 1000));
                                        }}
                                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
                                    >
                                        Update Timing
                                    </button>
                                </div>
                            </div>

                            {/* Sensor Calibration */}
                            <div className="bg-gray-50 p-4 rounded">
                                <h3 className="text-lg font-semibold mb-2">Sensor Calibration</h3>
                                <div className="flex gap-4 items-end">
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Sensor Number (1-8)</label>
                                        <input 
                                            type="number" 
                                            id="sensorNumber"
                                            min="1"
                                            max="8"
                                            className="border rounded px-3 py-2 w-32"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Gas Percentage</label>
                                        <input 
                                            type="number" 
                                            id="gasPercentage"
                                            step="0.1"
                                            className="border rounded px-3 py-2 w-32"
                                        />
                                    </div>
                                    <button
                                        onClick={() => {
                                            const sensorNumber = document.getElementById('sensorNumber').value;
                                            const gasPercentage = document.getElementById('gasPercentage').value;
                                            if (sensorNumber && gasPercentage) {
                                                calibrateSensor(parseInt(sensorNumber), parseFloat(gasPercentage));
                                            } else {
                                                alert('Please enter both sensor number and gas percentage');
                                            }
                                        }}
                                        className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 font-medium"
                                    >
                                        Calibrate
                                    </button>
                                </div>
                            </div>

                            {/* Recirculation Configuration */}
                            <div className="bg-gray-50 p-4 rounded">
                                <h3 className="text-lg font-semibold mb-2">Recirculation Configuration</h3>
                                <div className="space-y-4">
                                    <div className="flex gap-4 items-center">
                                        <span className="text-sm font-medium">Status: {deviceConfig.recirculation_enabled ? 'Enabled' : 'Disabled'}</span>
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
                                    <div className="flex gap-4 items-end">
                                        <div>
                                            <label className="block text-sm font-medium mb-1">Days Between Runs</label>
                                            <input 
                                                type="number" 
                                                id="recirculationDays"
                                                min="1"
                                                className="border rounded px-3 py-2 w-32"
                                                defaultValue={deviceConfig.recirculation_days || 1}
                                            />
                                        </div>
                                        <button
                                            onClick={() => {
                                                const days = document.getElementById('recirculationDays').value;
                                                if (days) {
                                                    updateRecirculationDays(days);
                                                } else {
                                                    alert('Please enter number of days');
                                                }
                                            }}
                                            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
                                        >
                                            Update Days
                                        </button>
                                    </div>
                                    <div className="flex gap-4 items-end">
                                        <div>
                                            <label className="block text-sm font-medium mb-1">Hour (0-23)</label>
                                            <input 
                                                type="number" 
                                                id="recirculationHour"
                                                min="0"
                                                max="23"
                                                className="border rounded px-3 py-2 w-20"
                                                defaultValue={deviceConfig.recirculation_hour || 0}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium mb-1">Minute (0-59)</label>
                                            <input 
                                                type="number" 
                                                id="recirculationMinute"
                                                min="0"
                                                max="59"
                                                className="border rounded px-3 py-2 w-20"
                                                defaultValue={deviceConfig.recirculation_minute || 0}
                                            />
                                        </div>
                                        <button
                                            onClick={() => {
                                                const hour = document.getElementById('recirculationHour').value;
                                                const minute = document.getElementById('recirculationMinute').value;
                                                if (hour !== '' && minute !== '') {
                                                    updateRecirculationTime(hour, minute);
                                                } else {
                                                    alert('Please enter both hour and minute');
                                                }
                                            }}
                                            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
                                        >
                                            Update Time
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Service Configuration */}
                            <div className="bg-gray-50 p-4 rounded">
                                <h3 className="text-lg font-semibold mb-2">Service Configuration</h3>
                                <div className="space-y-4">
                                    <div className="text-sm text-gray-600">
                                        Enable/disable service for each channel:
                                    </div>
                                    <div className="grid grid-cols-5 gap-3">
                                        {Array.from({ length: 15 }, (_, i) => {
                                            const channelNum = i + 1;
                                            const currentSequence = deviceConfig.service_sequence || '111111111111111';
                                            const isEnabled = currentSequence[i] === '1';
                                            return (
                                                <div key={channelNum} className="flex items-center space-x-2">
                                                    <input
                                                        type="checkbox"
                                                        id={`channel${channelNum}`}
                                                        defaultChecked={isEnabled}
                                                        className="h-4 w-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                                                    />
                                                    <label 
                                                        htmlFor={`channel${channelNum}`}
                                                        className="text-sm font-medium text-gray-700"
                                                    >
                                                        Ch {channelNum}
                                                    </label>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <div className="text-xs text-gray-500">
                                            Select which channels should have service enabled
                                        </div>
                                        <button
                                            onClick={() => {
                                                let sequence = '';
                                                for (let i = 1; i <= 15; i++) {
                                                    const checkbox = document.getElementById(`channel${i}`);
                                                    sequence += checkbox.checked ? '1' : '0';
                                                }
                                                updateService(sequence);
                                            }}
                                            className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 font-medium"
                                        >
                                            Update Service
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Chimera;