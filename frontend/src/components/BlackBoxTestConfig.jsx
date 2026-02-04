import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Upload, Download, Plus } from 'lucide-react';
import { useAuth } from './AuthContext';

const sanitizeDecimalInput = (value) => {
    if (value === '' || value === null || value === undefined) return '';
    const cleaned = String(value).replace(/[^0-9.]/g, '');
    if (cleaned === '.') return '0.';
    const parts = cleaned.split('.');
    if (parts.length <= 1) return cleaned;
    return `${parts[0]}.${parts.slice(1).join('')}`;
};

const sanitizeIntegerInput = (value) => {
    if (value === '' || value === null || value === undefined) return '';
    return String(value).replace(/\D/g, '');
};

const BlackBoxChannelRow = React.memo(function BlackBoxChannelRow({
    channelNumber,
    config,
    error,
    isConfigured,
    isControl,
    isSelected,
    isActive,
    showChimeraChannel,
    inoculums,
    samples,
    tPages,
    onRowMouseDown,
    onRowClick,
    onToggleActive,
    onFieldChange,
    onAttemptSave,
    columnCount
}) {
    const rowClass = isConfigured
        ? (isControl ? 'bg-yellow-50/60' : 'bg-green-50/60')
        : 'bg-white';
    const selectionClass = isSelected ? 'ring-2 ring-blue-300/60 ring-inset' : '';
    const inactiveClass = !isActive ? 'opacity-70' : '';
    const cellClass = isSelected ? 'bg-blue-50/40' : '';
    const cellHoverClass = 'group-hover:bg-blue-50/20';

    return (
        <React.Fragment>
            <tr
                className={`group border-b border-gray-100 ${rowClass} ${selectionClass} ${inactiveClass}`}
                onMouseDown={(event) => onRowMouseDown(channelNumber, event)}
                onPointerDown={(event) => onRowMouseDown(channelNumber, event)}
                onClick={(event) => onRowClick(channelNumber, event)}
            >
                <td className={`px-2 py-2 text-xs text-gray-700 whitespace-nowrap ${cellClass} ${cellHoverClass}`}>
                    <div className="flex items-center gap-2">
                        <span className="font-semibold">{channelNumber}</span>
                        <input
                            type="checkbox"
                            checked={isActive}
                            onChange={() => onToggleActive(channelNumber)}
                            aria-label={tPages('test_config.active_channel')}
                            className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500/30"
                        />
                    </div>
                </td>
                <td className={`px-2 py-2 ${cellClass} ${cellHoverClass}`}>
                    <select
                        value={config.inoculum_sample_id}
                        onChange={(e) => onFieldChange(channelNumber, prev => ({ ...prev, inoculum_sample_id: e.target.value }))}
                        onBlur={() => onAttemptSave(channelNumber)}
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
                <td className={`px-2 py-2 ${cellClass} ${cellHoverClass}`}>
                    <input
                        type="text"
                        inputMode="decimal"
                        value={config.inoculum_weight_grams}
                        onInput={(e) => {
                            const nextValue = sanitizeDecimalInput(e.target.value);
                            onFieldChange(channelNumber, prev => ({ ...prev, inoculum_weight_grams: nextValue }));
                        }}
                        onBlur={() => onAttemptSave(channelNumber)}
                        className="w-20 px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                        placeholder="0.0"
                    />
                </td>
                <td className={`px-2 py-2 ${cellClass} ${cellHoverClass}`}>
                    <input
                        type="text"
                        inputMode="decimal"
                        value={config.tumbler_volume}
                        onInput={(e) => {
                            const nextValue = sanitizeDecimalInput(e.target.value);
                            onFieldChange(channelNumber, prev => ({ ...prev, tumbler_volume: nextValue }));
                        }}
                        onBlur={() => onAttemptSave(channelNumber)}
                        className="w-20 px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                        placeholder="0.0"
                    />
                </td>
                <td className={`px-2 py-2 ${cellClass} ${cellHoverClass}`}>
                    <select
                        value={config.substrate_sample_id || ''}
                        onChange={(e) => {
                            const newValue = e.target.value || '';
                            onFieldChange(channelNumber, prev => ({
                                ...prev,
                                substrate_sample_id: newValue,
                                substrate_weight_grams: newValue ? prev.substrate_weight_grams : ''
                            }));
                        }}
                        onBlur={() => onAttemptSave(channelNumber)}
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
                <td className={`px-2 py-2 ${cellClass} ${cellHoverClass}`}>
                    <input
                        type="text"
                        inputMode="decimal"
                        value={config.substrate_weight_grams}
                        onInput={(e) => {
                            const nextValue = sanitizeDecimalInput(e.target.value);
                            onFieldChange(channelNumber, prev => ({ ...prev, substrate_weight_grams: nextValue }));
                        }}
                        onBlur={() => onAttemptSave(channelNumber)}
                        disabled={!config.substrate_sample_id}
                        className="w-20 px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                        placeholder={config.substrate_sample_id ? '0.0' : tPages('test_config.no_substrate_selected')}
                    />
                </td>
                {showChimeraChannel && (
                    <td className={`px-2 py-2 ${cellClass} ${cellHoverClass}`}>
                        <input
                            type="text"
                            inputMode="numeric"
                            value={config.chimera_channel === null ? '' : config.chimera_channel}
                            onInput={(e) => {
                                const nextValue = sanitizeIntegerInput(e.target.value);
                                onFieldChange(channelNumber, prev => ({ ...prev, chimera_channel: nextValue }));
                            }}
                            onBlur={() => onAttemptSave(channelNumber)}
                            className="w-20 px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                            placeholder="1-15"
                        />
                    </td>
                )}
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
});

const readExpandedState = (key) => {
    if (!key || typeof window === 'undefined') return false;
    try {
        const stored = window.sessionStorage.getItem(key);
        if (stored === null) return false;
        return Boolean(JSON.parse(stored));
    } catch (error) {
        console.error('Failed to read blackbox expanded state:', error);
        return false;
    }
};

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
    const draftStorageKey = `test_form_blackbox_drafts_${device.id}`;
    const activeStorageKey = `test_form_blackbox_active_${device.id}`;
    const expandedStorageKey = `test_form_blackbox_expanded_${device.id}`;
    const [uploadingCsv, setUploadingCsv] = useState(false);
    const [isExpanded, setIsExpanded] = useState(() => readExpandedState(expandedStorageKey));
    const [channelErrors, setChannelErrors] = useState({});
    const [draftConfigs, setDraftConfigs] = useState({});
    const [selectedChannels, setSelectedChannels] = useState([]);
    const [activeChannels, setActiveChannels] = useState([]);
    const savedConfigsRef = useRef({});
    const skipRowClickRef = useRef(false);
    const [didRestoreDrafts, setDidRestoreDrafts] = useState(false);

    const getChannelConfig = (channelNumber) => {
        return configurations[`${device.id}-${channelNumber}`] || null;
    };

    const getDefaultConfig = () => ({
        inoculum_sample_id: '',
        inoculum_weight_grams: '',
        substrate_sample_id: '',
        substrate_weight_grams: '',
        tumbler_volume: '',
        chimera_channel: null
    });

    const isEmptyDraftConfig = (config) => (
        !config
        || (
            !config.inoculum_sample_id
            && !config.inoculum_weight_grams
            && !config.substrate_sample_id
            && !config.substrate_weight_grams
            && !config.tumbler_volume
            && !config.chimera_channel
        )
    );

    const normalizeConfig = (config) => ({
        ...config,
        inoculum_weight_grams: config.inoculum_weight_grams ? parseFloat(config.inoculum_weight_grams) : '',
        substrate_weight_grams: config.substrate_weight_grams ? parseFloat(config.substrate_weight_grams) : 0,
        tumbler_volume: config.tumbler_volume ? parseFloat(config.tumbler_volume) : '',
        chimera_channel: config.chimera_channel === '' || config.chimera_channel === null || config.chimera_channel === undefined
            ? null
            : parseInt(config.chimera_channel)
    });

    const getDraftConfig = (channelNumber) => draftConfigs[channelNumber] || getDefaultConfig();

    const updateDraftConfigs = (channelNumbers, updater) => {
        setDraftConfigs(prev => {
            const next = { ...prev };
            channelNumbers.forEach(channelNumber => {
                const current = prev[channelNumber] || getDefaultConfig();
                const updated = typeof updater === 'function' ? updater(current, channelNumber) : updater;
                next[channelNumber] = updated;
            });
            return next;
        });
    };

    const getTargetChannels = (channelNumber) => {
        if (selectedChannels.length > 1 && selectedChannels.includes(channelNumber)) {
            return selectedChannels;
        }
        return [channelNumber];
    };

    const isMultiSelectEvent = (event) => (
        event.altKey
        || event.metaKey
        || event.shiftKey
        || event.getModifierState?.('Alt')
        || event.getModifierState?.('Meta')
        || event.getModifierState?.('Shift')
    );

    const handleRowSelection = (channelNumber, event) => {
        if (!isMultiSelectEvent(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setSelectedChannels(prev => (
            prev.includes(channelNumber)
                ? prev.filter(item => item !== channelNumber)
                : [...prev, channelNumber]
        ));
    };

    useEffect(() => {
        setIsExpanded(readExpandedState(expandedStorageKey));
    }, [expandedStorageKey]);

    useEffect(() => {
        try {
            const storedDrafts = sessionStorage.getItem(draftStorageKey);
            if (storedDrafts) {
                const parsed = JSON.parse(storedDrafts);
                if (parsed && typeof parsed === 'object') {
                    setDraftConfigs(parsed);
                }
            }
            const storedActive = sessionStorage.getItem(activeStorageKey);
            if (storedActive) {
                const parsed = JSON.parse(storedActive);
                if (Array.isArray(parsed)) {
                    setActiveChannels(parsed);
                }
            }
        } catch (error) {
            console.error('Failed to restore blackbox draft configs:', error);
        } finally {
            setDidRestoreDrafts(true);
        }
    }, [device.id, draftStorageKey, activeStorageKey]);

    useEffect(() => {
        try {
            sessionStorage.setItem(expandedStorageKey, JSON.stringify(isExpanded));
        } catch (error) {
            console.error('Failed to persist blackbox expanded state:', error);
        }
    }, [isExpanded, expandedStorageKey]);

    useEffect(() => {
        if (!didRestoreDrafts) return;
        try {
            sessionStorage.setItem(draftStorageKey, JSON.stringify(draftConfigs));
        } catch (error) {
            console.error('Failed to persist blackbox draft configs:', error);
        }
    }, [didRestoreDrafts, draftConfigs, draftStorageKey]);

    useEffect(() => {
        if (!didRestoreDrafts) return;
        try {
            sessionStorage.setItem(activeStorageKey, JSON.stringify(activeChannels));
        } catch (error) {
            console.error('Failed to persist blackbox active channels:', error);
        }
    }, [didRestoreDrafts, activeChannels, activeStorageKey]);

    useEffect(() => {
        setActiveChannels(prev => {
            const next = new Set(prev);
            for (let channelNumber = 1; channelNumber <= 15; channelNumber += 1) {
                if (getChannelConfig(channelNumber)) {
                    next.add(channelNumber);
                }
            }
            return Array.from(next);
        });

        setDraftConfigs(prev => {
            const next = { ...prev };
            for (let channelNumber = 1; channelNumber <= 15; channelNumber += 1) {
                const savedConfig = getChannelConfig(channelNumber);
                const previousSaved = savedConfigsRef.current[channelNumber];
                const savedKey = JSON.stringify(savedConfig || null);
                const prevKey = JSON.stringify(previousSaved || null);

                if (savedKey !== prevKey) {
                    const existingDraft = next[channelNumber];
                    if (!existingDraft || isEmptyDraftConfig(existingDraft)) {
                        next[channelNumber] = savedConfig ? { ...getDefaultConfig(), ...savedConfig } : getDefaultConfig();
                    }
                    savedConfigsRef.current[channelNumber] = savedConfig ? { ...savedConfig } : null;
                } else if (!next[channelNumber]) {
                    next[channelNumber] = getDefaultConfig();
                }
            }
            return next;
        });
    }, [configurations, device.id]);

    const toggleActiveChannel = (channelNumber) => {
        const isConfigured = getChannelConfig(channelNumber) !== null;
        setActiveChannels(prev => {
            const isActive = prev.includes(channelNumber) || isConfigured;
            if (isActive) {
                return prev.filter(item => item !== channelNumber);
            }
            return [...prev, channelNumber];
        });

        if (isConfigured) {
            onClearChannelConfig(device.id, channelNumber);
            setDraftConfigs(prev => ({ ...prev, [channelNumber]: getDefaultConfig() }));
            setChannelErrors(prev => ({ ...prev, [channelNumber]: '' }));
        }
    };

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
                        chimera_channel: csvConfig.chimera_channel || null
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

    const columnCount = showChimeraChannel ? 7 : 6;

    const handleExportCsv = () => {
        const rows = Array.from({ length: 15 }, (_, i) => i + 1)
            .map(channelNumber => {
                const config = getChannelConfig(channelNumber);
                if (!config) return null;
                const sampleDescription = `${channelNumber}`;

                const inoculumOnly = Number(config.substrate_weight_grams || 0) === 0;

                return {
                    sampleDescription,
                    inService: 1,
                    inoculumOnly: inoculumOnly ? 1 : 0,
                    inoculumWeight: config.inoculum_weight_grams ?? '',
                    substrateWeight: inoculumOnly ? 0 : (config.substrate_weight_grams ?? ''),
                    tumblerVolume: config.tumbler_volume ?? '',
                    chimeraChannel: config.chimera_channel ?? ''
                };
            })
            .filter(Boolean);

        const headers = [
            'Channel number',
            'In service',
            'Inoculum only',
            'Inoculum mass VS (g)',
            'Sample mass VS (g)',
            'Tumbler volume (ml)'
        ];

        if (showChimeraChannel) {
            headers.push('Chimera channel');
        }

        const normalizedRows = rows.length > 0
            ? rows
            : Array.from({ length: 15 }, (_, i) => ({
                sampleDescription: String(i + 1),
                inService: '',
                inoculumOnly: '',
                inoculumWeight: '',
                substrateWeight: '',
                tumblerVolume: '',
                chimeraChannel: ''
            }));

        const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

        const csvRows = [
            headers.map(escapeCsv).join(','),
            ...normalizedRows.map(row => {
                const data = [
                    row.sampleDescription,
                    row.inService,
                    row.inoculumOnly,
                    row.inoculumWeight,
                    row.substrateWeight,
                    row.tumblerVolume
                ];
                if (showChimeraChannel) {
                    data.push(row.chimeraChannel);
                }
                return data.map(escapeCsv).join(',');
            })
        ];

        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `${device.name || 'gasflow'}-config.csv`);
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    };

    const handleCreateSample = () => {
        window.dispatchEvent(new CustomEvent('app:navigate', {
            detail: {
                view: 'create-sample',
                params: { returnView: 'test' }
            }
        }));
    };

    const applyFieldChange = (channelNumber, updater) => {
        const targets = getTargetChannels(channelNumber);
        setActiveChannels(prev => {
            const next = new Set(prev);
            targets.forEach(target => next.add(target));
            return Array.from(next);
        });
        updateDraftConfigs(targets, updater);
    };

    const attemptSave = (channelNumber) => {
        const targets = getTargetChannels(channelNumber);
        setChannelErrors(prev => {
            const nextErrors = { ...prev };

            targets.forEach(targetChannel => {
                const targetConfig = getDraftConfig(targetChannel);

                if (!targetConfig) {
                    return;
                }

                const isEmptyConfig = (
                    !targetConfig.inoculum_sample_id
                    && !targetConfig.inoculum_weight_grams
                    && !targetConfig.substrate_sample_id
                    && !targetConfig.substrate_weight_grams
                    && !targetConfig.tumbler_volume
                    && !targetConfig.chimera_channel
                );

                if (isEmptyConfig) {
                    onClearChannelConfig(device.id, targetChannel);
                    nextErrors[targetChannel] = '';
                    return;
                }

                const validationError = validateConfig(targetConfig);
                if (validationError) {
                    nextErrors[targetChannel] = validationError;
                    return;
                }

                nextErrors[targetChannel] = '';
                onSaveChannelConfig(device.id, targetChannel, normalizeConfig(targetConfig));
            });

            return nextErrors;
        });
    };

    const handleRowMouseDown = (channelNumber, event) => {
        if (!isMultiSelectEvent(event)) return;
        skipRowClickRef.current = true;
        handleRowSelection(channelNumber, event);
    };

    const handleRowClick = (channelNumber, event) => {
        if (skipRowClickRef.current) {
            skipRowClickRef.current = false;
            return;
        }
        handleRowSelection(channelNumber, event);
    };

    return (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm transition-all hover:shadow-md">
            <div
                className="flex items-center justify-between p-4 bg-gray-50 cursor-pointer border-b border-gray-100 hover:bg-gray-100 transition-colors"
                onClick={() => setIsExpanded(prev => !prev)}
            >
                <div>
                    <h3 className="font-semibold text-gray-900">{device.name}</h3>
                    <p className="text-xs text-gray-500">{tPages('test_config.gas_flow_meter')}</p>
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
                        <div>
                            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                {tPages('test_config.configure_channel')}
                            </h4>
                            <span className="text-xs text-gray-400">{tPages('test_config.gas_flow_meter')}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:border-blue-300 hover:text-blue-600 hover:shadow-sm cursor-pointer transition-all">
                                <Upload size={14} />
                                {tPages('test_config.bulk_config')}
                                <input
                                    type="file"
                                    accept=".csv"
                                    onChange={handleCsvUpload}
                                    disabled={uploadingCsv}
                                    className="hidden"
                                />
                            </label>
                            <button
                                type="button"
                                onClick={handleExportCsv}
                                className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:border-blue-300 hover:text-blue-600 hover:shadow-sm transition-all"
                            >
                                <Download size={14} />
                                {tPages('test_config.export_csv')}
                            </button>
                            <button
                                type="button"
                                onClick={handleCreateSample}
                                className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:border-blue-300 hover:text-blue-600 hover:shadow-sm transition-all"
                            >
                                <Plus size={14} />
                                {tPages('test_config.create_sample')}
                            </button>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="min-w-full border-collapse text-xs">
                            <thead>
                                <tr className="text-[10px] uppercase tracking-wider text-gray-500">
                                    <th className="px-2 py-2 text-left">{tPages('test_config.channel')}</th>
                                    <th className="px-2 py-2 text-left">{tPages('test_config.inoculum_sample')}</th>
                                    <th className="px-2 py-2 text-left">{tPages('test_config.inoculum_weight')}</th>
                                    <th className="px-2 py-2 text-left">{tPages('test_config.tumbler_volume')}</th>
                                    <th className="px-2 py-2 text-left">{tPages('test_config.substrate_sample')}</th>
                                    <th className="px-2 py-2 text-left">{tPages('test_config.substrate_weight')}</th>
                                    {showChimeraChannel && (
                                        <th className="px-2 py-2 text-left">{tPages('test_config.chimera_channel')}</th>
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {Array.from({ length: 15 }, (_, i) => i + 1).map(channelNumber => (
                                    <BlackBoxChannelRow
                                        key={channelNumber}
                                        channelNumber={channelNumber}
                                        config={getDraftConfig(channelNumber)}
                                        error={channelErrors[channelNumber]}
                                        isConfigured={getChannelConfig(channelNumber) !== null}
                                        isControl={(getChannelConfig(channelNumber)?.substrate_weight_grams ?? null) === 0}
                                        isSelected={selectedChannels.includes(channelNumber)}
                                        isActive={activeChannels.includes(channelNumber) || getChannelConfig(channelNumber) !== null}
                                        showChimeraChannel={showChimeraChannel}
                                        inoculums={inoculums}
                                        samples={samples}
                                        tPages={tPages}
                                        onRowMouseDown={handleRowMouseDown}
                                        onRowClick={handleRowClick}
                                        onToggleActive={toggleActiveChannel}
                                        onFieldChange={applyFieldChange}
                                        onAttemptSave={attemptSave}
                                        columnCount={columnCount}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

export default BlackBoxTestConfig;
