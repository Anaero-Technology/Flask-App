import React, { useState, useEffect } from "react";
import DeviceCard from '../components/deviceCard';
import GFM from '../assets/gfm.png';
import refreshIcon from '../assets/refresh.svg';

function BlackBox() {
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
            const response = await fetch('/api/v1/black_box/connected');
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
            const response = await fetch(`/api/v1/black_box/${deviceId}/files`);
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

    const handleFileView = (device) => {
        setSelectedDevice(device);
        setShowFileManager(true);
        fetchFiles(device.device_id);
    };

    const downloadFile = async (filename) => {
        try {
            const response = await fetch(`/api/v1/black_box/${selectedDevice.device_id}/download`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
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
            const response = await fetch(`/api/v1/black_box/${selectedDevice.device_id}/delete_file`, {
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
                    fetchFiles(selectedDevice.device_id); // Refresh file list
                } else {
                    alert(`Failed to delete: ${data.message}`);
                }
            }
        } catch (error) {
            console.error('Delete error:', error);
            alert('Delete failed');
        }
    };

    const stopTest = async (testId) => {
        if (!confirm('Are you sure you want to stop this test? This will stop logging on all devices in the test.')) {
            return;
        }

        try {
            const response = await fetch(`/api/v1/tests/${testId}/stop`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            if (response.ok) {
                const data = await response.json();
                alert(data.message || 'Test stopped successfully');
                fetchBlackBoxes(); // Refresh to update device states
            } else {
                const errorData = await response.json();
                alert(errorData.error || 'Failed to stop test');
            }
        } catch (error) {
            console.error('Stop test error:', error);
            alert('Failed to stop test');
        }
    };

    const toggleLogging = async (deviceId) => {
        const isLogging = loggingStates[deviceId];

        try {
            let response;
            if (isLogging) {
                // Stop logging
                response = await fetch(`/api/v1/black_box/${deviceId}/stop_logging`, {
                    method: 'POST'
                });
            } else {
                // Start logging - prompt for test name and filename
                const testName = prompt('Enter test name:');
                if (!testName) return;

                let filename = prompt('Enter filename for logging (max 20 characters):');
                if (!filename) return;

                // Validate filename length (device firmware has limited buffer)
                if (filename.length > 20) {
                    alert('Filename too long! Maximum 20 characters. Please use a shorter name.');
                    return;
                }

                response = await fetch(`/api/v1/black_box/${deviceId}/start_logging`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
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
                    alert(data.message || (isLogging ? 'Logging stopped' : 'Logging started'));
                    fetchBlackBoxes(); // Refresh to update active_test_id
                } else {
                    alert(data.message || 'Operation failed');
                }
            } else {
                // Handle error responses (like 400 for active test conflict)
                const errorData = await response.json();
                alert(errorData.error || 'Operation failed');
            }
        } catch (error) {
            console.error('Logging toggle error:', error);
            alert('Operation failed');
        }
    };

    useEffect(() => {
        fetchBlackBoxes();
    }, []);

    return (
        <div>
            <h1 className="text-4xl font-bold text-black pl-6 m-6">BlackBox Devices</h1>
            <div className="p-6 pt-6">
                {blackBoxes.length === 0 && !loading && (
                    <div className="text-center text-gray-500 py-8">
                        No connected BlackBox devices found
                    </div>
                )}
                
                {blackBoxes.map((device) => (
                    <div key={device.device_id} className="mb-6">
                        <DeviceCard 
                            deviceId={device.device_id}
                            deviceType="black-box"
                            title="Gas-flow meter" 
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
                                    <span className="font-semibold">⚠️ Device is part of active test: "{device.active_test_name || 'Unknown'}"</span>
                                </div>
                            )}
                            <div className="flex gap-4">
                                <button
                                    onClick={() => handleFileView(device)}
                                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
                                >
                                    File View
                                </button>

                                {device.active_test_id ? (
                                    <button
                                        onClick={() => stopTest(device.active_test_id)}
                                        className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 font-medium"
                                    >
                                        Stop Test
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
                                        {loggingStates[device.device_id] ? 'Stop Logging' : 'Start Logging'}
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
                                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                                    >
                                        Refresh Files
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