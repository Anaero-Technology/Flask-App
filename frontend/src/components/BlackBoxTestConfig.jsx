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

const normalizeInService = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    if (typeof value === 'string') {
        const lowered = value.trim().toLowerCase();
        if (['false', '0', 'no', 'n', 'off'].includes(lowered)) return false;
        if (['true', '1', 'yes', 'y', 'on'].includes(lowered)) return true;
    }
    return fallback;
};

const createDefaultBlackboxConfig = (inService = false) => ({
    inoculum_sample_id: '',
    inoculum_weight_grams: '',
    substrate_sample_id: '',
    substrate_weight_grams: '',
    tumbler_volume: '',
    chimera_channel: null,
    in_service: inService
});

const buildDraftConfigsFromConfigurations = (configurations, deviceId, defaultInService = false) => {
    const next = {};
    for (let channelNumber = 1; channelNumber <= 15; channelNumber += 1) {
        const saved = configurations?.[`${deviceId}-${channelNumber}`];
        if (saved) {
            const inService = normalizeInService(saved.in_service, isConfigActive(saved));
            next[channelNumber] = { ...createDefaultBlackboxConfig(defaultInService), ...saved, in_service: inService };
        } else {
            next[channelNumber] = createDefaultBlackboxConfig(defaultInService);
        }
    }
    return next;
};

const isConfigActive = (config) => {
    if (!config) return false;
    if (config.in_service !== undefined && config.in_service !== null) {
        return normalizeInService(config.in_service, false);
    }
    const hasValue = (value) => {
        if (value === null || value === undefined || value === '') return false;
        if (typeof value === 'number') return value !== 0;
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed === '') return false;
            const numeric = Number(trimmed);
            if (!Number.isNaN(numeric)) return numeric !== 0;
            return true;
        }
        return true;
    };

    return (
        hasValue(config.inoculum_sample_id)
        || hasValue(config.substrate_sample_id)
        || hasValue(config.inoculum_weight_grams)
        || hasValue(config.substrate_weight_grams)
        || hasValue(config.tumbler_volume)
        || hasValue(config.chimera_channel)
    );
};

const BlackBoxChannelRow = React.memo(function BlackBoxChannelRow({
    channelNumber,
    config,
    error,
    isConfigured,
    isControl,
    isSelected,
    isActive,
    disableActiveToggle,
    isReadOnly,
    autoSaveOnBlur,
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
                onMouseDown={(event) => {
                    if (!isReadOnly) {
                        onRowMouseDown(channelNumber, event);
                    }
                }}
                onPointerDown={(event) => {
                    if (!isReadOnly) {
                        onRowMouseDown(channelNumber, event);
                    }
                }}
                onClick={(event) => {
                    if (!isReadOnly) {
                        onRowClick(channelNumber, event);
                    }
                }}
            >
                <td className={`px-2 py-2 text-xs text-gray-700 whitespace-nowrap ${cellClass} ${cellHoverClass}`}>
                    <div className="flex items-center gap-2">
                        <span className="font-semibold">{channelNumber}</span>
                        <input
                            type="checkbox"
                            checked={isActive}
                            onChange={() => {
                                if (!disableActiveToggle && !isReadOnly) {
                                    onToggleActive(channelNumber);
                                }
                            }}
                            disabled={disableActiveToggle || isReadOnly}
                            aria-label={tPages('test_config.active_channel')}
                            className={`h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500/30 ${disableActiveToggle ? 'cursor-not-allowed opacity-60' : ''}`}
                        />
                    </div>
                </td>
                <td className={`px-2 py-2 ${cellClass} ${cellHoverClass}`}>
                    <select
                        value={config.inoculum_sample_id}
                        onChange={(e) => onFieldChange(channelNumber, prev => ({ ...prev, inoculum_sample_id: e.target.value }))}
                        onBlur={() => {
                            if (autoSaveOnBlur) {
                                onAttemptSave(channelNumber);
                            }
                        }}
                        disabled={isReadOnly}
                        className="w-44 px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    >
                        <option value="">{tPages('test_config.select_inoculum')}</option>
                        {inoculums.map(inoculum => (
                            <option key={inoculum.id} value={String(inoculum.id)}>
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
                        onBlur={() => {
                            if (autoSaveOnBlur) {
                                onAttemptSave(channelNumber);
                            }
                        }}
                        disabled={isReadOnly}
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
                        onBlur={() => {
                            if (autoSaveOnBlur) {
                                onAttemptSave(channelNumber);
                            }
                        }}
                        disabled={isReadOnly}
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
                        onBlur={() => {
                            if (autoSaveOnBlur) {
                                onAttemptSave(channelNumber);
                            }
                        }}
                        disabled={isReadOnly}
                        className="w-44 px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    >
                        <option value="">{tPages('test_config.inoculum_only_control')}</option>
                        {samples.map(sample => (
                            <option key={sample.id} value={String(sample.id)}>
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
                        onBlur={() => {
                            if (autoSaveOnBlur) {
                                onAttemptSave(channelNumber);
                            }
                        }}
                        disabled={isReadOnly}
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
                            onBlur={() => {
                                if (autoSaveOnBlur) {
                                    onAttemptSave(channelNumber);
                                }
                            }}
                            disabled={isReadOnly}
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
    showChimeraChannel,
    hideActions = false,
    disableActiveToggle = false,
    disableClear = false,
    embedded = false,
    defaultExpanded = false,
    persistExpandedState = true,
    showUploadCsv = true,
    showExportCsv = true,
    showCreateSample = true,
    readOnly = false,
    persistDrafts = true,
    autoSaveOnBlur = true,
    showSaveButton = false,
    confirmSaveMessage = '',
    saveNoticeMessage = '',
    onSaveComplete,
    onDraftChange,
    onSaveAllChannelConfigs,
    commitOnToggle = false,
    clearOnToggle = true,
    defaultInService = false,
    showActiveOnly = false,
    saveInactiveAsEmpty = false
}) {
    const { authFetch } = useAuth();
    const { t: tPages } = useTranslation('pages');
    const draftStorageKey = `test_form_blackbox_drafts_${device.id}`;
    const expandedStorageKey = `test_form_blackbox_expanded_${device.id}`;
    const [uploadingCsv, setUploadingCsv] = useState(false);
    const [isExpanded, setIsExpanded] = useState(() => (
        persistExpandedState && !embedded ? readExpandedState(expandedStorageKey) : defaultExpanded
    ));
    const [channelErrors, setChannelErrors] = useState({});
    const defaultChannelInService = Boolean(defaultInService);
    const [draftConfigs, setDraftConfigs] = useState(() => (
        buildDraftConfigsFromConfigurations(configurations, device.id, defaultChannelInService)
    ));
    const [selectedChannels, setSelectedChannels] = useState([]);
    const savedConfigsRef = useRef({});
    const skipRowClickRef = useRef(false);
    const [didRestoreDrafts, setDidRestoreDrafts] = useState(false);
    const seededDefaultsRef = useRef(false);
    const isReadOnly = Boolean(readOnly);
    const shouldPersistDrafts = Boolean(persistDrafts);
    const allowClearOnToggle = Boolean(clearOnToggle);
    const shouldCommitOnToggle = Boolean(commitOnToggle);
    const shouldSaveInactiveAsEmpty = Boolean(saveInactiveAsEmpty);

    const getChannelConfig = (channelNumber) => {
        return configurations[`${device.id}-${channelNumber}`] || null;
    };

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

    const normalizeConfig = (config) => {
        return ({
            ...config,
            inoculum_weight_grams: config.inoculum_weight_grams
                ? parseFloat(config.inoculum_weight_grams)
                : 0,
            substrate_weight_grams: config.substrate_weight_grams ? parseFloat(config.substrate_weight_grams) : 0,
            tumbler_volume: config.tumbler_volume ? parseFloat(config.tumbler_volume) : 0,
            chimera_channel: config.chimera_channel === '' || config.chimera_channel === null || config.chimera_channel === undefined
                ? null
                : parseInt(config.chimera_channel),
            in_service: normalizeInService(config.in_service, isConfigActive(config))
        });
    };

    const getDraftConfig = (channelNumber) => (
        draftConfigs[channelNumber] || createDefaultBlackboxConfig(defaultChannelInService)
    );
    const isChannelActive = (channelNumber) => isConfigActive(getDraftConfig(channelNumber));

    const updateDraftConfigs = (channelNumbers, updater) => {
        setDraftConfigs(prev => {
            const next = { ...prev };
            channelNumbers.forEach(channelNumber => {
                const current = prev[channelNumber] || createDefaultBlackboxConfig();
                const updated = typeof updater === 'function' ? updater(current, channelNumber) : updater;
                next[channelNumber] = updated;
            });
            if (typeof onDraftChange === 'function') {
                onDraftChange(device.id, next);
            }
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
        if (!persistExpandedState || embedded) return;
        setIsExpanded(readExpandedState(expandedStorageKey));
    }, [expandedStorageKey, persistExpandedState, embedded]);

    useEffect(() => {
        if (!shouldPersistDrafts) {
            setDidRestoreDrafts(true);
            return;
        }
        try {
            const storedDrafts = sessionStorage.getItem(draftStorageKey);
            if (storedDrafts) {
                const parsed = JSON.parse(storedDrafts);
                if (parsed && typeof parsed === 'object') {
                    setDraftConfigs(parsed);
                }
            }
        } catch (error) {
            console.error('Failed to restore blackbox draft configs:', error);
        } finally {
            setDidRestoreDrafts(true);
        }
    }, [device.id, draftStorageKey, shouldPersistDrafts]);

    useEffect(() => {
        if (!persistExpandedState || embedded) return;
        try {
            sessionStorage.setItem(expandedStorageKey, JSON.stringify(isExpanded));
        } catch (error) {
            console.error('Failed to persist blackbox expanded state:', error);
        }
    }, [isExpanded, expandedStorageKey, persistExpandedState, embedded]);

    useEffect(() => {
        if (!shouldPersistDrafts || !didRestoreDrafts) return;
        try {
            sessionStorage.setItem(draftStorageKey, JSON.stringify(draftConfigs));
        } catch (error) {
            console.error('Failed to persist blackbox draft configs:', error);
        }
    }, [didRestoreDrafts, draftConfigs, draftStorageKey, shouldPersistDrafts]);

    useEffect(() => {
        if (typeof onDraftChange !== 'function') return;
        onDraftChange(device.id, draftConfigs);
    }, [draftConfigs, device.id, onDraftChange]);

    useEffect(() => {
        if (!defaultChannelInService || seededDefaultsRef.current) return;
        if (typeof onConfigurationChange !== 'function') return;

        const hasExisting = Object.keys(configurations || {}).some(key => key.startsWith(`${device.id}-`));
        if (hasExisting) {
            seededDefaultsRef.current = true;
            return;
        }

        const defaults = {};
        for (let channelNumber = 1; channelNumber <= 15; channelNumber += 1) {
            defaults[`${device.id}-${channelNumber}`] = createDefaultBlackboxConfig(true);
        }
        onConfigurationChange(defaults);
        seededDefaultsRef.current = true;
    }, [defaultChannelInService, configurations, device.id, onConfigurationChange]);

    useEffect(() => {
        setDraftConfigs(prev => {
            const next = { ...prev };
            const defaults = buildDraftConfigsFromConfigurations(configurations, device.id, defaultChannelInService);
            for (let channelNumber = 1; channelNumber <= 15; channelNumber += 1) {
                const savedConfig = getChannelConfig(channelNumber);
                const previousSaved = savedConfigsRef.current[channelNumber];
                const savedKey = JSON.stringify(savedConfig || null);
                const prevKey = JSON.stringify(previousSaved || null);

                if (savedKey !== prevKey) {
                    const existingDraft = next[channelNumber];
                    if (!existingDraft || isEmptyDraftConfig(existingDraft)) {
                        next[channelNumber] = defaults[channelNumber];
                    } else {
                        next[channelNumber] = {
                            ...existingDraft,
                            in_service: defaults[channelNumber]?.in_service ?? existingDraft.in_service
                        };
                    }
                    savedConfigsRef.current[channelNumber] = savedConfig ? { ...savedConfig } : null;
                } else if (!next[channelNumber]) {
                    next[channelNumber] = defaults[channelNumber];
                }
            }
            return next;
        });
    }, [configurations, device.id, defaultChannelInService]);

    const toggleActiveChannel = (channelNumber) => {
        const targets = getTargetChannels(channelNumber);
        const isCurrentlyActive = isChannelActive(channelNumber);
        const nextConfigs = {};

        updateDraftConfigs(targets, (current, target) => {
            if (isCurrentlyActive && allowClearOnToggle && getChannelConfig(target) !== null) {
                const cleared = createDefaultBlackboxConfig(false);
                nextConfigs[target] = cleared;
                return cleared;
            }
            const updated = { ...current, in_service: !isCurrentlyActive };
            nextConfigs[target] = updated;
            return updated;
        });

        if (isCurrentlyActive && allowClearOnToggle) {
            targets.forEach(target => {
                if (getChannelConfig(target) !== null) {
                    onClearChannelConfig(device.id, target);
                }
            });
            setChannelErrors(prev => {
                const next = { ...prev };
                targets.forEach(target => {
                    next[target] = '';
                });
                return next;
            });
        }

        if (shouldCommitOnToggle) {
            targets.forEach(target => {
                const hasExisting = getChannelConfig(target) !== null;
                if (isCurrentlyActive && allowClearOnToggle && hasExisting) {
                    onClearChannelConfig(device.id, target);
                    return;
                }
                const configToSave = nextConfigs[target] || getDraftConfig(target);
                onSaveChannelConfig(device.id, target, normalizeConfig(configToSave));
            });
        }
    };

    const handleSaveAll = async () => {
        if (confirmSaveMessage && !window.confirm(confirmSaveMessage)) {
            return;
        }

        const nextErrors = {};
        let hasError = false;
        const toSave = [];

        for (let channelNumber = 1; channelNumber <= 15; channelNumber += 1) {
            const targetConfig = getDraftConfig(channelNumber);
            if (!targetConfig) continue;

            const isActive = isConfigActive(targetConfig);
            const hasSavedConfig = getChannelConfig(channelNumber) !== null;

            const isEmptyConfig = (
                !targetConfig.inoculum_sample_id
                && !targetConfig.inoculum_weight_grams
                && !targetConfig.substrate_sample_id
                && !targetConfig.substrate_weight_grams
                && !targetConfig.tumbler_volume
                && !targetConfig.chimera_channel
            );

            if (!isActive) {
                nextErrors[channelNumber] = '';
                if (hasSavedConfig || (!isEmptyConfig && shouldSaveInactiveAsEmpty)) {
                    toSave.push({
                        channelNumber,
                        config: normalizeConfig({ ...targetConfig, in_service: false })
                    });
                }
                continue;
            }

            if (isEmptyConfig) {
                nextErrors[channelNumber] = '';
                toSave.push({
                    channelNumber,
                    config: normalizeConfig({ ...targetConfig, in_service: true })
                });
                continue;
            }

            const validationError = validateConfig(targetConfig);
            if (validationError) {
                nextErrors[channelNumber] = validationError;
                hasError = true;
                continue;
            }

            nextErrors[channelNumber] = '';
            toSave.push({
                channelNumber,
                config: normalizeConfig({ ...targetConfig, in_service: true })
            });
        }

        setChannelErrors(prev => ({ ...prev, ...nextErrors }));

        if (hasError) {
            return;
        }

        try {
            if (typeof onSaveAllChannelConfigs === 'function') {
                await onSaveAllChannelConfigs(
                    device.id,
                    toSave.map(item => ({
                        channelNumber: item.channelNumber,
                        config: item.config
                    }))
                );
            } else {
                await Promise.all(
                    toSave.map(item => onSaveChannelConfig(device.id, item.channelNumber, item.config))
                );
            }
            if (onSaveComplete) {
                onSaveComplete();
            }
        } catch (error) {
            alert(error.message || tPages('test_config.save_failed'));
        }
    };

    const validateConfig = (config) => {
        if (config.tumbler_volume !== '' && config.tumbler_volume !== null && config.tumbler_volume !== undefined) {
            const tumblerValue = parseFloat(config.tumbler_volume);
            if (isNaN(tumblerValue) || tumblerValue < 0) {
                return tPages('test_config.error_tumbler_volume');
            }
        }

        if (showChimeraChannel && config.chimera_channel !== null && config.chimera_channel !== undefined && config.chimera_channel !== '') {
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
                    const inService = normalizeInService(csvConfig.in_service, true);
                    newConfigurations[configKey] = {
                        inoculum_sample_id: '',
                        inoculum_weight_grams: csvConfig.inoculum_weight_grams,
                        substrate_sample_id: '',
                        substrate_weight_grams: csvConfig.substrate_weight_grams,
                        tumbler_volume: csvConfig.tumbler_volume,
                        chimera_channel: csvConfig.chimera_channel || null,
                        in_service: inService,
                        notes: csvConfig.notes || ''
                    };
                    appliedCount++;
                }
            });

            // Update parent configurations
            onConfigurationChange(newConfigurations);

            // Directly update draft configs so values appear in the form immediately
            // (the sync effect only partially updates non-empty drafts)
            setDraftConfigs(prev => {
                const next = { ...prev };
                result.configurations.forEach(csvConfig => {
                    if (csvConfig.channel_number >= 1 && csvConfig.channel_number <= 15) {
                        const inService = normalizeInService(csvConfig.in_service, true);
                        next[csvConfig.channel_number] = {
                            ...(prev[csvConfig.channel_number] || createDefaultBlackboxConfig()),
                            inoculum_sample_id: '',
                            inoculum_weight_grams: csvConfig.inoculum_weight_grams,
                            substrate_sample_id: '',
                            substrate_weight_grams: csvConfig.substrate_weight_grams,
                            tumbler_volume: csvConfig.tumbler_volume,
                            chimera_channel: csvConfig.chimera_channel || null,
                            in_service: inService,
                            notes: csvConfig.notes || ''
                        };
                    }
                });
                return next;
            });

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
    const activeDraftChannels = React.useMemo(() => {
        const list = [];
        for (let channelNumber = 1; channelNumber <= 15; channelNumber += 1) {
            if (isConfigActive(getDraftConfig(channelNumber))) {
                list.push(channelNumber);
            }
        }
        return list;
    }, [draftConfigs]);
    const displayedChannels = showActiveOnly
        ? (activeDraftChannels.length > 0 ? activeDraftChannels : Array.from({ length: 15 }, (_, i) => i + 1))
        : Array.from({ length: 15 }, (_, i) => i + 1);

    const handleExportCsv = () => {
        const rows = Array.from({ length: 15 }, (_, i) => i + 1)
            .map(channelNumber => {
                const config = getChannelConfig(channelNumber);
                if (!config) return null;
                const sampleDescription = `${channelNumber}`;

                const inoculumOnly = Number(config.substrate_weight_grams || 0) === 0;
                const inService = normalizeInService(config.in_service, isConfigActive(config)) ? 1 : 0;

                return {
                    sampleDescription,
                    inService,
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
        if (isReadOnly) return;
        const targets = getTargetChannels(channelNumber);
        updateDraftConfigs(targets, (current, target) => {
            const updated = typeof updater === 'function' ? updater(current, target) : updater;
            return { ...updated, in_service: true };
        });
    };

    const attemptSave = (channelNumber) => {
        if (isReadOnly) return;
        const targets = getTargetChannels(channelNumber);
        setChannelErrors(prev => {
            const nextErrors = { ...prev };

            targets.forEach(targetChannel => {
                const targetConfig = getDraftConfig(targetChannel);

                if (!targetConfig) {
                    return;
                }

                const isActive = isConfigActive(targetConfig);
                const isEmptyConfig = (
                    !targetConfig.inoculum_sample_id
                    && !targetConfig.inoculum_weight_grams
                    && !targetConfig.substrate_sample_id
                    && !targetConfig.substrate_weight_grams
                    && !targetConfig.tumbler_volume
                    && !targetConfig.chimera_channel
                );

                if (!isActive) {
                    nextErrors[targetChannel] = '';
                    if (shouldSaveInactiveAsEmpty && getChannelConfig(targetChannel) !== null) {
                        onSaveChannelConfig(device.id, targetChannel, normalizeConfig({ ...targetConfig, in_service: false }));
                    }
                    return;
                }

                if (isEmptyConfig) {
                    nextErrors[targetChannel] = '';
                    onSaveChannelConfig(device.id, targetChannel, normalizeConfig({ ...targetConfig, in_service: true }));
                    return;
                }

                const validationError = validateConfig(targetConfig);
                if (validationError) {
                    nextErrors[targetChannel] = validationError;
                    return;
                }

                nextErrors[targetChannel] = '';
                onSaveChannelConfig(device.id, targetChannel, normalizeConfig({ ...targetConfig, in_service: true }));
            });

            return nextErrors;
        });
    };

    const handleRowMouseDown = (channelNumber, event) => {
        if (isReadOnly) return;
        if (!isMultiSelectEvent(event)) return;
        skipRowClickRef.current = true;
        handleRowSelection(channelNumber, event);
    };

    const handleRowClick = (channelNumber, event) => {
        if (isReadOnly) return;
        if (skipRowClickRef.current) {
            skipRowClickRef.current = false;
            return;
        }
        handleRowSelection(channelNumber, event);
    };

    const actionsContent = !hideActions ? (
        <div className="flex items-center gap-2">
            {showSaveButton && (
                <button
                    type="button"
                    onClick={handleSaveAll}
                    className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition-all"
                >
                    {tPages('test_config.save_changes')}
                </button>
            )}
            {showUploadCsv && (
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
            )}
            {showExportCsv && (
                <button
                    type="button"
                    onClick={handleExportCsv}
                    className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:border-blue-300 hover:text-blue-600 hover:shadow-sm transition-all"
                >
                    <Download size={14} />
                    {tPages('test_config.export_csv')}
                </button>
            )}
            {showCreateSample && (
                <button
                    type="button"
                    onClick={handleCreateSample}
                    className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:border-blue-300 hover:text-blue-600 hover:shadow-sm transition-all"
                >
                    <Plus size={14} />
                    {tPages('test_config.create_sample')}
                </button>
            )}
        </div>
    ) : null;

    const content = (
        <div className={embedded ? '' : 'p-6'}>
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        {tPages('test_config.configure_channel')}
                    </h4>
                    <span className="text-xs text-gray-400">{tPages('test_config.gas_flow_meter')}</span>
                    {saveNoticeMessage && (
                        <div className="mt-1 text-[11px] text-amber-700">
                            {saveNoticeMessage}
                        </div>
                    )}
                </div>
                {actionsContent}
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
                        {displayedChannels.map(channelNumber => (
                            <BlackBoxChannelRow
                                key={channelNumber}
                                channelNumber={channelNumber}
                                config={getDraftConfig(channelNumber)}
                                error={channelErrors[channelNumber]}
                                isConfigured={getChannelConfig(channelNumber) !== null}
                                isControl={(getChannelConfig(channelNumber)?.substrate_weight_grams ?? null) === 0}
                                isSelected={selectedChannels.includes(channelNumber)}
                                isActive={isChannelActive(channelNumber)}
                                disableActiveToggle={disableActiveToggle}
                                isReadOnly={isReadOnly}
                                showChimeraChannel={showChimeraChannel}
                                inoculums={inoculums}
                                samples={samples}
                                tPages={tPages}
                                onRowMouseDown={handleRowMouseDown}
                                onRowClick={handleRowClick}
                                onToggleActive={toggleActiveChannel}
                                onFieldChange={applyFieldChange}
                                onAttemptSave={attemptSave}
                                autoSaveOnBlur={autoSaveOnBlur}
                                columnCount={columnCount}
                            />
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );

    if (embedded) {
        return content;
    }

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

            {isExpanded && content}
        </div>
    );
}

export default BlackBoxTestConfig;
