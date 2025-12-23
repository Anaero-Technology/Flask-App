import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Upload, Info, Check, AlertCircle, Beaker } from 'lucide-react';
import { useAuth } from './AuthContext';

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

    useEffect(() => {
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
        // Validate required fields
        if (!config.inoculum_sample_id) {
            alert('Please select an inoculum sample');
            return;
        }

        if (!config.inoculum_weight_grams || parseFloat(config.inoculum_weight_grams) <= 0) {
            alert('Please enter a valid inoculum weight (must be greater than 0)');
            return;
        }

        if (!config.tumbler_volume || parseFloat(config.tumbler_volume) <= 0) {
            alert('Please enter a valid tumbler volume (must be greater than 0)');
            return;
        }

        // Validate chimera channel if chimera device is selected
        if (showChimeraChannel) {
            if (!config.chimera_channel || config.chimera_channel === '') {
                if (setChimeraChannelError) setChimeraChannelError('Chimera channel is required when Chimera device is selected');
                return;
            }
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
            substrate_weight_grams: config.substrate_weight_grams ? parseFloat(config.substrate_weight_grams) : 0,
            tumbler_volume: config.tumbler_volume ? parseFloat(config.tumbler_volume) : '',
            chimera_channel: chimeraChannel
        });
    };

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Inoculum Selection */}
                <div className="col-span-2">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                        Inoculum Sample <span className="text-red-500">*</span>
                    </label>
                    <select
                        value={config.inoculum_sample_id}
                        onChange={(e) => setConfig(prev => ({ ...prev, inoculum_sample_id: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                    >
                        <option value="">Select inoculum...</option>
                        {inoculums.map(inoculum => (
                            <option key={inoculum.id} value={inoculum.id}>
                                {inoculum.sample_name}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Inoculum Weight */}
                <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                        Inoculum Weight (g) <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="number"
                        step="0.1"
                        value={config.inoculum_weight_grams}
                        onChange={(e) => setConfig(prev => ({ ...prev, inoculum_weight_grams: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                        placeholder="0.0"
                    />
                </div>

                {/* Tumbler Volume */}
                <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                        Tumbler Volume (mL) <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="number"
                        step="0.1"
                        value={config.tumbler_volume}
                        onChange={(e) => setConfig(prev => ({ ...prev, tumbler_volume: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                        placeholder="0.0"
                    />
                </div>

                {/* Substrate Selection */}
                <div className="col-span-2">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                        Substrate Sample <span className="text-gray-400 font-normal normal-case">(Optional)</span>
                    </label>
                    <select
                        value={config.substrate_sample_id || ''}
                        onChange={(e) => {
                            const newValue = e.target.value || null;
                            setConfig(prev => ({
                                ...prev,
                                substrate_sample_id: newValue,
                                // Clear substrate weight if no substrate selected (control)
                                substrate_weight_grams: newValue ? prev.substrate_weight_grams : ''
                            }));
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                    >
                        <option value="">Inoculum Only (Control)</option>
                        {samples.map(sample => (
                            <option key={sample.id} value={sample.id}>
                                {sample.sample_name}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Substrate Weight */}
                <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                        Substrate Weight (g)
                    </label>
                    <input
                        type="number"
                        step="0.1"
                        value={config.substrate_weight_grams}
                        onChange={(e) => setConfig(prev => ({ ...prev, substrate_weight_grams: e.target.value }))}
                        disabled={!config.substrate_sample_id}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                        placeholder={config.substrate_sample_id ? "0.0" : "No substrate selected"}
                    />
                </div>

                {/* Chimera Channel */}
                {showChimeraChannel && (
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                            Chimera Channel <span className="text-red-500">*</span>
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
                            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 transition-all text-sm ${chimeraChannelError
                                ? 'border-red-300 focus:ring-red-500/20 focus:border-red-500'
                                : 'border-gray-300 focus:ring-blue-500/20 focus:border-blue-500'
                                }`}
                            placeholder="1-15"
                        />
                        {chimeraChannelError && (
                            <p className="text-xs text-red-600 mt-1">{chimeraChannelError}</p>
                        )}
                    </div>
                )}

                {/* Notes */}
                <div className="col-span-2">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                        Notes
                    </label>
                    <textarea
                        value={config.notes}
                        onChange={(e) => setConfig(prev => ({ ...prev, notes: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                        rows="2"
                        placeholder="Optional notes..."
                    />
                </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
                <button
                    onClick={handleConfirm}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                >
                    Save Configuration
                </button>
                {onClear && (
                    <button
                        onClick={onClear}
                        className="px-4 py-2 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 transition-colors border border-transparent hover:border-red-100"
                    >
                        Clear
                    </button>
                )}
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
    const { authFetch } = useAuth();
    const [uploadingCsv, setUploadingCsv] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);

    // Auto-select channel 1 when expanded
    useEffect(() => {
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

            const response = await authFetch('/api/v1/tests/upload-csv', {
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
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
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
                                relative p-3 border rounded-xl text-sm font-medium transition-all duration-200
                                flex flex-col items-center justify-center gap-1
                                ${isSelected
                                    ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm ring-1 ring-blue-500'
                                    : isConfigured
                                        ? isControl
                                            ? 'border-yellow-400 bg-yellow-50 text-yellow-700'
                                            : 'border-green-400 bg-green-50 text-green-700'
                                        : 'border-gray-200 bg-white text-gray-500 hover:border-blue-300 hover:bg-gray-50'
                                }
                            `}
                        >
                            <span className="font-bold">Ch {channelNumber}</span>
                            {isConfigured && (
                                <div className="flex gap-1">
                                    <div className={`w-1.5 h-1.5 rounded-full ${isControl ? 'bg-yellow-500' : 'bg-green-500'}`} />
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm transition-all hover:shadow-md">
            {/* Collapsible Header */}
            <div
                className="flex items-center justify-between p-4 bg-gray-50 cursor-pointer border-b border-gray-100 hover:bg-gray-100 transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-100 text-purple-600 rounded-lg">
                        <Beaker size={20} />
                    </div>
                    <div>
                        <h3 className="font-semibold text-gray-900">{device.name}</h3>
                        <p className="text-xs text-gray-500">Gas-flow meter</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className={`p-1 rounded-full transition-transform duration-200 ${isExpanded ? 'bg-gray-200 rotate-180' : 'bg-transparent'}`}>
                        <ChevronDown size={20} className="text-gray-500" />
                    </div>
                </div>
            </div>

            {/* Expandable Content */}
            {isExpanded && (
                <div className="p-6">
                    <div className="grid grid-cols-1 lg:grid-cols-7 gap-6 lg:gap-8">
                        {/* Left side - Channel grid and info */}
                        <div className={showChannelConfig && selectedChannel && selectedChannel.deviceId === device.id ? "lg:col-span-3" : "lg:col-span-7"}>

                            {/* Channel Grid */}
                            <div className="mb-6">

                                {renderChannelGrid()}
                            </div>

                            {/* Legend and Actions - Moved below grid to balance height */}
                            <div className="flex flex-col gap-4 p-4 bg-gray-50 rounded-xl border border-gray-100">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Status Legend</h4>
                                </div>
                                <div className="grid grid-cols-2 gap-3 text-xs font-medium text-gray-600">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2.5 h-2.5 rounded-full bg-blue-500"></div>
                                        <span>Selected</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-2.5 h-2.5 rounded-full bg-green-500"></div>
                                        <span>Configured</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-2.5 h-2.5 rounded-full bg-yellow-500"></div>
                                        <span>Control</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-2.5 h-2.5 rounded-full border border-gray-300 bg-white"></div>
                                        <span>Not in service</span>
                                    </div>
                                </div>
                            </div>

                            {/* Bulk Actions - Upload CSV */}
                            <div className="mt-4">
                                <label className="flex items-center justify-between w-full p-3 bg-white border border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-md cursor-pointer transition-all group">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-blue-50 text-blue-600 rounded-lg group-hover:bg-blue-100 transition-colors">
                                            <Upload size={18} />
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-xs font-bold text-gray-700  tracking-wide">Bulk Config</span>
                                            <span className="text-xs text-gray-400 font-medium">Upload CSV File</span>
                                        </div>
                                    </div>
                                    <div className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${uploadingCsv ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500 group-hover:bg-blue-50 group-hover:text-blue-600'}`}>
                                        {uploadingCsv ? 'Uploading...' : 'Select File'}
                                    </div>
                                    <input
                                        type="file"
                                        accept=".csv"
                                        onChange={handleCsvUpload}
                                        disabled={uploadingCsv}
                                        className="hidden"
                                    />
                                </label>
                            </div>
                        </div>

                        {/* Right side - Channel Configuration Form */}
                        {showChannelConfig && selectedChannel && selectedChannel.deviceId === device.id && (
                            <div className="lg:col-span-4 animate-fadeIn">
                                <div className="bg-gray-50 rounded-xl p-5 border border-gray-200 h-full">
                                    <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-200">
                                        <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">
                                            {selectedChannel.channelNumber}
                                        </div>
                                        <h3 className="font-semibold text-gray-900">
                                            Configure Channel
                                        </h3>
                                    </div>
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