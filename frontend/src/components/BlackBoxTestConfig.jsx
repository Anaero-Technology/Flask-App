import React, { useState } from 'react';

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
    onClearChannelConfig 
}) {
    const [uploadingCsv, setUploadingCsv] = useState(false);

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
        <div className="mb-8 bg-gray-50 rounded-lg p-4">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">
                    {device.name} (Gas-flow meter)
                </h3>
                <label className="px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 cursor-pointer">
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
            {renderChannelGrid()}
        </div>
    );
}

export default BlackBoxTestConfig;