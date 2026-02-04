import React, { useState, useEffect } from 'react';
import {
    FlaskConical,
    Play,
    Save,
    AlertCircle,
    CheckCircle,
    Info,
    Server,
    Beaker,
    Settings
} from 'lucide-react';
import BlackBoxTestConfig from '../components/BlackBoxTestConfig';
import ChimeraTestConfig from '../components/ChimeraTestConfig';
import { useToast } from '../components/Toast';
import { useAuth } from '../components/AuthContext';
import { useTranslation } from 'react-i18next';

function TestForm() {
    const { authFetch } = useAuth();
    const { t: tPages } = useTranslation('pages');
    const toast = useToast();
    const [testName, setTestName] = useState('');
    const [testDescription, setTestDescription] = useState('');
    const [devices, setDevices] = useState([]);
    const [samples, setSamples] = useState([]);
    const [inoculums, setInoculums] = useState([]);
    const [configurations, setConfigurations] = useState({});
    const [loading, setLoading] = useState(false);
    const [selectedDevices, setSelectedDevices] = useState([]);
    const [globalDeviceModel, setGlobalDeviceModel] = useState(null); // 'chimera' or 'chimera-max'

    // Global Chimera recirculation settings (applies to all chimera channels)
    const [recirculationMode, setRecirculationMode] = useState('off'); // 'off', 'volume', or 'periodic'
    const [serviceSequence, setServiceSequence] = useState('111111111111111'); // 15 channels
    const [recirculationDelaySeconds, setRecirculationDelaySeconds] = useState(0); // Seconds between periodic recirculation (0 = not set)
    // Per-channel settings: { 1: { volumeThreshold: 1000, openTime: 1 }, 2: {...}, ... }
    const [channelSettings, setChannelSettings] = useState({});
    const [applyAllOpenTimeValue, setApplyAllOpenTimeValue] = useState(600);
    const [flushTime, setFlushTime] = useState(30); // Global flush time in seconds

    const toggleServiceChannel = (index) => {
        setServiceSequence(prev => {
            const arr = prev.split('');
            arr[index] = arr[index] === '1' ? '0' : '1';
            return arr.join('');
        });
    };

    const updateChannelSetting = (channelNum, field, value) => {
        setChannelSettings(prev => ({
            ...prev,
            [channelNum]: {
                ...prev[channelNum],
                [field]: value
            }
        }));
    };

    useEffect(() => {
        fetchDevices();
        fetchSamples();
        fetchInoculums();
        fetchGlobalDeviceModel();
    }, []);

    const fetchGlobalDeviceModel = async () => {
        try {
            const response = await authFetch('/api/v1/chimera/config/model');
            if (response.ok) {
                const data = await response.json();
                setGlobalDeviceModel(data.device_model);
            }
        } catch (error) {
            console.error('Error fetching global device model:', error);
        }
    };

    // Auto-switch to off if volume mode is selected but no BlackBox is available
    // Also auto-switch to off if global device model doesn't support recirculation
    useEffect(() => {
        const selected = devices.filter(d => selectedDevices.includes(d.id));
        const hasBlackBox = selected.some(d => ['black-box', 'black_box'].includes(d.device_type));
        const hasChimera = selected.some(d => ['chimera', 'chimera-max'].includes(d.device_type));

        if (hasChimera && globalDeviceModel !== 'chimera-max' && recirculationMode !== 'off') {
            // Global device model doesn't support recirculation, force to off
            setRecirculationMode('off');
        } else if (recirculationMode === 'volume' && !hasBlackBox) {
            // Volume mode requires BlackBox
            setRecirculationMode('off');
        }
    }, [selectedDevices, devices, recirculationMode, globalDeviceModel]);

    const fetchDevices = async () => {
        try {
            const response = await authFetch('/api/v1/devices/connected');
            if (response.ok) {
                const data = await response.json();
                setDevices(data);

                // Remove any selected devices that are now busy
                const freeDeviceIds = data.filter(d => !d.active_test_id).map(d => d.id);
                setSelectedDevices(prev => prev.filter(id => freeDeviceIds.includes(id)));
            }
        } catch (error) {
            console.error('Error fetching devices:', error);
        }
    };

    const toggleDeviceSelection = (deviceId) => {
        setSelectedDevices(prev => {
            if (prev.includes(deviceId)) {
                return prev.filter(id => id !== deviceId);
            } else {
                // Check if device is busy before adding
                const device = devices.find(d => d.id === deviceId);
                if (device && device.active_test_id != null) {
                    // Device is busy, don't allow selection
                    return prev;
                }
                return [...prev, deviceId];
            }
        });
    };

    const selectAllDevices = () => {
        // Only select free devices
        const freeDevices = devices.filter(d => !d.active_test_id);
        setSelectedDevices(freeDevices.map(d => d.id));
    };

    const deselectAllDevices = () => {
        setSelectedDevices([]);
    };

    const fetchSamples = async () => {
        try {
            const response = await authFetch('/api/v1/samples');
            if (response.ok) {
                const data = await response.json();
                setSamples(data);
            }
        } catch (error) {
            console.error('Error fetching samples:', error);
        }
    };

    const fetchInoculums = async () => {
        try {
            const response = await authFetch('/api/v1/inoculum');
            if (response.ok) {
                const data = await response.json();
                setInoculums(data);
            }
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

    const handleSaveChannelConfig = (deviceId, channelNumber, config) => {
        setChannelConfig(deviceId, channelNumber, config);
    };

    const handleClearChannelConfig = (deviceId, channelNumber) => {
        clearChannelConfig(deviceId, channelNumber);
    };

    // Helper to check if any Chimera is selected
    const hasChimeraSelected = () => {
        const selected = devices.filter(d => selectedDevices.includes(d.id));
        return selected.some(d => ['chimera', 'chimera-max'].includes(d.device_type));
    };

    // Helper to check if any BlackBox is selected
    const hasBlackBoxSelected = () => {
        const selected = devices.filter(d => selectedDevices.includes(d.id));
        return selected.some(d => ['black-box', 'black_box'].includes(d.device_type));
    };

    // Helper to check if Chimera channel field should be shown in BlackBox config (needs both)
    const shouldShowChimeraChannel = () => {
        return hasChimeraSelected() && hasBlackBoxSelected();
    };

    // Helper to check if recirculation is supported (checks global device model)
    const hasRecirculationSupported = () => {
        // If global device model hasn't loaded yet, assume no support to be safe
        if (globalDeviceModel === null) return false;
        return globalDeviceModel === 'chimera-max';
    };

    // Apply open time to all enabled channels
    const applyAllOpenTime = (openTime) => {
        const newSettings = {};
        for (let i = 0; i < 15; i++) {
            if (serviceSequence[i] === '1') {
                const channelNum = i + 1;
                newSettings[channelNum] = {
                    ...channelSettings[channelNum],
                    openTime: openTime
                };
            }
        }
        setChannelSettings(prev => ({ ...prev, ...newSettings }));
    };

    const getTestValidationStatus = () => {
        const missing = [];

        if (!testName.trim()) {
            missing.push(tPages('test_form.test_name_required'));
        }

        const configCount = Object.keys(configurations).length;
        const deviceCount = selectedDevices.length;

        if (deviceCount === 0) {
            missing.push(tPages('test_form.at_least_one_device'));
        } else if (configCount === 0) {
            // Check if any selected device is a BlackBox (which requires config)
            const hasBlackBox = devices
                .filter(d => selectedDevices.includes(d.id))
                .some(d => ['black-box', 'black_box'].includes(d.device_type));

            if (hasBlackBox) {
                missing.push(tPages('test_form.blackbox_config_required'));
            }
        }

        // Validate periodic recirculation has a delay set
        if (recirculationMode === 'periodic' && recirculationDelaySeconds <= 0) {
            missing.push(tPages('test_form.recirculation_delay_required'));
        }

        return {
            isValid: missing.length === 0,
            missing: missing
        };
    };

    const startTest = async () => {
        const validation = getTestValidationStatus();

        if (!validation.isValid) {
            toast.warning(`${tPages('test_form.cannot_start_test')}. ${tPages('test_form.missing')} ${validation.missing.join(', ')}`);
            return;
        }

        // Check if any selected devices are busy
        const selectedDeviceObjs = devices.filter(d => selectedDevices.includes(d.id));
        const busyDevices = selectedDeviceObjs.filter(d => d.active_test_id);

        if (busyDevices.length > 0) {
            toast.error(`Cannot start test. The following devices are currently in use: ${busyDevices.map(d => d.name).join(', ')}`);
            return;
        }

        // Check if devices being used in configurations are all free
        const deviceIdsInConfigs = [...new Set(
            Object.keys(configurations).map(key => parseInt(key.split('-')[0]))
        )];
        const busyConfigDevices = devices.filter(d =>
            deviceIdsInConfigs.includes(d.id) && d.active_test_id
        );

        if (busyConfigDevices.length > 0) {
            toast.error(`Cannot start test. The following configured devices are in use: ${busyConfigDevices.map(d => d.name).join(', ')}`);
            return;
        }

        setLoading(true);
        try {
            // Create test
            const testResponse = await authFetch('/api/v1/tests', {
                method: 'POST',
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

            // Create channel configurations (BlackBox)
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
                    chimera_channel: config.chimera_channel || null,
                    notes: config.notes || ''
                };
            });

            if (configArray.length > 0) {
                const configResponse = await authFetch(`/api/v1/tests/${testId}/configurations`, {
                    method: 'POST',
                    body: JSON.stringify({ configurations: configArray })
                });

                if (!configResponse.ok) {
                    const configError = await configResponse.json();
                    throw new Error(configError.error);
                }
            }

            // Create Chimera configuration if any Chimera device is selected
            const chimeraDevices = devices.filter(d =>
                selectedDevices.includes(d.id) && ['chimera', 'chimera-max'].includes(d.device_type)
            );

            for (const chimeraDevice of chimeraDevices) {
                const chimeraConfigResponse = await authFetch(`/api/v1/tests/${testId}/chimera-configuration`, {
                    method: 'POST',
                    body: JSON.stringify({
                        device_id: chimeraDevice.id,
                        flush_time_seconds: flushTime,
                        recirculation_mode: recirculationMode,
                        recirculation_delay_seconds: recirculationMode === 'periodic' ? recirculationDelaySeconds : null,
                        service_sequence: serviceSequence,
                        channel_settings: channelSettings
                    })
                });

                if (!chimeraConfigResponse.ok) {
                    const chimeraConfigError = await chimeraConfigResponse.json();
                    throw new Error(chimeraConfigError.error);
                }
            }

            // Start the test immediately, passing selected devices explicitly
            const startResponse = await authFetch(`/api/v1/tests/${testId}/start`, {
                method: 'POST',
                body: JSON.stringify({ device_ids: selectedDevices })
            });

            if (!startResponse.ok) {
                const startError = await startResponse.json();
                throw new Error(startError.error);
            }

            toast.success(tPages('test_form.test_started'));

            // Reset form fields
            setTestName('');
            setTestDescription('');
            setConfigurations({});
            fetchDevices(); // Refresh devices to show updated busy status

        } catch (error) {
            console.error('Error starting test:', error);
            toast.error(`${tPages('test_form.test_start_failed')}: ${error.message}`);
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
        <div className="max-w-7xl mx-auto space-y-8">
            <div className="flex flex-col space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
                            {tPages('test_form.title')}
                        </h1>
                    </div>
                </div>

                {/* Test Details Card */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-center gap-2">
                        <Info size={16} className="text-gray-500" />
                        <h2 className="font-semibold text-gray-900 text-sm">{tPages('test_form.test_details')}</h2>
                    </div>
                    <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">
                                {tPages('test_form.test_name')} <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={testName}
                                onChange={(e) => setTestName(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                                placeholder={tPages('test_form.test_name_placeholder')}
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">
                                {tPages('test_form.description')}
                            </label>
                            <input
                                type="text"
                                value={testDescription}
                                onChange={(e) => setTestDescription(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                                placeholder={tPages('test_form.description_placeholder')}
                            />
                        </div>
                    </div>
                </div>

                {/* Device Selection Card */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Server size={16} className="text-gray-500" />
                            <h2 className="font-semibold text-gray-900 text-sm">{tPages('test_form.select_devices')}</h2>
                        </div>
                        <span className="text-xs font-medium px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full dark:bg-blue-500/20 dark:text-blue-200 dark:border dark:border-blue-400/40">
                            {selectedDevices.length} {tPages('test_form.selected')}
                        </span>
                    </div>
                    <div className="p-4">
                        {devices.length > 0 ? (
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                                {devices.map(device => {
                                    const isSelected = selectedDevices.includes(device.id);
                                    const isBusy = device.active_test_id != null; // Device is busy if it has ANY active test

                                    return (
                                        <div
                                            key={device.id}
                                            onClick={() => !isBusy && toggleDeviceSelection(device.id)}
                                            className={`
                                                    relative rounded-lg border transition-all duration-200 p-3 cursor-pointer
                                                    flex flex-col gap-2 group hover:shadow-sm
                                                    ${isBusy
                                                    ? 'bg-gray-50 border-gray-200 opacity-60 cursor-not-allowed dark:bg-slate-900/60 dark:border-slate-800 dark:opacity-70'
                                                    : isSelected
                                                        ? 'bg-blue-50/50 border-blue-500 ring-1 ring-blue-500 dark:bg-blue-500/15 dark:border-blue-400 dark:ring-blue-400/60'
                                                        : 'bg-white border-gray-200 hover:border-blue-300 hover:bg-gray-50 dark:bg-slate-900 dark:border-slate-800 dark:hover:bg-slate-800 dark:hover:border-blue-400/50'
                                                }
                                                `}
                                        >
                                            <div className="flex items-start justify-between">
                                                <div className="flex items-center gap-2">
                                                    <div className={`
                                                            p-1.5 rounded-md transition-colors
                                                            ${isBusy
                                                            ? 'bg-gray-200 text-gray-500 dark:bg-slate-800 dark:text-slate-400'
                                                            : isSelected
                                                                ? 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-200'
                                                                : 'bg-gray-100 text-gray-500 group-hover:bg-blue-50 group-hover:text-blue-500 dark:bg-slate-800 dark:text-slate-400 dark:group-hover:bg-blue-500/10 dark:group-hover:text-blue-200'
                                                        }
                                                        `}>
                                                        {device.device_type === 'chimera' ? <Server size={16} /> : <Beaker size={16} />}
                                                    </div>
                                                    <span className={`font-medium text-sm truncate ${isSelected ? 'text-blue-900 dark:text-blue-100' : 'text-gray-900 dark:text-slate-100'}`}>
                                                        {device.name}
                                                    </span>
                                                </div>

                                                {/* Selection/Status Indicator */}
                                                {isBusy ? (
                                                    <AlertCircle size={14} className="text-amber-500" />
                                                ) : isSelected && (
                                                    <div className="w-4 h-4 rounded-full bg-blue-500 text-white flex items-center justify-center">
                                                        <CheckCircle size={10} />
                                                    </div>
                                                )}
                                            </div>

                                            <div className="flex items-center justify-between text-xs">
                                                <span className="text-gray-500 capitalize">{device.device_type}</span>
                                                <span className={`flex items-center gap-1 ${device.status === 'connected' ? 'text-green-600' : 'text-gray-400'}`}>
                                                    <div className={`w-1.5 h-1.5 rounded-full ${device.status === 'connected' ? 'bg-green-500' : 'bg-gray-300'}`} />
                                                    {isBusy ? tPages('test_form.in_use') : device.status}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="text-center py-6 text-gray-500 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                                <Server size={24} className="mx-auto mb-2 text-gray-300" />
                                <p className="text-sm">{tPages('test_form.no_devices_found')}</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Chimera Settings - Show if any Chimera device is selected */}
                {hasChimeraSelected() && (
                    <ChimeraTestConfig
                        flushTime={flushTime}
                        setFlushTime={setFlushTime}
                        recirculationMode={recirculationMode}
                        setRecirculationMode={setRecirculationMode}
                        recirculationDelaySeconds={recirculationDelaySeconds}
                        setRecirculationDelaySeconds={setRecirculationDelaySeconds}
                        serviceSequence={serviceSequence}
                        setServiceSequence={setServiceSequence}
                        channelSettings={channelSettings}
                        setChannelSettings={setChannelSettings}
                        applyAllOpenTime={applyAllOpenTime}
                        applyAllOpenTimeValue={applyAllOpenTimeValue}
                        setApplyAllOpenTimeValue={setApplyAllOpenTimeValue}
                        hasBlackBoxSelected={hasBlackBoxSelected()}
                        hasRecirculationSupport={hasRecirculationSupported()}
                    />
                )}

                {/* Channel Configuration */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden min-h-[200px] flex flex-col">
                    <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-center gap-2">
                        <Settings size={16} className="text-gray-500" />
                        <h2 className="font-semibold text-gray-900 text-sm">{tPages('test_form.channel_configuration')}</h2>
                    </div>
                    <div className="p-4 flex-1 bg-gray-50/50">
                        {devices.length > 0 ? (
                            selectedDevices.length > 0 ? (
                                <div className="space-y-4">
                                    {devices.filter(device => selectedDevices.includes(device.id) && device.device_type === 'black-box').map(device => (
                                        <div key={device.id} className="animate-fadeIn">
                                            <BlackBoxTestConfig
                                                device={device}
                                                configurations={configurations}
                                                samples={samples}
                                                inoculums={inoculums}
                                                onConfigurationChange={handleConfigurationChange}
                                                onSaveChannelConfig={handleSaveChannelConfig}
                                                onClearChannelConfig={handleClearChannelConfig}
                                                showChimeraChannel={shouldShowChimeraChannel()}
                                            />
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-gray-400 text-center p-8 border-2 border-dashed border-gray-200 rounded-xl bg-white">
                                    <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mb-3">
                                        <Server size={24} className="text-gray-300" />
                                    </div>
                                    <h3 className="text-sm font-medium text-gray-900 mb-1">{tPages('test_form.no_devices_selected')}</h3>
                                    <p className="text-xs text-gray-500 max-w-xs mx-auto">{tPages('test_form.select_device_message')}</p>
                                </div>
                            )
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-gray-400">
                                <p>{tPages('test_form.connect_devices_message')}</p>
                            </div>
                        )}
                    </div>

                    {/* Action Bar */}
                    <div className="bg-gray-50 px-6 py-4 border-t border-gray-200 flex items-center justify-between sticky bottom-0">
                        <div className="text-sm text-gray-500">
                            {Object.keys(configurations).length} {tPages('test_form.channels_configured')}
                        </div>
                        <div className="flex items-center gap-3">
                            {(() => {
                                const validation = getTestValidationStatus();
                                return (
                                    <div className="flex items-center gap-4">
                                        {!validation.isValid && (
                                            <span className="text-sm text-red-600 flex items-center gap-1.5 bg-red-50 px-3 py-1.5 rounded-full border border-red-100">
                                                <AlertCircle size={14} />
                                                {tPages('test_form.missing')} {validation.missing.join(', ')}
                                            </span>
                                        )}
                                        <button
                                            onClick={startTest}
                                            disabled={loading || !validation.isValid}
                                            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all shadow-sm hover:shadow disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                                        >
                                            <Play size={18} fill="currentColor" />
                                            {loading ? tPages('test_form.starting') : tPages('test_form.start_test')}
                                        </button>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}



export default TestForm;
