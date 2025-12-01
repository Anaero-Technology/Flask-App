import React, { useState } from 'react';

// Channel Configuration Form Component
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
        if (setChimeraChannelError) setChimeraChannelError('');
    }, [currentConfig, setChimeraChannelError]);

    const handleConfirm = () => {
        // Validate chimera channel if provided
        if (config.chimera_channel !== null && config.chimera_channel !== '' && config.chimera_channel !== undefined) {
            const channelNum = parseInt(config.chimera_channel);
            if (isNaN(channelNum) || channelNum < 1 || channelNum > 15) {
                if (setChimeraChannelError) setChimeraChannelError('Chimera channel must be between 1 and 15');
                return;
            }
        }

        if (setChimeraChannelError) setChimeraChannelError('');

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
                            if (setChimeraChannelError) setChimeraChannelError('');
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

function BlackBoxTestConfig({
    device,
    configurations,
    samples,
    inoculums,
    selectedChannel,
    onChannelClick,
    onConfigurationChange,
    showChannelConfig,
    onSaveChannelConfig,
    onClearChannelConfig,
    showChimeraChannel,
    chimeraChannelError,
    setChimeraChannelError
}) {
    const [uploadingCsv, setUploadingCsv] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);

    // Auto-select channel 1 when expanded
    React.useEffect(() => {
        if (isExpanded && (!selectedChannel || selectedChannel.deviceId !== device.id)) {
            onChannelClick(device.id, 1);
        }
    }, [isExpanded, device.id, selectedChannel, onChannelClick]);

    const getChannelConfig = (channelNumber) => {
        return configurations[`${device.id}-${channelNumber}`] || null;
    };

    const handleCsvUpload = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        setUploadingCsv(true);
        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch('/api/v1/tests/upload-csv', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error);
            }

            // Apply CSV configurations to this specific device
            let appliedCount = 0;
            const newConfigurations = {};
            
            result.configurations.forEach(csvConfig => {
                if (csvConfig.channel_number >= 1 && csvConfig.channel_number <= 15) {
                    const configKey = `${device.id}-${csvConfig.channel_number}`;
                    newConfigurations[configKey] = {
                        inoculum_sample_id: '', // User needs to select
                        inoculum_weight_grams: csvConfig.inoculum_weight_grams,
                        substrate_sample_id: csvConfig.is_control ? '' : '', // User needs to select
                        substrate_weight_grams: csvConfig.substrate_weight_grams,
                        tumbler_volume: csvConfig.tumbler_volume,
                        chimera_channel: csvConfig.chimera_channel || null,
                        notes: csvConfig.notes
                    };
                    appliedCount++;
                }
            });

            // Update parent configurations
            onConfigurationChange(newConfigurations);

            alert(`CSV uploaded successfully! Applied ${appliedCount} channel configurations to ${device.name}.\n\nNote: You still need to select the actual Inoculum and Substrate samples for each channel.`);
            
        } catch (error) {
            console.error('Error uploading CSV:', error);
            alert(`Failed to upload CSV: ${error.message}`);
        } finally {
            setUploadingCsv(false);
            // Reset file input
            event.target.value = '';
        }
    };

    const renderChannelGrid = () => {
        const channels = Array.from({ length: 15 }, (_, i) => i + 1);
        
        return (
            <div className="grid grid-cols-5 gap-2">
                {channels.map(channelNumber => {
                    const config = getChannelConfig(channelNumber);
                    const isConfigured = config !== null;
                    const isControl = isConfigured && config.substrate_weight_grams === 0;
                    const isSelected = selectedChannel && selectedChannel.deviceId === device.id && selectedChannel.channelNumber === channelNumber;
                    
                    return (
                        <button
                            key={channelNumber}
                            onClick={() => onChannelClick(device.id, channelNumber)}
                            className={`
                                p-3 border-2 rounded-lg text-sm font-medium transition-all
                                ${isSelected
                                    ? '!border-blue-600 !bg-blue-100 !text-blue-800'
                                    : isConfigured 
                                        ? isControl 
                                            ? '!border-yellow-500 !bg-yellow-50 !text-yellow-800' 
                                            : '!border-green-500 !bg-green-50 !text-green-800'
                                        : '!border-gray-300 !bg-gray-50 !text-gray-600 hover:!border-blue-400 hover:!bg-blue-50'
                                }
                            `}
                        >
                            <div className="font-bold">Ch {channelNumber}</div>
                            {isConfigured && (
                                <div className="text-xs mt-1">
                                    <div>Inoculum: {config.inoculum_weight_grams}g</div>
                                    <div>Substrate: {config.substrate_weight_grams}g</div>
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="mb-8 bg-gray-50 rounded-lg">
            {/* Collapsible Header */}
            <div className="flex items-center justify-between p-4 hover:bg-gray-100 rounded-lg transition-colors">
                <div
                    className="flex-1 cursor-pointer"
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    <h3 className="text-lg font-semibold">{device.name} (Gas-flow meter)</h3>
                </div>
                <div className="flex items-center gap-3">
                    {/* Dropdown arrow */}
                    <svg
                        className={`w-5 h-5 transition-transform cursor-pointer ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        onClick={() => setIsExpanded(!isExpanded)}
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </div>
            </div>

            {/* Expandable Content */}
            {isExpanded && (
                <div className="px-4 pb-4">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Left side - Channel grid and info */}
                        <div className={showChannelConfig && selectedChannel && selectedChannel.deviceId === device.id ? "lg:col-span-2" : "lg:col-span-3"}>
                            <div className="flex items-start justify-between mb-4">
                                <div className="text-sm text-gray-600 flex-1">
                                    <div className="mb-2">Click on a channel to configure it, or upload a CSV file to auto-fill configurations.</div>
                                    <div className="space-y-1">
                                        <div className="text-blue-600">Blue = Selected</div>
                                        <div className="text-green-600">Green = Configured with substrate</div>
                                        <div className="text-yellow-600">Yellow = Control (inoculum only)</div>
                                    </div>
                                </div>
                                {/* Upload CSV Button */}
                                <label className="px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 cursor-pointer ml-4 flex-shrink-0">
                                    {uploadingCsv ? 'Uploading...' : 'Upload CSV'}
                                    <input
                                        type="file"
                                        accept=".csv"
                                        onChange={handleCsvUpload}
                                        disabled={uploadingCsv}
                                        className="hidden"
                                    />
                                </label>
                            </div>

                            {/* Channel Grid */}
                            {renderChannelGrid()}
                        </div>

                        {/* Right side - Channel Configuration Form */}
                        {showChannelConfig && selectedChannel && selectedChannel.deviceId === device.id && (
                            <div className="lg:col-span-1">
                                <div className="bg-white rounded-lg p-4 border border-gray-200 sticky top-4">
                                    <h3 className="text-lg font-semibold mb-4">
                                        Configure Channel {selectedChannel.channelNumber}
                                    </h3>
                                    <ChannelConfigForm
                                        deviceId={selectedChannel.deviceId}
                                        channelNumber={selectedChannel.channelNumber}
                                        currentConfig={getChannelConfig(selectedChannel.channelNumber)}
                                        samples={samples}
                                        inoculums={inoculums}
                                        onSave={onSaveChannelConfig}
                                        onClear={onClearChannelConfig}
                                        showChimeraChannel={showChimeraChannel}
                                        chimeraChannelError={chimeraChannelError}
                                        setChimeraChannelError={setChimeraChannelError}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default BlackBoxTestConfig;