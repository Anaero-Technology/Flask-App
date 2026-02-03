import React, { useState, useEffect } from "react";
import { useTranslation } from 'react-i18next';
import DeviceCard from '../components/deviceCard';
import ChimeraConfig from '../components/ChimeraConfig';
import ChimeraImage from '../assets/chimera.jpg';
import refreshIcon from '../assets/refresh.svg';
import { useAuth } from '../components/AuthContext';
import { useToast } from '../components/Toast';

function Chimera() {
    const { authFetch } = useAuth();
    const { t: tPages } = useTranslation('pages');
    const toast = useToast();
    const [chimeras, setChimeras] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedDevice, setSelectedDevice] = useState(null);
    const [files, setFiles] = useState([]);
    const [memoryInfo, setMemoryInfo] = useState(null);
    const [loadingFiles, setLoadingFiles] = useState(false);
    const [showFileManager, setShowFileManager] = useState(false);
    const [showConfig, setShowConfig] = useState(false);
    const [loggingStates, setLoggingStates] = useState({});
    const [deviceConfig, setDeviceConfig] = useState({});

    const fetchChimeras = async () => {
        setLoading(true);
        try {
            const response = await authFetch('/api/v1/chimera/connected');
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
            const response = await authFetch(`/api/v1/chimera/${deviceId}/files`);
            if (response.ok) {
                const data = await response.json();
                setFiles(data.files || []);
                setMemoryInfo(data.memory || null);
            } else {
                toast.error(tPages('chimera.failed_fetch_files'));
            }
        } catch (error) {
            console.error('Error fetching files:', error);
            toast.error(tPages('chimera.error_fetch_files'));
        } finally {
            setLoadingFiles(false);
        }
    };

    const fetchDeviceConfig = async (deviceId) => {
        try {
            const response = await authFetch(`/api/v1/chimera/${deviceId}/info`);
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
            const response = await authFetch(`/api/v1/chimera/${selectedDevice.device_id}/download`, {
                method: 'POST',
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
                    toast.error(tPages('chimera.failed_download', { error: data.error }));
                }
            }
        } catch (error) {
            console.error('Download error:', error);
            toast.error(tPages('chimera.download_failed'));
        }
    };

    const deleteFile = async (filename) => {
        if (!confirm(tPages('chimera.delete_confirmation', { filename }))) {
            return;
        }

        try {
            const response = await authFetch(`/api/v1/chimera/${selectedDevice.device_id}/delete_file`, {
                method: 'POST',
                body: JSON.stringify({ filename })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    toast.success(tPages('chimera.file_deleted_success'));
                    fetchFiles(selectedDevice.device_id);
                } else {
                    toast.error(tPages('chimera.failed_delete', { message: data.message }));
                }
            }
        } catch (error) {
            console.error('Delete error:', error);
            toast.error(tPages('chimera.delete_failed'));
        }
    };

    const stopTest = async (testId) => {
        if (!confirm(tPages('chimera.stop_test_confirmation'))) {
            return;
        }

        try {
            const response = await authFetch(`/api/v1/tests/${testId}/stop`, {
                method: 'POST'
            });

            if (response.ok) {
                const data = await response.json();
                toast.success(data.message || tPages('chimera.test_stopped_success'));
                fetchChimeras(); // Refresh to update device states
            } else {
                const errorData = await response.json();
                toast.error(errorData.error || tPages('chimera.failed_stop_test'));
            }
        } catch (error) {
            console.error('Stop test error:', error);
            toast.error(tPages('chimera.failed_stop_test'));
        }
    };

    const toggleLogging = async (deviceId) => {
        const isLogging = loggingStates[deviceId];

        try {
            let response;
            if (isLogging) {
                response = await authFetch(`/api/v1/chimera/${deviceId}/stop_logging`, {
                    method: 'POST',
                    body: JSON.stringify({})
                });
            } else {
                // Start logging - prompt for test name and filename
                const testName = prompt(tPages('chimera.enter_test_name'));
                if (!testName) return;

                let filename = prompt(tPages('chimera.enter_filename'));
                if (!filename) return;

                // Validate filename length (device firmware has limited buffer)
                if (filename.length > 20) {
                    toast.error(tPages('chimera.filename_too_long'));
                    return;
                }

                response = await authFetch(`/api/v1/chimera/${deviceId}/start_logging`, {
                    method: 'POST',
                    body: JSON.stringify({
                        filename,
                        test_name: testName,
                        test_description: `Chimera logging session started from device page`
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
                    toast.success(data.message || (isLogging ? tPages('chimera.logging_stopped') : tPages('chimera.logging_started')));
                    fetchChimeras(); // Refresh to update active_test_id
                } else {
                    toast.error(data.message || tPages('chimera.operation_failed'));
                }
            } else {
                // Handle error responses (like 400 for active test conflict)
                const errorData = await response.json();
                toast.error(errorData.error || tPages('chimera.operation_failed'));
            }
        } catch (error) {
            console.error('Logging toggle error:', error);
            toast.error(tPages('chimera.operation_failed'));
        }
    };

    const updateTiming = async (openTime, flushTime) => {
        try {
            const response = await authFetch(`/api/v1/chimera/${selectedDevice.device_id}/timing`, {
                method: 'POST',
                body: JSON.stringify({ open_time_ms: openTime, flush_time_ms: flushTime })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    toast.success(tPages('chimera.timing_updated_success'));
                    fetchDeviceConfig(selectedDevice.device_id);
                } else {
                    toast.error(tPages('chimera.failed_update_timing', { message: data.message }));
                }
            }
        } catch (error) {
            console.error('Update timing error:', error);
            toast.error(tPages('chimera.failed_update_timing_error'));
        }
    };

    const calibrateSensor = async (sensorNumber, gasPercentage) => {
        try {
            const response = await authFetch(`/api/v1/chimera/${selectedDevice.device_id}/calibrate`, {
                method: 'POST',
                body: JSON.stringify({ sensor_number: sensorNumber, gas_percentage: gasPercentage })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    toast.success(tPages('chimera.sensor_calibrated_success'));
                } else {
                    toast.error(tPages('chimera.failed_calibrate_sensor', { message: data.message }));
                }
            }
        } catch (error) {
            console.error('Calibration error:', error);
            toast.error(tPages('chimera.failed_calibrate_error'));
        }
    };

    const toggleRecirculation = async (enable) => {
        try {
            const endpoint = enable ? 'enable' : 'disable';
            const response = await authFetch(`/api/v1/chimera/${selectedDevice.device_id}/recirculation/${endpoint}`, {
                method: 'POST'
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    toast.success(tPages('chimera.recirculation_updated_success'));
                    fetchDeviceConfig(selectedDevice.device_id);
                } else {
                    toast.error(tPages('chimera.failed_update_recirculation', { message: data.message }));
                }
            }
        } catch (error) {
            console.error('Recirculation error:', error);
            toast.error(tPages('chimera.failed_update_recirculation_error'));
        }
    };

    const updateRecirculationDays = async (days) => {
        try {
            const response = await authFetch(`/api/v1/chimera/${selectedDevice.device_id}/recirculation/days`, {
                method: 'POST',
                body: JSON.stringify({ days: parseInt(days) })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    toast.success(tPages('chimera.recirculation_days_updated_success'));
                    fetchDeviceConfig(selectedDevice.device_id);
                } else {
                    toast.error(tPages('chimera.failed_update_recirculation_days', { message: data.message }));
                }
            }
        } catch (error) {
            console.error('Recirculation days error:', error);
            toast.error(tPages('chimera.failed_update_recirculation_days_error'));
        }
    };

    const updateRecirculationTime = async (hour, minute) => {
        try {
            const response = await authFetch(`/api/v1/chimera/${selectedDevice.device_id}/recirculation/time`, {
                method: 'POST',
                body: JSON.stringify({ hour: parseInt(hour), minute: parseInt(minute) })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    toast.success(tPages('chimera.recirculation_time_updated_success'));
                    fetchDeviceConfig(selectedDevice.device_id);
                } else {
                    toast.error(tPages('chimera.failed_update_recirculation_time', { message: data.message }));
                }
            }
        } catch (error) {
            console.error('Recirculation time error:', error);
            toast.error(tPages('chimera.failed_update_recirculation_time_error'));
        }
    };

    const updateService = async (serviceSequence) => {
        try {
            const response = await authFetch(`/api/v1/chimera/${selectedDevice.device_id}/service`, {
                method: 'POST',
                body: JSON.stringify({ service_sequence: serviceSequence })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    toast.success(tPages('chimera.service_config_updated_success'));
                    fetchDeviceConfig(selectedDevice.device_id);
                } else {
                    toast.error(tPages('chimera.failed_update_service_config', { message: data.message }));
                }
            }
        } catch (error) {
            console.error('Service configuration error:', error);
            toast.error(tPages('chimera.failed_update_service_config_error'));
        }
    };

    useEffect(() => {
        fetchChimeras();
    }, []);

    return (
        <div>
            <h1 className="text-4xl font-bold text-black dark:text-slate-100 pl-6 m-6">{tPages('chimera.title')}</h1>
            <div className="p-6 pt-6">
                {chimeras.length === 0 && !loading && (
                    <div className="text-center text-gray-500 py-8">
                        {tPages('chimera.no_devices')}
                    </div>
                )}

                {chimeras.map((device) => (
                    <div key={device.device_id} className="mb-6">
                        <DeviceCard
                            deviceId={device.device_id}
                            deviceType="chimera"
                            title={tPages('chimera.device_type')}
                            name={device.name}
                            logging={loggingStates[device.device_id]}
                            port={device.port}
                            image={ChimeraImage}
                            onNameUpdate={handleNameUpdate}
                        />

                        {/* Chimera specific controls */}
                        <div className="bg-gray-50 rounded-lg p-4 mt-4">
                            {device.active_test_id && (
                                <div className="mb-3 p-2 bg-yellow-100 border border-yellow-400 rounded text-sm">
                                    <span className="font-semibold">⚠️ {tPages('chimera.active_test_warning', { test_name: device.active_test_name || 'Unknown' })}</span>
                                </div>
                            )}
                            <div className="flex gap-4 flex-wrap">
                                <button
                                    onClick={() => handleFileView(device)}
                                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
                                >
                                    {tPages('chimera.file_view_button')}
                                </button>

                                <button
                                    onClick={() => handleConfigView(device)}
                                    className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 font-medium"
                                >
                                    {tPages('chimera.configure_button')}
                                </button>

                                {device.active_test_id ? (
                                    <button
                                        onClick={() => stopTest(device.active_test_id)}
                                        className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 font-medium"
                                    >
                                        {tPages('chimera.stop_test_button')}
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => toggleLogging(device.device_id)}
                                        className={`px-4 py-2 rounded font-medium ${loggingStates[device.device_id]
                                                ? 'bg-red-600 text-white hover:bg-red-700'
                                                : 'bg-green-600 text-white hover:bg-green-700'
                                            }`}
                                    >
                                        {loggingStates[device.device_id] ? tPages('chimera.stop_logging_button') : tPages('chimera.start_logging_button')}
                                    </button>
                                )}
                            </div>
                        </div>
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
                                {tPages('chimera.files_modal_title', { device_name: selectedDevice?.name })}
                            </h2>
                            <button
                                onClick={() => setShowFileManager(false)}
                                className="text-gray-500 hover:text-gray-700 text-2xl"
                            >
                                ×
                            </button>
                        </div>

                        {loadingFiles ? (
                            <div className="text-center py-8">{tPages('chimera.loading_files')}</div>
                        ) : (
                            <div>
                                {/* SD Card Memory Info */}
                                {memoryInfo && (
                                    <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="text-gray-600">{tPages('chimera.sd_card_storage')}</span>
                                            <span className="font-medium">
                                                {((memoryInfo.total - memoryInfo.used) / (1024 * 1024)).toFixed(1)} {tPages('chimera.memory_free')}
                                                <span className="text-gray-500 ml-1">
                                                    {tPages('chimera.memory_of')} {(memoryInfo.total / (1024 * 1024)).toFixed(1)} {tPages('chimera.memory_total')}
                                                </span>
                                            </span>
                                        </div>
                                        <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                                            <div
                                                className="bg-blue-600 h-2 rounded-full"
                                                style={{ width: `${(memoryInfo.used / memoryInfo.total) * 100}%` }}
                                            />
                                        </div>
                                    </div>
                                )}

                                {files.length === 0 ? (
                                    <div className="text-center text-gray-500 py-8">
                                        {tPages('chimera.no_files')}
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
                                                    {file.created && (
                                                        <span className="text-gray-400 ml-2 text-sm">
                                                            {new Date(file.created * 1000).toLocaleDateString()}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => downloadFile(file.name)}
                                                        className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 font-medium"
                                                    >
                                                        {tPages('chimera.download_button')}
                                                    </button>
                                                    <button
                                                        onClick={() => deleteFile(file.name)}
                                                        className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700 font-medium"
                                                    >
                                                        {tPages('chimera.delete_button')}
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
                                        {tPages('chimera.refresh_files_button')}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Configuration Modal */}
            {showConfig && selectedDevice && (
                <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 w-3/4 max-w-6xl">
                    <div className="bg-white rounded-lg p-6 max-h-[80vh] overflow-y-auto shadow-2xl border">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-2xl font-bold">
                                {tPages('chimera.configure_modal_title', { device_name: selectedDevice?.name })}
                            </h2>
                            <button
                                onClick={() => setShowConfig(false)}
                                className="text-gray-500 hover:text-gray-700 text-2xl"
                            >
                                ×
                            </button>
                        </div>

                        <ChimeraConfig device={{ ...selectedDevice, id: selectedDevice.device_id }} />
                    </div>
                </div>
            )}
        </div>
    );
}

export default Chimera;
