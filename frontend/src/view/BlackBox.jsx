import React, { useState, useEffect } from "react";
import { useTranslation } from 'react-i18next';
import DeviceCard from '../components/deviceCard';
import GFM from '../assets/gfm.png';
import refreshIcon from '../assets/refresh.svg';
import { useAuth } from '../components/AuthContext';
import { useToast } from '../components/Toast';

function BlackBox() {
    const { authFetch } = useAuth();
    const { t: tPages } = useTranslation('pages');
    const toast = useToast();
    const [blackBoxes, setBlackBoxes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedDevice, setSelectedDevice] = useState(null);
    const [files, setFiles] = useState([]);
    const [loadingFiles, setLoadingFiles] = useState(false);
    const [showFileManager, setShowFileManager] = useState(false);
    const [loggingStates, setLoggingStates] = useState({});

    const fetchBlackBoxes = async () => {
        setLoading(true);
        try {
            const response = await authFetch('/api/v1/black_box/connected');
            if (response.ok) {
                const data = await response.json();
                setBlackBoxes(data);
                
                // Initialize logging states
                const states = {};
                data.forEach(device => {
                    states[device.device_id] = device.logging;
                });
                setLoggingStates(states);
            }
        } catch (error) {
            console.error('Error fetching blackboxes:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleNameUpdate = (deviceId, newName) => {
        setBlackBoxes(prevDevices => 
            prevDevices.map(device => 
                device.device_id === deviceId ? { ...device, name: newName } : device
            )
        );
    };

    const fetchFiles = async (deviceId) => {
        setLoadingFiles(true);
        try {
            const response = await authFetch(`/api/v1/black_box/${deviceId}/files`);
            if (response.ok) {
                const data = await response.json();
                setFiles(data.files || []);
            } else {
                toast.error(tPages('black_box.failed_fetch_files'));
            }
        } catch (error) {
            console.error('Error fetching files:', error);
            toast.error(tPages('black_box.error_fetch_files'));
        } finally {
            setLoadingFiles(false);
        }
    };

    const handleFileView = (device) => {
        setSelectedDevice(device);
        setShowFileManager(true);
        fetchFiles(device.device_id);
    };

    const downloadFile = async (filename) => {
        try {
            const response = await authFetch(`/api/v1/black_box/${selectedDevice.device_id}/download`, {
                method: 'POST',
                body: JSON.stringify({ filename })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    // Create downloadable file
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
                    toast.error(tPages('black_box.failed_download', { error: data.error }));
                }
            }
        } catch (error) {
            console.error('Download error:', error);
            toast.error(tPages('black_box.download_failed'));
        }
    };

    const deleteFile = async (filename) => {
        if (!confirm(tPages('black_box.delete_confirmation', { filename }))) {
            return;
        }

        try {
            const response = await authFetch(`/api/v1/black_box/${selectedDevice.device_id}/delete_file`, {
                method: 'POST',
                body: JSON.stringify({ filename })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    toast.success(tPages('black_box.file_deleted_success'));
                    fetchFiles(selectedDevice.device_id); // Refresh file list
                } else {
                    toast.error(tPages('black_box.failed_delete', { message: data.message }));
                }
            }
        } catch (error) {
            console.error('Delete error:', error);
            toast.error(tPages('black_box.delete_failed'));
        }
    };

    const stopTest = async (testId) => {
        if (!confirm(tPages('black_box.stop_test_confirmation'))) {
            return;
        }

        try {
            const response = await authFetch(`/api/v1/tests/${testId}/stop`, {
                method: 'POST'
            });

            if (response.ok) {
                const data = await response.json();
                toast.success(data.message || tPages('black_box.test_stopped_success'));
                fetchBlackBoxes(); // Refresh to update device states
            } else {
                const errorData = await response.json();
                toast.error(errorData.error || tPages('black_box.failed_stop_test'));
            }
        } catch (error) {
            console.error('Stop test error:', error);
            toast.error(tPages('black_box.failed_stop_test'));
        }
    };

    const toggleLogging = async (deviceId) => {
        const isLogging = loggingStates[deviceId];

        try {
            let response;
            if (isLogging) {
                // Stop logging
                response = await authFetch(`/api/v1/black_box/${deviceId}/stop_logging`, {
                    method: 'POST'
                });
            } else {
                // Start logging - prompt for test name and filename
                const testName = prompt(tPages('black_box.enter_test_name'));
                if (!testName) return;

                let filename = prompt(tPages('black_box.enter_filename'));
                if (!filename) return;

                // Validate filename length (device firmware has limited buffer)
                if (filename.length > 20) {
                    toast.error(tPages('black_box.filename_too_long'));
                    return;
                }

                response = await authFetch(`/api/v1/black_box/${deviceId}/start_logging`, {
                    method: 'POST',
                    body: JSON.stringify({
                        filename,
                        test_name: testName,
                        test_description: `BlackBox logging session started from device page`
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
                    toast.success(data.message || (isLogging ? tPages('black_box.logging_stopped') : tPages('black_box.logging_started')));
                    fetchBlackBoxes(); // Refresh to update active_test_id
                } else {
                    toast.error(data.message || tPages('black_box.operation_failed'));
                }
            } else {
                // Handle error responses (like 400 for active test conflict)
                const errorData = await response.json();
                toast.error(errorData.error || tPages('black_box.operation_failed'));
            }
        } catch (error) {
            console.error('Logging toggle error:', error);
            toast.error(tPages('black_box.operation_failed'));
        }
    };

    useEffect(() => {
        fetchBlackBoxes();
    }, []);

    return (
        <div>
            <h1 className="text-4xl font-bold text-black dark:text-slate-100 pl-6 m-6">{tPages('black_box.title')}</h1>
            <div className="p-6 pt-6">
                {blackBoxes.length === 0 && !loading && (
                    <div className="text-center text-gray-500 py-8">
                        {tPages('black_box.no_devices')}
                    </div>
                )}
                
                {blackBoxes.map((device) => (
                    <div key={device.device_id} className="mb-6">
                        <DeviceCard
                            deviceId={device.device_id}
                            deviceType="black-box"
                            title={tPages('black_box.device_type')}
                            name={device.name}
                            logging={loggingStates[device.device_id]}
                            port={device.port}
                            image={GFM}
                            onNameUpdate={handleNameUpdate}
                        />

                        {/* BlackBox specific controls */}
                        <div className="bg-gray-50 rounded-lg p-4 mt-4">
                            {device.active_test_id && (
                                <div className="mb-3 p-2 bg-yellow-100 border border-yellow-400 rounded text-sm">
                                    <span className="font-semibold">⚠️ {tPages('black_box.active_test_warning', { test_name: device.active_test_name || 'Unknown' })}</span>
                                </div>
                            )}
                            <div className="flex gap-4">
                                <button
                                    onClick={() => handleFileView(device)}
                                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
                                >
                                    {tPages('black_box.file_view_button')}
                                </button>

                                {device.active_test_id ? (
                                    <button
                                        onClick={() => stopTest(device.active_test_id)}
                                        className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 font-medium"
                                    >
                                        {tPages('black_box.stop_test_button')}
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => toggleLogging(device.device_id)}
                                        className={`px-4 py-2 rounded font-medium ${
                                            loggingStates[device.device_id]
                                                ? 'bg-red-600 text-white hover:bg-red-700'
                                                : 'bg-green-600 text-white hover:bg-green-700'
                                        }`}
                                    >
                                        {loggingStates[device.device_id] ? tPages('black_box.stop_logging_button') : tPages('black_box.start_logging_button')}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
                
                <div className="flex justify-center mt-6">
                    <img 
                        src={refreshIcon}
                        onClick={fetchBlackBoxes}
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
                                {tPages('black_box.files_modal_title', { device_name: selectedDevice?.name })}
                            </h2>
                            <button
                                onClick={() => setShowFileManager(false)}
                                className="text-gray-500 hover:text-gray-700 text-2xl"
                            >
                                ×
                            </button>
                        </div>

                        {loadingFiles ? (
                            <div className="text-center py-8">{tPages('black_box.loading_files')}</div>
                        ) : (
                            <div>
                                {files.length === 0 ? (
                                    <div className="text-center text-gray-500 py-8">
                                        {tPages('black_box.no_files')}
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
                                                        {tPages('black_box.download_button')}
                                                    </button>
                                                    <button
                                                        onClick={() => deleteFile(file.name)}
                                                        className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700 font-medium"
                                                    >
                                                        {tPages('black_box.delete_button')}
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                
                                <div className="mt-6 flex justify-end">
                                    <button
                                        onClick={() => fetchFiles(selectedDevice.device_id)}
                                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                                    >
                                        {tPages('black_box.refresh_files_button')}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default BlackBox;
