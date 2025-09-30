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

    useEffect(() => {
        fetchDevices();
        fetchSamples();
        fetchInoculums();
    }, []);

    const fetchDevices = async () => {
        try {
            const response = await fetch('/api/v1/devices/discover');
            const data = await response.json();
            setDevices(data);
        } catch (error) {
            console.error('Error fetching devices:', error);
        }
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

    const createTest = async () => {
        if (!testName.trim()) {
            alert('Test name is required');
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
                                devices.map(device => (
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
                <div className="flex justify-end">
                    <button
                        onClick={createTest}
                        disabled={loading || !testName.trim()}
                        className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? 'Creating Test...' : 'Create Test'}
                    </button>
                </div>
            </div>

        </div>
    );
}

// Inline Channel Configuration Form Component
function ChannelConfigForm({ deviceId, channelNumber, currentConfig, samples, inoculums, onSave, onClear }) {
    const [config, setConfig] = useState(currentConfig || {
        inoculum_sample_id: '',
        inoculum_weight_grams: '',
        substrate_sample_id: '',
        substrate_weight_grams: 0,
        tumbler_volume: '',
        notes: ''
    });

    // Update form when currentConfig changes
    React.useEffect(() => {
        setConfig(currentConfig || {
            inoculum_sample_id: '',
            inoculum_weight_grams: '',
            substrate_sample_id: '',
            substrate_weight_grams: 0,
            tumbler_volume: '',
            notes: ''
        });
    }, [currentConfig]);

    const handleSave = () => {
        if (!config.inoculum_sample_id || !config.inoculum_weight_grams || !config.tumbler_volume) {
            alert('Inoculum sample, weight, and tumbler volume are required');
            return;
        }

        onSave({
            ...config,
            inoculum_weight_grams: parseFloat(config.inoculum_weight_grams),
            substrate_weight_grams: parseFloat(config.substrate_weight_grams) || 0,
            tumbler_volume: parseFloat(config.tumbler_volume)
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

            {/* Actions */}
            <div className="flex space-x-2 pt-2">
                <button
                    onClick={handleSave}
                    className="flex-1 px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                >
                    Save
                </button>
                <button
                    onClick={onClear}
                    className="px-3 py-2 text-red-600 border border-red-600 text-sm rounded hover:bg-red-50"
                >
                    Clear
                </button>
            </div>
        </div>
    );
}

export default TestForm;