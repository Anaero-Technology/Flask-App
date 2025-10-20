import React, { useState, useEffect } from 'react';
import BlackBoxTestConfig from '../components/BlackBoxTestConfig';

function TestForm() {
    const [testName, setTestName] = useState('');
    const [testDescription, setTestDescription] = useState('');
    const [devices, setDevices] = useState([]);
    const [samples, setSamples] = useState([]);
    const [inoculums, setInoculums] = useState([]);
    const [configurations, setConfigurations] = useState({});
    const [loading, setLoading] = useState(false);
    const [selectedChannel, setSelectedChannel] = useState(null);
    const [showChannelConfig, setShowChannelConfig] = useState(false);
    const [selectedDevices, setSelectedDevices] = useState([]);
    const [chimeraChannelError, setChimeraChannelError] = useState('');

    useEffect(() => {
        fetchDevices();
        fetchSamples();
        fetchInoculums();
    }, []);

    const fetchDevices = async () => {
        try {
            const response = await fetch('/api/v1/devices/connected');
            const data = await response.json();
            setDevices(data);
            // Auto-select all devices initially
            setSelectedDevices(data.map(d => d.id));
        } catch (error) {
            console.error('Error fetching devices:', error);
        }
    };

    const toggleDeviceSelection = (deviceId) => {
        setSelectedDevices(prev => {
            if (prev.includes(deviceId)) {
                return prev.filter(id => id !== deviceId);
            } else {
                return [...prev, deviceId];
            }
        });
    };

    const selectAllDevices = () => {
        setSelectedDevices(devices.map(d => d.id));
    };

    const deselectAllDevices = () => {
        setSelectedDevices([]);
    };

    const fetchSamples = async () => {
        try {
            const response = await fetch('/api/v1/samples');
            const data = await response.json();
            setSamples(data);
        } catch (error) {
            console.error('Error fetching samples:', error);
        }
    };

    const fetchInoculums = async () => {
        try {
            const response = await fetch('/api/v1/inoculum');
            const data = await response.json();
            setInoculums(data);
        } catch (error) {
            console.error('Error fetching inoculums:', error);
        }
    };

    const getChannelConfig = (deviceId, channelNumber) => {
        return configurations[`${deviceId}-${channelNumber}`] || null;
    };

    const setChannelConfig = (deviceId, channelNumber, config) => {
        setConfigurations(prev => ({
            ...prev,
            [`${deviceId}-${channelNumber}`]: config
        }));
    };

    const clearChannelConfig = (deviceId, channelNumber) => {
        setConfigurations(prev => {
            const newConfigs = { ...prev };
            delete newConfigs[`${deviceId}-${channelNumber}`];
            return newConfigs;
        });
    };

    const handleChannelClick = (deviceId, channelNumber) => {
        if (selectedChannel && selectedChannel.deviceId === deviceId && selectedChannel.channelNumber === channelNumber) {
            // Clicking the same channel - deselect
            setSelectedChannel(null);
            setShowChannelConfig(false);
        } else {
            // Select new channel
            setSelectedChannel({ deviceId, channelNumber });
            setShowChannelConfig(true);
        }
    };

    const handleSaveChannelConfig = (config) => {
        if (selectedChannel) {
            setChannelConfig(selectedChannel.deviceId, selectedChannel.channelNumber, config);
        }
    };

    const handleClearChannelConfig = () => {
        if (selectedChannel) {
            clearChannelConfig(selectedChannel.deviceId, selectedChannel.channelNumber);
        }
    };

    // Helper to check if Chimera channel should be shown
    const shouldShowChimeraChannel = () => {
        const selected = devices.filter(d => selectedDevices.includes(d.id));
        const hasChimera = selected.some(d => ['chimera', 'chimera-max'].includes(d.device_type));
        const hasBlackBox = selected.some(d => ['black-box', 'black_box'].includes(d.device_type));
        console.log('Device check:', {
            selectedDevices: selected.map(d => ({ id: d.id, name: d.name, type: d.device_type })),
            hasChimera,
            hasBlackBox,
            showChimera: hasChimera && hasBlackBox
        });
        return hasChimera && hasBlackBox;
    };

    const getTestValidationStatus = () => {
        const missing = [];

        if (!testName.trim()) {
            missing.push('test name');
        }

        const configCount = Object.keys(configurations).length;
        if (configCount === 0) {
            missing.push('at least one channel configuration');
        }

        return {
            isValid: missing.length === 0,
            missing: missing
        };
    };

    const createTest = async () => {
        const validation = getTestValidationStatus();

        if (!validation.isValid) {
            alert(`Cannot create test. Missing: ${validation.missing.join(', ')}`);
            return;
        }

        setLoading(true);
        try {
            // Create test
            const testResponse = await fetch('/api/v1/tests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: testName,
                    description: testDescription
                })
            });

            const testResult = await testResponse.json();
            if (!testResponse.ok) {
                throw new Error(testResult.error);
            }

            const testId = testResult.test_id;

            // Create channel configurations
            const configArray = Object.entries(configurations).map(([key, config]) => {
                const [deviceId, channelNumber] = key.split('-');
                return {
                    device_id: parseInt(deviceId),
                    channel_number: parseInt(channelNumber),
                    inoculum_sample_id: config.inoculum_sample_id,
                    inoculum_weight_grams: config.inoculum_weight_grams,
                    substrate_sample_id: config.substrate_sample_id || null,
                    substrate_weight_grams: config.substrate_weight_grams || 0,
                    tumbler_volume: config.tumbler_volume,
                    notes: config.notes || ''
                };
            });

            if (configArray.length > 0) {
                const configResponse = await fetch(`/api/v1/tests/${testId}/configurations`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ configurations: configArray })
                });

                if (!configResponse.ok) {
                    const configError = await configResponse.json();
                    throw new Error(configError.error);
                }
            }

            alert('Test created successfully!');
            
            // Reset form
            setTestName('');
            setTestDescription('');
            setConfigurations({});
            
        } catch (error) {
            console.error('Error creating test:', error);
            alert(`Failed to create test: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleConfigurationChange = (newConfigurations) => {
        setConfigurations(prev => ({
            ...prev,
            ...newConfigurations
        }));
    };


    return (
        <div className="p-6">
            <h1 className="text-4xl font-bold text-black pl-6 m-6">Create Test</h1>
            
            <div className="bg-white rounded-lg shadow-sm p-6">
                {/* Test Information */}
                <div className="mb-8">
                    <h2 className="text-xl font-semibold mb-4">Test Information</h2>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Test Name <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={testName}
                                onChange={(e) => setTestName(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                placeholder="Enter test name"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Description
                            </label>
                            <input
                                type="text"
                                value={testDescription}
                                onChange={(e) => setTestDescription(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                placeholder="Enter test description"
                            />
                        </div>
                    </div>
                </div>

                {/* Device Selection */}
                <div className="mb-8">
                    <h2 className="text-xl font-semibold mb-4">Select Devices for Experiment</h2>
                    {devices.length > 0 ? (
                        <div className="bg-gray-50 rounded-lg p-4">
                            <div className="mb-4">
                                <div className="text-sm text-gray-600">
                                    {selectedDevices.length} of {devices.length} device(s) selected
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {devices.map(device => (
                                    <label
                                        key={device.id}
                                        className="flex items-center gap-3 p-3 bg-white rounded border border-gray-300 hover:bg-gray-50 cursor-pointer"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedDevices.includes(device.id)}
                                            onChange={() => toggleDeviceSelection(device.id)}
                                            className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                                        />
                                        <div className="flex-1">
                                            <div className="font-medium text-gray-900">{device.name}</div>
                                            <div className="text-xs text-gray-500">
                                                {device.device_type === 'black-box' ? 'Black Box' : 'Chimera'}
                                            </div>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg">
                            No devices found. Make sure devices are connected and discovered.
                        </div>
                    )}
                </div>

                {/* Device Channels */}
                <div className="mb-8">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Channel Grids */}
                        <div className="lg:col-span-2">
                            <div className="mb-4">
                                <h2 className="text-xl font-semibold mb-2">Channel Configuration</h2>
                                <div className="text-sm text-gray-600 mb-4">
                                    Click on a channel to configure it, or upload a CSV file per device to auto-fill configurations. Blue = Selected, Green = Configured with substrate, Yellow = Control (inoculum only)
                                </div>
                            </div>
                            
                            {devices.length > 0 ? (
                                devices.filter(device => selectedDevices.includes(device.id)).map(device => (
                                    device.device_type === 'black-box' ? (
                                        <BlackBoxTestConfig
                                            key={device.id}
                                            device={device}
                                            configurations={configurations}
                                            samples={samples}
                                            inoculums={inoculums}
                                            selectedChannel={selectedChannel}
                                            onChannelClick={handleChannelClick}
                                            onConfigurationChange={handleConfigurationChange}
                                            showChannelConfig={showChannelConfig}
                                            onSaveChannelConfig={handleSaveChannelConfig}
                                            onClearChannelConfig={handleClearChannelConfig}
                                        />
                                    ) : (
                                        <div key={device.id} className="mb-8 bg-gray-50 rounded-lg p-4">
                                            <h3 className="text-lg font-semibold mb-4">
                                                {device.name} (Chimera)
                                            </h3>
                                            <div className="text-gray-500 text-center py-4">
                                                Chimera device configuration coming soon...
                                            </div>
                                        </div>
                                    )
                                ))
                            ) : selectedDevices.length === 0 ? (
                                <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg">
                                    No devices selected. Please select at least one device above to configure channels.
                                </div>
                            ) : (
                                <div className="text-center py-8 text-gray-500">
                                    No devices found. Make sure devices are connected and discovered.
                                </div>
                            )}
                        </div>

                        {/* Inline Channel Configuration */}
                        <div className="lg:col-span-1">
                            {showChannelConfig && selectedChannel ? (
                                <div className="bg-gray-50 rounded-lg p-4 sticky top-4">
                                    <h3 className="text-lg font-semibold mb-4">
                                        Configure Channel {selectedChannel.channelNumber}
                                    </h3>
                                    <ChannelConfigForm
                                        deviceId={selectedChannel.deviceId}
                                        channelNumber={selectedChannel.channelNumber}
                                        currentConfig={getChannelConfig(selectedChannel.deviceId, selectedChannel.channelNumber)}
                                        samples={samples}
                                        inoculums={inoculums}
                                        onSave={handleSaveChannelConfig}
                                        onClear={handleClearChannelConfig}
                                        showChimeraChannel={shouldShowChimeraChannel()}
                                        chimeraChannelError={chimeraChannelError}
                                        setChimeraChannelError={setChimeraChannelError}
                                    />
                                </div>
                            ) : (
                                <div className="bg-gray-50 rounded-lg p-4 text-center text-gray-500">
                                    Select a channel to configure
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Create Test Button */}
                <div className="flex flex-col items-end gap-2">
                    {(() => {
                        const validation = getTestValidationStatus();
                        return (
                            <>
                                {!validation.isValid && (
                                    <div className="text-sm text-red-600">
                                        Missing: {validation.missing.join(', ')}
                                    </div>
                                )}
                                <button
                                    onClick={createTest}
                                    disabled={loading}
                                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {loading ? 'Creating Test...' : 'Create Test'}
                                </button>
                            </>
                        );
                    })()}
                </div>
            </div>

        </div>
    );
}

// Inline Channel Configuration Form Component
function ChannelConfigForm({ deviceId, channelNumber, currentConfig, samples, inoculums, onSave, onClear, showChimeraChannel, chimeraChannelError, setChimeraChannelError }) {
    const [config, setConfig] = useState(currentConfig || {
        inoculum_sample_id: '',
        inoculum_weight_grams: '',
        substrate_sample_id: '',
        substrate_weight_grams: '',
        tumbler_volume: '',
        chimera_channel: null,
        notes: ''
    });

    // Update form when currentConfig changes
    React.useEffect(() => {
        setConfig(currentConfig || {
            inoculum_sample_id: '',
            inoculum_weight_grams: '',
            substrate_sample_id: '',
            substrate_weight_grams: '',
            tumbler_volume: '',
            chimera_channel: null,
            notes: ''
        });
        setChimeraChannelError('');
    }, [currentConfig, setChimeraChannelError]);

    const handleConfirm = () => {
        // Validate chimera channel if provided
        if (config.chimera_channel !== null && config.chimera_channel !== '' && config.chimera_channel !== undefined) {
            const channelNum = parseInt(config.chimera_channel);
            if (isNaN(channelNum) || channelNum < 1 || channelNum > 15) {
                setChimeraChannelError('Chimera channel must be between 1 and 15');
                return;
            }
        }

        setChimeraChannelError('');

        // Convert chimera_channel to null if empty or invalid
        const chimeraChannel = config.chimera_channel === '' || config.chimera_channel === null || config.chimera_channel === undefined
            ? null
            : parseInt(config.chimera_channel);

        // Save the configuration
        onSave({
            ...config,
            inoculum_weight_grams: config.inoculum_weight_grams ? parseFloat(config.inoculum_weight_grams) : '',
            substrate_weight_grams: config.substrate_weight_grams ? parseFloat(config.substrate_weight_grams) : '',
            tumbler_volume: config.tumbler_volume ? parseFloat(config.tumbler_volume) : '',
            chimera_channel: chimeraChannel
        });
    };

    return (
        <div className="space-y-4">
            {/* Inoculum Selection */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    Inoculum Sample <span className="text-red-500">*</span>
                </label>
                <select
                    value={config.inoculum_sample_id}
                    onChange={(e) => setConfig(prev => ({ ...prev, inoculum_sample_id: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                >
                    <option value="">Select inoculum...</option>
                    {inoculums.map(inoculum => (
                        <option key={inoculum.id} value={inoculum.id}>
                            {inoculum.inoculum_source}
                        </option>
                    ))}
                </select>
            </div>

            {/* Inoculum Weight */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    Inoculum Weight (g) <span className="text-red-500">*</span>
                </label>
                <input
                    type="number"
                    step="0.1"
                    value={config.inoculum_weight_grams}
                    onChange={(e) => setConfig(prev => ({ ...prev, inoculum_weight_grams: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                    placeholder="0.0"
                />
            </div>

            {/* Substrate Selection */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    Substrate Sample (optional)
                </label>
                <select
                    value={config.substrate_sample_id || ''}
                    onChange={(e) => setConfig(prev => ({ ...prev, substrate_sample_id: e.target.value || null }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                >
                    <option value="">No substrate (control)</option>
                    {samples.map(sample => (
                        <option key={sample.id} value={sample.id}>
                            {sample.sample_name}
                        </option>
                    ))}
                </select>
            </div>

            {/* Substrate Weight */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    Substrate Weight (g)
                </label>
                <input
                    type="number"
                    step="0.1"
                    value={config.substrate_weight_grams}
                    onChange={(e) => setConfig(prev => ({ ...prev, substrate_weight_grams: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                    placeholder="0.0"
                />
            </div>

            {/* Tumbler Volume */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tumbler Volume (mL) <span className="text-red-500">*</span>
                </label>
                <input
                    type="number"
                    step="0.1"
                    value={config.tumbler_volume}
                    onChange={(e) => setConfig(prev => ({ ...prev, tumbler_volume: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                    placeholder="0.0"
                />
                <p className="text-xs text-gray-500 mt-1">Volume of gas required for a tip to occur</p>
            </div>

            {/* Chimera Channel - Only show when both chimera and black-box devices are selected */}
            {showChimeraChannel && (
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Chimera Channel (optional)
                    </label>
                    <input
                        type="number"
                        step="1"
                        min="1"
                        max="15"
                        value={config.chimera_channel === null ? '' : config.chimera_channel}
                        onChange={(e) => {
                            setConfig(prev => ({ ...prev, chimera_channel: e.target.value }));
                            setChimeraChannelError('');
                        }}
                        className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-1 text-sm ${
                            chimeraChannelError
                                ? 'border-red-500 focus:ring-red-500'
                                : 'border-gray-300 focus:ring-blue-500'
                        }`}
                        placeholder="Leave empty if not used"
                    />
                    {chimeraChannelError && (
                        <p className="text-xs text-red-600 mt-1">{chimeraChannelError}</p>
                    )}
                    {!chimeraChannelError && (
                        <p className="text-xs text-gray-500 mt-1">Must be between 1 and 15 (leave empty if not used)</p>
                    )}
                </div>
            )}

            {/* Notes */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    Notes
                </label>
                <textarea
                    value={config.notes}
                    onChange={(e) => setConfig(prev => ({ ...prev, notes: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                    rows="2"
                    placeholder="Optional notes..."
                />
            </div>

            {/* Confirm Button */}
            <div className="pt-2">
                <button
                    onClick={handleConfirm}
                    className="w-full px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                >
                    Confirm
                </button>
            </div>
        </div>
    );
}

export default TestForm;