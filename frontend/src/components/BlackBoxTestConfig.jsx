import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Upload, Beaker } from 'lucide-react';
import { useAuth } from './AuthContext';

function BlackBoxTestConfig({
    device,
    configurations,
    samples,
    inoculums,
    onConfigurationChange,
    onSaveChannelConfig,
    onClearChannelConfig,
    showChimeraChannel
}) {
    const { authFetch } = useAuth();
    const { t: tPages } = useTranslation('pages');
    const [uploadingCsv, setUploadingCsv] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [channelErrors, setChannelErrors] = useState({});

    const getChannelConfig = (channelNumber) => {
        return configurations[`${device.id}-${channelNumber}`] || null;
    };

    const getDefaultConfig = () => ({
        inoculum_sample_id: '',
        inoculum_weight_grams: '',
        substrate_sample_id: '',
        substrate_weight_grams: '',
        tumbler_volume: '',
        chimera_channel: null,
        notes: ''
    });

    const normalizeConfig = (config) => ({
        ...config,
        inoculum_weight_grams: config.inoculum_weight_grams ? parseFloat(config.inoculum_weight_grams) : '',
        substrate_weight_grams: config.substrate_weight_grams ? parseFloat(config.substrate_weight_grams) : 0,
        tumbler_volume: config.tumbler_volume ? parseFloat(config.tumbler_volume) : '',
        chimera_channel: config.chimera_channel === '' || config.chimera_channel === null || config.chimera_channel === undefined
            ? null
            : parseInt(config.chimera_channel)
    });

    const validateConfig = (config) => {
        if (!config.inoculum_sample_id) {
            return tPages('test_config.error_select_inoculum');
        }

        if (!config.inoculum_weight_grams || parseFloat(config.inoculum_weight_grams) <= 0) {
            return tPages('test_config.error_inoculum_weight');
        }

        if (!config.tumbler_volume || parseFloat(config.tumbler_volume) <= 0) {
            return tPages('test_config.error_tumbler_volume');
        }

        if (showChimeraChannel) {
            if (!config.chimera_channel || config.chimera_channel === '') {
                return tPages('test_config.error_chimera_required');
            }
            const channelNum = parseInt(config.chimera_channel);
            if (isNaN(channelNum) || channelNum < 1 || channelNum > 15) {
                return tPages('test_config.error_chimera_range');
            }
        }

        return '';
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

            let appliedCount = 0;
            const newConfigurations = {};

            result.configurations.forEach(csvConfig => {
                if (csvConfig.channel_number >= 1 && csvConfig.channel_number <= 15) {
                    const configKey = `${device.id}-${csvConfig.channel_number}`;
                    newConfigurations[configKey] = {
                        inoculum_sample_id: '',
                        inoculum_weight_grams: csvConfig.inoculum_weight_grams,
                        substrate_sample_id: csvConfig.is_control ? '' : '',
                        substrate_weight_grams: csvConfig.substrate_weight_grams,
                        tumbler_volume: csvConfig.tumbler_volume,
                        chimera_channel: csvConfig.chimera_channel || null,
                        notes: csvConfig.notes
                    };
                    appliedCount++;
                }
            });

            onConfigurationChange(newConfigurations);

            alert(tPages('test_config.csv_uploaded', { count: appliedCount, device: device.name }));

        } catch (error) {
            console.error('Error uploading CSV:', error);
            alert(tPages('test_config.csv_upload_failed', { error: error.message }));
        } finally {
            setUploadingCsv(false);
            event.target.value = '';
        }
    };

    const columnCount = showChimeraChannel ? 10 : 9;

    const ChannelRow = ({ channelNumber }) => {
        const currentConfig = getChannelConfig(channelNumber);
        const [config, setConfig] = useState(currentConfig || getDefaultConfig());
        const error = channelErrors[channelNumber];
        const isConfigured = currentConfig !== null;
        const isControl = isConfigured && currentConfig.substrate_weight_grams === 0;

        useEffect(() => {
            setConfig(currentConfig || getDefaultConfig());
            setChannelErrors(prev => ({ ...prev, [channelNumber]: '' }));
        }, [currentConfig, channelNumber]);

        const handleSave = () => {
            const validationError = validateConfig(config);
            if (validationError) {
                setChannelErrors(prev => ({ ...prev, [channelNumber]: validationError }));
                return;
            }

            setChannelErrors(prev => ({ ...prev, [channelNumber]: '' }));
            onSaveChannelConfig(device.id, channelNumber, normalizeConfig(config));
        };

        const handleClear = () => {
            onClearChannelConfig(device.id, channelNumber);
            setConfig(getDefaultConfig());
            setChannelErrors(prev => ({ ...prev, [channelNumber]: '' }));
        };

        return (
            <React.Fragment>
                <tr className="border-b border-gray-100">
                    <td className="px-2 py-2 text-xs font-semibold text-gray-700 whitespace-nowrap">
                        CH {channelNumber}
                    </td>
                    <td className="px-2 py-2">
                        <select
                            value={config.inoculum_sample_id}
                            onChange={(e) => setConfig(prev => ({ ...prev, inoculum_sample_id: e.target.value }))}
                            className="w-44 px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                        >
                            <option value="">{tPages('test_config.select_inoculum')}</option>
                            {inoculums.map(inoculum => (
                                <option key={inoculum.id} value={inoculum.id}>
                                    {inoculum.sample_name}
                                </option>
                            ))}
                        </select>
                    </td>
                    <td className="px-2 py-2">
                        <input
                            type="number"
                            step="0.1"
                            value={config.inoculum_weight_grams}
                            onChange={(e) => setConfig(prev => ({ ...prev, inoculum_weight_grams: e.target.value }))}
                            className="w-20 px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                            placeholder="0.0"
                        />
                    </td>
                    <td className="px-2 py-2">
                        <input
                            type="number"
                            step="0.1"
                            value={config.tumbler_volume}
                            onChange={(e) => setConfig(prev => ({ ...prev, tumbler_volume: e.target.value }))}
                            className="w-20 px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                            placeholder="0.0"
                        />
                    </td>
                    <td className="px-2 py-2">
                        <select
                            value={config.substrate_sample_id || ''}
                            onChange={(e) => {
                                const newValue = e.target.value || null;
                                setConfig(prev => ({
                                    ...prev,
                                    substrate_sample_id: newValue,
                                    substrate_weight_grams: newValue ? prev.substrate_weight_grams : ''
                                }));
                            }}
                            className="w-44 px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                        >
                            <option value="">{tPages('test_config.inoculum_only_control')}</option>
                            {samples.map(sample => (
                                <option key={sample.id} value={sample.id}>
                                    {sample.sample_name}
                                </option>
                            ))}
                        </select>
                    </td>
                    <td className="px-2 py-2">
                        <input
                            type="number"
                            step="0.1"
                            value={config.substrate_weight_grams}
                            onChange={(e) => setConfig(prev => ({ ...prev, substrate_weight_grams: e.target.value }))}
                            disabled={!config.substrate_sample_id}
                            className="w-20 px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                            placeholder={config.substrate_sample_id ? '0.0' : tPages('test_config.no_substrate_selected')}
                        />
                    </td>
                    {showChimeraChannel && (
                        <td className="px-2 py-2">
                            <input
                                type="number"
                                step="1"
                                min="1"
                                max="15"
                                value={config.chimera_channel === null ? '' : config.chimera_channel}
                                onChange={(e) => setConfig(prev => ({ ...prev, chimera_channel: e.target.value }))}
                                className="w-20 px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                placeholder="1-15"
                            />
                        </td>
                    )}
                    <td className="px-2 py-2">
                        <input
                            type="text"
                            value={config.notes}
                            onChange={(e) => setConfig(prev => ({ ...prev, notes: e.target.value }))}
                            className="w-48 px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                            placeholder={tPages('test_config.notes_placeholder')}
                        />
                    </td>
                    <td className="px-2 py-2">
                        {isConfigured && (
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${isControl ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                                {isControl ? tPages('test_config.status_control') : tPages('test_config.status_configured')}
                            </span>
                        )}
                    </td>
                    <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleSave}
                                className="px-2.5 py-1 text-[10px] font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700"
                            >
                                {tPages('test_config.save_configuration')}
                            </button>
                            <button
                                onClick={handleClear}
                                className="px-2.5 py-1 text-[10px] font-semibold rounded-md text-red-600 hover:bg-red-50"
                            >
                                {tPages('test_config.clear')}
                            </button>
                        </div>
                    </td>
                </tr>
                {error && (
                    <tr>
                        <td colSpan={columnCount} className="px-2 pb-2 text-xs text-red-600">
                            {error}
                        </td>
                    </tr>
                )}
            </React.Fragment>
        );
    };

    return (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm transition-all hover:shadow-md">
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
                        <p className="text-xs text-gray-500">{tPages('test_config.gas_flow_meter')}</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className={`p-1 rounded-full transition-transform duration-200 ${isExpanded ? 'bg-gray-200 rotate-180' : 'bg-transparent'}`}>
                        <ChevronDown size={20} className="text-gray-500" />
                    </div>
                </div>
            </div>

            {isExpanded && (
                <div className="p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            {tPages('test_config.configure_channel')}
                        </h4>
                        <span className="text-xs text-gray-400">{tPages('test_config.gas_flow_meter')}</span>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="min-w-full border-collapse text-xs">
                            <thead>
                                <tr className="text-[10px] uppercase tracking-wider text-gray-500">
                                    <th className="px-2 py-2 text-left">CH</th>
                                    <th className="px-2 py-2 text-left">{tPages('test_config.inoculum_sample')}</th>
                                    <th className="px-2 py-2 text-left">{tPages('test_config.inoculum_weight')}</th>
                                    <th className="px-2 py-2 text-left">{tPages('test_config.tumbler_volume')}</th>
                                    <th className="px-2 py-2 text-left">{tPages('test_config.substrate_sample')}</th>
                                    <th className="px-2 py-2 text-left">{tPages('test_config.substrate_weight')}</th>
                                    {showChimeraChannel && (
                                        <th className="px-2 py-2 text-left">{tPages('test_config.chimera_channel')}</th>
                                    )}
                                    <th className="px-2 py-2 text-left">{tPages('test_config.notes')}</th>
                                    <th className="px-2 py-2 text-left">{tPages('test_config.status_configured')}</th>
                                    <th className="px-2 py-2 text-left">{tPages('test_config.save_configuration')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {Array.from({ length: 15 }, (_, i) => i + 1).map(channelNumber => (
                                    <ChannelRow key={channelNumber} channelNumber={channelNumber} />
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="mt-5">
                        <label className="flex items-center justify-between w-full p-3 bg-white border border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-md cursor-pointer transition-all group">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg group-hover:bg-blue-100 transition-colors">
                                    <Upload size={18} />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-xs font-bold text-gray-700 tracking-wide">{tPages('test_config.bulk_config')}</span>
                                    <span className="text-xs text-gray-400 font-medium">{tPages('test_config.upload_csv_file')}</span>
                                </div>
                            </div>
                            <div className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${uploadingCsv ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500 group-hover:bg-blue-50 group-hover:text-blue-600'}`}>
                                {uploadingCsv ? tPages('test_config.uploading') : tPages('test_config.select_file')}
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
            )}
        </div>
    );
}

export default BlackBoxTestConfig;
