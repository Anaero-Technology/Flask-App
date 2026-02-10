import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
    useReactTable,
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    flexRender,
} from '@tanstack/react-table';
import { ChevronDown, ChevronRight, Edit2 } from 'lucide-react';
import { useAuth } from '../components/AuthContext';
import BlackBoxTestConfig from '../components/BlackBoxTestConfig';
import { useTranslation } from 'react-i18next';

const Database = ({ onViewPlot, initialParams }) => {
    const { authFetch, canPerform } = useAuth();
    const { t: tPages } = useTranslation('pages');
    const [activeTable, setActiveTable] = useState('tests');
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [globalFilter, setGlobalFilter] = useState('');
    const [sorting, setSorting] = useState([]);
    const [expandedTests, setExpandedTests] = useState(new Set());
    const [expandedSamples, setExpandedSamples] = useState(new Set());
    const [testDetails, setTestDetails] = useState({});
    const [editingBlackbox, setEditingBlackbox] = useState({});
    const [blackboxConfigOverrides, setBlackboxConfigOverrides] = useState({});
    const [sampleOptions, setSampleOptions] = useState([]);
    const [sampleOptionsLoading, setSampleOptionsLoading] = useState(false);
    const [pendingSampleId, setPendingSampleId] = useState(null);
    const [pendingTestId, setPendingTestId] = useState(null);
    const [editingSampleId, setEditingSampleId] = useState(null);
    const [sampleDrafts, setSampleDrafts] = useState({});
    const [savingSampleId, setSavingSampleId] = useState(null);
    const [editingTestId, setEditingTestId] = useState(null);
    const [testDrafts, setTestDrafts] = useState({});
    const [savingTestId, setSavingTestId] = useState(null);
    const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 });
    const [paginationByTable, setPaginationByTable] = useState({
        samples: { pageIndex: 0, pageSize: 10 },
        tests: { pageIndex: 0, pageSize: 10 }
    });

    useEffect(() => {
        if (activeTable === 'inoculums') {
            setActiveTable('samples');
            return;
        }
        fetchData();
    }, [activeTable]);

    useEffect(() => {
        if (!initialParams?.focusTestId) return;
        const parsedTestId = Number(initialParams.focusTestId);
        if (!Number.isFinite(parsedTestId)) return;
        setActiveTable('tests');
        setGlobalFilter('');
        setPendingTestId(parsedTestId);
        setPaginationByTable(current => ({
            ...current,
            tests: {
                ...(current.tests || { pageIndex: 0, pageSize: 10 }),
                pageIndex: 0
            }
        }));
    }, [initialParams]);

    useEffect(() => {
        setPagination(paginationByTable[activeTable] || { pageIndex: 0, pageSize: 10 });
    }, [activeTable, paginationByTable]);

    useEffect(() => {
        if (activeTable !== 'samples' || !pendingSampleId) return;
        if (loading) return;
        const index = data.findIndex(sample => sample.id === pendingSampleId);
        if (index === -1) {
            setPendingSampleId(null);
            return;
        }
        const pageSize = pagination.pageSize || 10;
        const nextPage = Math.floor(index / pageSize);
        setPagination(prev => ({ ...prev, pageIndex: nextPage }));
        setPaginationByTable(prev => ({
            ...prev,
            samples: { ...(prev.samples || prev[activeTable] || {}), pageIndex: nextPage, pageSize }
        }));
        setExpandedSamples(prev => {
            const next = new Set(prev);
            next.add(pendingSampleId);
            return next;
        });
        setPendingSampleId(null);
    }, [activeTable, pendingSampleId, data, loading, pagination.pageSize]);

    useEffect(() => {
        if (activeTable !== 'tests' || !pendingTestId) return;
        if (loading) return;
        const index = data.findIndex(test => test.id === pendingTestId);
        if (index === -1) {
            setPendingTestId(null);
            return;
        }
        const targetTest = data[index];
        const pageSize = pagination.pageSize || 10;
        const nextPage = Math.floor(index / pageSize);
        setPagination(prev => ({ ...prev, pageIndex: nextPage }));
        setPaginationByTable(prev => ({
            ...prev,
            tests: { ...(prev.tests || prev[activeTable] || {}), pageIndex: nextPage, pageSize }
        }));
        setExpandedTests(prev => {
            const next = new Set(prev);
            next.add(pendingTestId);
            return next;
        });
        if (!testDetails[pendingTestId]) {
            fetchTestDetails(targetTest);
        }
        setPendingTestId(null);
    }, [activeTable, pendingTestId, data, loading, pagination.pageSize, testDetails]);

    const mergeSampleLists = (samplesList = [], inoculumsList = []) => {
        const map = new Map();
        samplesList.forEach(sample => {
            map.set(sample.id, {
                ...sample,
                is_inoculum: Boolean(sample.is_inoculum)
            });
        });
        inoculumsList.forEach(sample => {
            const existing = map.get(sample.id);
            const merged = existing ? {
                ...existing,
                is_inoculum: true,
                substrate_source: existing.substrate_source || sample.inoculum_source || sample.substrate_source
            } : {
                ...sample,
                is_inoculum: true,
                substrate_source: sample.inoculum_source || sample.substrate_source
            };
            map.set(sample.id, merged);
        });
        return Array.from(map.values());
    };

    const fetchData = async () => {
        setLoading(true);
        try {
            let endpoint = '';
            if (activeTable === 'samples') endpoint = '/api/v1/samples?include_inoculum=true';
            else if (activeTable === 'tests') endpoint = '/api/v1/tests?include_devices=true';

            const response = await authFetch(endpoint);
            const result = await response.json();

            if (activeTable === 'samples') {
                let inoculums = [];
                try {
                    const inoculumResponse = await authFetch('/api/v1/inoculum');
                    if (inoculumResponse.ok) {
                        inoculums = await inoculumResponse.json();
                    }
                } catch (error) {
                    console.warn('Failed to fetch inoculums list:', error);
                }
                const merged = mergeSampleLists(Array.isArray(result) ? result : [], Array.isArray(inoculums) ? inoculums : []);
                const sortedData = merged.sort((a, b) => b.id - a.id);
                setData(sortedData);
                return;
            }

            // Sort by ID descending (newest first) in case backend sorting isn't working
            const sortedData = result.sort((a, b) => b.id - a.id);
            setData(sortedData);
        } catch (error) {
            console.error('Error fetching data:', error);
        } finally {
            setLoading(false);
        }
    };

    const getDisplayValue = (value) => {
        if (value === null || value === undefined || value === '') {
            return tPages('database.na');
        }
        return value;
    };

    const handlePaginationChange = (updater) => {
        setPagination(prev => {
            const next = typeof updater === 'function' ? updater(prev) : updater;
            setPaginationByTable(current => ({
                ...current,
                [activeTable]: next
            }));
            return next;
        });
    };

    const handleSampleLinkClick = (sampleId) => {
        if (!sampleId) return;
        const targetTable = 'samples';
        setActiveTable(targetTable);
        setGlobalFilter('');
        setPendingSampleId(sampleId);
        setPaginationByTable(current => ({
            ...current,
            [targetTable]: {
                ...(current[targetTable] || { pageIndex: 0, pageSize: 10 }),
                pageIndex: 0
            }
        }));
    };

    const ensureSampleOptions = async () => {
        if (sampleOptions.length > 0 || sampleOptionsLoading) {
            return;
        }
        setSampleOptionsLoading(true);
        try {
            const response = await authFetch('/api/v1/samples?include_inoculum=true');
            const samplesResult = response.ok ? await response.json() : [];
            let inoculumsResult = [];
            try {
                const inoculumResponse = await authFetch('/api/v1/inoculum');
                if (inoculumResponse.ok) {
                    inoculumsResult = await inoculumResponse.json();
                }
            } catch (error) {
                console.warn('Failed to fetch inoculums for options:', error);
            }
            const merged = mergeSampleLists(
                Array.isArray(samplesResult) ? samplesResult : [],
                Array.isArray(inoculumsResult) ? inoculumsResult : []
            );
            setSampleOptions(merged);
        } catch (error) {
            console.error('Error fetching sample options:', error);
        } finally {
            setSampleOptionsLoading(false);
        }
    };

    const getSampleLists = () => {
        const inoculums = sampleOptions.filter(sample => Boolean(sample.is_inoculum));
        const substrates = sampleOptions.filter(sample => !Boolean(sample.is_inoculum));
        return { inoculums, substrates };
    };

    const buildBlackboxConfigMap = (deviceId, channels) => {
        const map = {};
        channels.forEach(channel => {
            const inService = channel.in_service === undefined || channel.in_service === null
                ? true
                : Boolean(channel.in_service);
            map[`${deviceId}-${channel.channel_number}`] = {
                inoculum_sample_id: channel.inoculum_sample_id ? String(channel.inoculum_sample_id) : '',
                inoculum_weight_grams: channel.inoculum_weight_grams !== null && channel.inoculum_weight_grams !== undefined
                    ? String(channel.inoculum_weight_grams)
                    : '',
                substrate_sample_id: channel.substrate_sample_id ? String(channel.substrate_sample_id) : '',
                substrate_weight_grams: channel.substrate_weight_grams !== null && channel.substrate_weight_grams !== undefined
                    ? String(channel.substrate_weight_grams)
                    : '',
                tumbler_volume: channel.tumbler_volume !== null && channel.tumbler_volume !== undefined
                    ? String(channel.tumbler_volume)
                    : '',
                chimera_channel: channel.chimera_channel !== null && channel.chimera_channel !== undefined
                    ? String(channel.chimera_channel)
                    : null,
                in_service: inService
            };
        });
        return map;
    };

    const toggleBlackboxEdit = async (testId, config) => {
        const key = `${testId}-${config.device_id}`;
        const isEditing = Boolean(editingBlackbox[key]);
        setEditingBlackbox(prev => ({ ...prev, [key]: !isEditing }));
        if (!isEditing) {
            await ensureSampleOptions();
            setBlackboxConfigOverrides(prev => ({
                ...prev,
                [key]: prev[key] || buildBlackboxConfigMap(config.device_id, config.channels)
            }));
        }
    };

    const updateBlackboxConfigOverrides = (testId, deviceId, updater) => {
        const key = `${testId}-${deviceId}`;
        setBlackboxConfigOverrides(prev => ({
            ...prev,
            [key]: typeof updater === 'function' ? updater(prev[key] || {}) : updater
        }));
    };

    const resolveSampleName = (sampleId) => {
        const found = sampleOptions.find(sample => sample.id === sampleId);
        return found ? found.sample_name : null;
    };

    const updateTestDetailsChannel = (testId, deviceId, channelNumber, config) => {
        setTestDetails(prev => {
            const current = prev[testId];
            if (!current) return prev;
            const updatedBlackboxConfigs = (current.blackboxConfigs || []).map(deviceConfig => {
                if (deviceConfig.device_id !== deviceId) return deviceConfig;
                const channels = deviceConfig.channels.map(channel => {
                    if (channel.channel_number !== channelNumber) return channel;
                    const inoculumName = config.inoculum_sample_id ? resolveSampleName(config.inoculum_sample_id) : null;
                    const substrateName = config.substrate_sample_id ? resolveSampleName(config.substrate_sample_id) : null;
                    let sampleName = null;
                    if (inoculumName && substrateName) {
                        sampleName = `${inoculumName} + ${substrateName}`;
                    } else {
                        sampleName = inoculumName || substrateName || null;
                    }
                    return {
                        ...channel,
                        inoculum_sample_id: config.inoculum_sample_id || null,
                        substrate_sample_id: config.substrate_sample_id || null,
                        inoculum_name: inoculumName,
                        substrate_name: substrateName,
                        sample_name: sampleName,
                        inoculum_weight_grams: config.inoculum_weight_grams ?? channel.inoculum_weight_grams,
                        substrate_weight_grams: config.substrate_weight_grams ?? channel.substrate_weight_grams,
                        tumbler_volume: config.tumbler_volume ?? channel.tumbler_volume,
                        chimera_channel: config.chimera_channel ?? channel.chimera_channel,
                        in_service: config.in_service ?? channel.in_service
                    };
                });
                return { ...deviceConfig, channels };
            });
            return {
                ...prev,
                [testId]: {
                    ...current,
                    blackboxConfigs: updatedBlackboxConfigs
                }
            };
        });
    };

    const saveBlackboxChannel = async (testId, deviceId, channelNumber, config) => {
        const normalizeNumber = (value) => {
            if (value === '' || value === null || value === undefined) return 0;
            const numeric = Number(value);
            return Number.isNaN(numeric) ? 0 : numeric;
        };
        const chimeraChannel = config.chimera_channel === '' || config.chimera_channel === null || config.chimera_channel === undefined
            ? null
            : parseInt(config.chimera_channel, 10);
        const inService = config.in_service === undefined || config.in_service === null
            ? false
            : Boolean(config.in_service);

        const payload = {
            configurations: [
                {
                    device_id: deviceId,
                    channel_number: channelNumber,
                    inoculum_sample_id: config.inoculum_sample_id || null,
                    inoculum_weight_grams: normalizeNumber(config.inoculum_weight_grams),
                    substrate_sample_id: config.substrate_sample_id || null,
                    substrate_weight_grams: normalizeNumber(config.substrate_weight_grams),
                    tumbler_volume: normalizeNumber(config.tumbler_volume),
                    chimera_channel: chimeraChannel,
                    in_service: inService
                }
            ]
        };
        const response = await authFetch(`/api/v1/tests/${testId}/configurations`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || tPages('database.update_failed'));
        }
        updateTestDetailsChannel(testId, deviceId, channelNumber, payload.configurations[0]);
    };

    const saveBlackboxChannelsBatch = async (testId, deviceId, channelConfigs) => {
        const normalizeNumber = (value) => {
            if (value === '' || value === null || value === undefined) return 0;
            const numeric = Number(value);
            return Number.isNaN(numeric) ? 0 : numeric;
        };

        const payload = {
            configurations: channelConfigs.map(({ channelNumber, config }) => {
                const chimeraChannel = config.chimera_channel === '' || config.chimera_channel === null || config.chimera_channel === undefined
                    ? null
                    : parseInt(config.chimera_channel, 10);
                const inService = config.in_service === undefined || config.in_service === null
                    ? false
                    : Boolean(config.in_service);
                return {
                    device_id: deviceId,
                    channel_number: channelNumber,
                    inoculum_sample_id: config.inoculum_sample_id || null,
                    inoculum_weight_grams: normalizeNumber(config.inoculum_weight_grams),
                    substrate_sample_id: config.substrate_sample_id || null,
                    substrate_weight_grams: normalizeNumber(config.substrate_weight_grams),
                    tumbler_volume: normalizeNumber(config.tumbler_volume),
                    chimera_channel: chimeraChannel,
                    in_service: inService
                };
            })
        };

        const response = await authFetch(`/api/v1/tests/${testId}/configurations`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || tPages('database.update_failed'));
        }

        payload.configurations.forEach((configuration) => {
            updateTestDetailsChannel(
                testId,
                configuration.device_id,
                configuration.channel_number,
                configuration
            );
        });
    };

    const toggleSampleExpanded = (sampleId) => {
        setExpandedSamples(prev => {
            const next = new Set(prev);
            if (next.has(sampleId)) {
                next.delete(sampleId);
            } else {
                next.add(sampleId);
            }
            return next;
        });
    };

    const startEditingSample = (sample) => {
        setEditingSampleId(sample.id);
        setSampleDrafts(prev => ({
            ...prev,
            [sample.id]: {
                sample_name: sample.sample_name || '',
                substrate_source: sample.substrate_source || '',
                description: sample.description || '',
                substrate_type: sample.substrate_type || '',
                substrate_subtype: sample.substrate_subtype || '',
                substrate_percent_ts: sample.substrate_percent_ts ?? '',
                substrate_percent_vs: sample.substrate_percent_vs ?? '',
                c_content: sample.c_content ?? '',
                n_content: sample.n_content ?? '',
                ash_content: sample.ash_content ?? ''
            }
        }));
    };

    const cancelEditingSample = () => {
        setEditingSampleId(null);
    };

    const updateSampleDraft = (sampleId, field, value) => {
        setSampleDrafts(prev => ({
            ...prev,
            [sampleId]: {
                ...(prev[sampleId] || {}),
                [field]: value
            }
        }));
    };

    const testDraftsRef = useRef(testDrafts);
    const editingTestIdRef = useRef(editingTestId);
    const savingTestIdRef = useRef(savingTestId);
    const fetchDataRef = useRef(fetchData);
    fetchDataRef.current = fetchData;

    const startEditingTest = useCallback((test) => {
        editingTestIdRef.current = test.id;
        setEditingTestId(test.id);
        const draft = { name: test.name || '', description: test.description || '' };
        testDraftsRef.current = { ...testDraftsRef.current, [test.id]: draft };
        setTestDrafts(prev => ({ ...prev, [test.id]: draft }));
    }, []);

    const cancelEditingTest = useCallback(() => {
        editingTestIdRef.current = null;
        setEditingTestId(null);
    }, []);

    const updateTestDraft = useCallback((testId, field, value) => {
        testDraftsRef.current = {
            ...testDraftsRef.current,
            [testId]: { ...(testDraftsRef.current[testId] || {}), [field]: value }
        };
        setTestDrafts(prev => ({
            ...prev,
            [testId]: { ...(prev[testId] || {}), [field]: value }
        }));
    }, []);

    const saveTest = useCallback(async (testId) => {
        const draft = testDraftsRef.current[testId];
        if (!draft) return;
        savingTestIdRef.current = testId;
        setSavingTestId(testId);
        try {
            const response = await authFetch(`/api/v1/tests/${testId}`, {
                method: 'PUT',
                body: JSON.stringify({
                    name: draft.name,
                    description: draft.description
                })
            });
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || tPages('database.update_failed'));
            }

            setData(prev => prev.map(test => (
                test.id === testId
                    ? { ...test, name: draft.name, description: draft.description }
                    : test
            )));
            editingTestIdRef.current = null;
            setEditingTestId(null);
        } catch (error) {
            alert(error.message || tPages('database.update_failed'));
        } finally {
            savingTestIdRef.current = null;
            setSavingTestId(null);
        }
    }, [authFetch, tPages]);

    const saveSample = async (sampleId) => {
        const draft = sampleDrafts[sampleId];
        if (!draft) return;
        setSavingSampleId(sampleId);
        try {
            const response = await authFetch(`/api/v1/samples/${sampleId}`, {
                method: 'PUT',
                body: JSON.stringify(draft)
            });
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || tPages('database.update_failed'));
            }

            setData(prev => prev.map(sample => (
                sample.id === sampleId
                    ? { ...sample, ...draft }
                    : sample
            )));
            setEditingSampleId(null);
        } catch (error) {
            alert(error.message || tPages('database.update_failed'));
        } finally {
            setSavingSampleId(null);
        }
    };

    const fetchJson = async (endpoint) => {
        const response = await authFetch(endpoint);
        if (!response.ok) {
            let message = tPages('database.details_failed');
            try {
                const error = await response.json();
                if (error?.error) message = error.error;
            } catch (err) {
                // ignore JSON parse errors
            }
            throw new Error(message);
        }
        return response.json();
    };

    const fetchTestDetails = async (test) => {
        const testId = test.id;
        setTestDetails(prev => ({
            ...prev,
            [testId]: {
                ...(prev[testId] || {}),
                loading: true,
                error: null
            }
        }));

        try {
            const devices = test.devices || [];
            const blackboxDevices = devices.filter(device => ['black-box', 'black_box'].includes(device.device_type));
            const chimeraDevices = devices.filter(device => ['chimera', 'chimera-max'].includes(device.device_type));

            const blackboxPromise = blackboxDevices.length > 0
                ? Promise.all(
                    blackboxDevices.map(async (device) => (
                        fetchJson(`/api/v1/tests/${testId}/blackbox-configuration/${device.id}`)
                    ))
                )
                : Promise.resolve([]);

            const chimeraPromise = chimeraDevices.length > 0
                ? fetchJson(`/api/v1/tests/${testId}/chimera-configuration`)
                : Promise.resolve(null);

            const testConfigPromise = fetchJson(`/api/v1/tests/${testId}`);

            const [blackboxConfigs, chimeraConfig, testConfig] = await Promise.all([
                blackboxPromise,
                chimeraPromise,
                testConfigPromise
            ]);

            setTestDetails(prev => ({
                ...prev,
                [testId]: {
                    loading: false,
                    error: null,
                    blackboxConfigs,
                    chimeraConfig,
                    channelConfigurations: Array.isArray(testConfig?.configurations)
                        ? testConfig.configurations
                        : []
                }
            }));
        } catch (error) {
            setTestDetails(prev => ({
                ...prev,
                [testId]: {
                    loading: false,
                    error: error.message || tPages('database.details_failed'),
                    blackboxConfigs: [],
                    chimeraConfig: null
                }
            }));
        }
    };

    const toggleTestExpanded = (test) => {
        const isExpanded = expandedTests.has(test.id);
        setExpandedTests(prev => {
            const next = new Set(prev);
            if (isExpanded) {
                next.delete(test.id);
            } else {
                next.add(test.id);
            }
            return next;
        });

        if (!isExpanded) {
            fetchTestDetails(test);
        }
    };

    const renderSampleLink = (label, sampleId) => {
        if (!label) return getDisplayValue(label);
        return (
            <button
                type="button"
                onClick={() => handleSampleLinkClick(sampleId)}
                className="text-blue-600 hover:text-blue-700 hover:underline"
            >
                {label}
            </button>
        );
    };

    const renderSampleLinks = (channel) => {
        const hasInoculum = channel.inoculum_name;
        const hasSubstrate = channel.substrate_name;

        if (!hasInoculum && !hasSubstrate) {
            const fallbackName = channel.sample_name;
            const fallbackId = channel.sample_id || channel.sampleId;
            return fallbackName ? renderSampleLink(fallbackName, fallbackId) : getDisplayValue(fallbackName);
        }

        return (
            <div className="space-y-1">
                {hasInoculum && renderSampleLink(channel.inoculum_name, channel.inoculum_sample_id)}
                {hasSubstrate && renderSampleLink(channel.substrate_name, channel.substrate_sample_id)}
            </div>
        );
    };

    const renderInoculumLink = (channel) => {
        if (!channel?.inoculum_name) return getDisplayValue(channel?.inoculum_name);
        return renderSampleLink(channel.inoculum_name, channel.inoculum_sample_id);
    };

    const renderSubstrateLink = (channel) => {
        if (!channel?.substrate_name) return getDisplayValue(channel?.substrate_name);
        return renderSampleLink(channel.substrate_name, channel.substrate_sample_id);
    };

    const isChannelEnabled = (channel) => {
        if (channel?.in_service === undefined || channel?.in_service === null) return true;
        return Boolean(channel.in_service);
    };

    const renderTestDetails = (test) => {
        const details = testDetails[test.id];
        if (!details || details.loading) {
            return (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                    {tPages('database.loading')}
                </div>
            );
        }

        if (details.error) {
            return (
                <div className="text-sm text-red-600">
                    {details.error}
                </div>
            );
        }

        const blackboxConfigs = details.blackboxConfigs || [];
        const chimeraConfig = details.chimeraConfig;

        const channelConfigLookup = (details.channelConfigurations || []).reduce((acc, config) => {
            const deviceId = config.device_id ?? config.deviceId;
            const channelNumber = config.channel_number ?? config.channelNumber;
            if (deviceId && channelNumber !== undefined && channelNumber !== null) {
                acc[`${deviceId}-${channelNumber}`] = config.chimera_channel ?? config.chimeraChannel ?? null;
            }
            return acc;
        }, {});
        const resolveChimeraChannel = (channel, deviceId) => (
            channel.chimera_channel
            ?? channel.chimeraChannel
            ?? channel.chimera_channel_number
            ?? channel.chimeraChannelNumber
            ?? channelConfigLookup[`${deviceId}-${channel.channel_number}`]
            ?? null
        );

        const recirculationMode = chimeraConfig?.chimera_config?.recirculation_mode;
        const recirculationLabel = recirculationMode
            ? (
                recirculationMode === 'off'
                    ? tPages('chimera_config.off')
                    : recirculationMode === 'volume'
                        ? tPages('chimera_config.volume')
                        : tPages('chimera_config.periodic')
            )
            : tPages('database.na');
        const canEditBlackbox = canPerform('modify_test');
        const { inoculums, substrates } = getSampleLists();

        return (
            <div className="space-y-3">
                {blackboxConfigs.length > 0 && (
                    <div className="space-y-3">
                        {blackboxConfigs.map(config => {
                            const enabledChannels = (config.channels || []).filter(isChannelEnabled);
                            const isEditing = editingBlackbox[`${test.id}-${config.device_id}`];
                            return (
                                <div key={config.device_id} className="bg-white border border-gray-200 rounded-lg p-4">
                                    <div className="flex items-center justify-between mb-3">
                                        <h4 className="text-sm font-semibold text-gray-800">
                                            {tPages('test_form.channel_configuration')}: {config.device_name}
                                        </h4>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-gray-500">
                                                {enabledChannels.length} {tPages('database.channels_used')}
                                            </span>
                                            {canEditBlackbox && (
                                                <button
                                                    type="button"
                                                    onClick={() => toggleBlackboxEdit(test.id, config)}
                                                    className="px-3 py-1 text-xs font-semibold text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100"
                                                >
                                                    {isEditing ? tPages('database.done') : tPages('database.edit')}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    {isEditing ? (
                                        sampleOptionsLoading && sampleOptions.length === 0 ? (
                                            <div className="text-sm text-gray-500">{tPages('database.loading')}</div>
                                        ) : (
                                            <BlackBoxTestConfig
                                                device={{ id: config.device_id, name: config.device_name }}
                                                configurations={blackboxConfigOverrides[`${test.id}-${config.device_id}`] || buildBlackboxConfigMap(config.device_id, config.channels)}
                                                samples={substrates}
                                                inoculums={inoculums}
                                                onConfigurationChange={(nextConfigs) => updateBlackboxConfigOverrides(test.id, config.device_id, nextConfigs)}
                                                onSaveChannelConfig={async (deviceId, channelNumber, channelConfig) => {
                                                    try {
                                                        await saveBlackboxChannel(test.id, deviceId, channelNumber, channelConfig);
                                                        updateBlackboxConfigOverrides(test.id, config.device_id, prev => ({
                                                            ...prev,
                                                            [`${deviceId}-${channelNumber}`]: channelConfig
                                                        }));
                                                    } catch (error) {
                                                        alert(error.message || tPages('database.update_failed'));
                                                    }
                                                }}
                                                onClearChannelConfig={() => {}}
                                                showChimeraChannel={Boolean(chimeraConfig)}
                                                showUploadCsv
                                                showExportCsv={false}
                                                showCreateSample={false}
                                                autoSaveOnBlur={false}
                                                showSaveButton
                                                confirmSaveMessage={tPages('test_config.confirm_save_reprocess')}
                                                saveNoticeMessage={tPages('test_config.save_reprocess_notice')}
                                                onSaveAllChannelConfigs={(deviceId, channelConfigs) => (
                                                    saveBlackboxChannelsBatch(test.id, deviceId, channelConfigs)
                                                )}
                                                onSaveComplete={() => {
                                                    setEditingBlackbox(prev => ({ ...prev, [`${test.id}-${config.device_id}`]: false }));
                                                    fetchTestDetails(test);
                                                }}
                                                disableActiveToggle={false}
                                                disableClear
                                                embedded
                                                defaultExpanded
                                                persistExpandedState={false}
                                                persistDrafts={false}
                                                clearOnToggle={false}
                                                showActiveOnly={false}
                                            />
                                        )
                                    ) : (
                                        enabledChannels.length > 0 ? (
                                            <div className="overflow-x-auto">
                                                <table className="min-w-full text-xs">
                                                    <thead className="text-[10px] uppercase tracking-wider text-gray-400">
                                                        <tr>
                                                            <th className="px-2 py-2 text-left">{tPages('test_config.channel')}</th>
                                                            <th className="px-2 py-2 text-left">{tPages('test_config.inoculum_sample')}</th>
                                                            <th className="px-2 py-2 text-left">{tPages('test_config.inoculum_weight')}</th>
                                                            <th className="px-2 py-2 text-left">{tPages('test_config.tumbler_volume')}</th>
                                                            <th className="px-2 py-2 text-left">{tPages('test_config.substrate_sample')}</th>
                                                            <th className="px-2 py-2 text-left">{tPages('test_config.substrate_weight')}</th>
                                                            {chimeraConfig && (
                                                                <th className="px-2 py-2 text-left">{tPages('test_config.chimera_channel')}</th>
                                                            )}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {enabledChannels.map(channel => (
                                                            <tr key={channel.channel_number} className="border-t border-gray-100">
                                                                <td className="px-2 py-2 font-semibold text-gray-700">{channel.channel_number}</td>
                                                                <td className="px-2 py-2 text-gray-700">{renderInoculumLink(channel)}</td>
                                                                <td className="px-2 py-2 text-gray-700">{getDisplayValue(channel.inoculum_weight_grams)}</td>
                                                                <td className="px-2 py-2 text-gray-700">{getDisplayValue(channel.tumbler_volume)}</td>
                                                                <td className="px-2 py-2 text-gray-700">{renderSubstrateLink(channel)}</td>
                                                                <td className="px-2 py-2 text-gray-700">{getDisplayValue(channel.substrate_weight_grams)}</td>
                                                                {chimeraConfig && (
                                                                    <td className="px-2 py-2 text-gray-700">{getDisplayValue(resolveChimeraChannel(channel, config.device_id))}</td>
                                                                )}
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        ) : (
                                            <div className="text-sm text-gray-500">{tPages('database.no_channels')}</div>
                                        )
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {chimeraConfig && (
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="text-sm font-semibold text-gray-800">{tPages('chimera_config.title')}</h4>
                            <span className="text-xs text-gray-500">
                                {chimeraConfig.channels?.length || 0} {tPages('database.channels_used')}
                            </span>
                        </div>

                        {chimeraConfig.chimera_config ? (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm text-gray-700 mb-4">
                                <div>
                                    <span className="text-xs uppercase text-gray-400 block">{tPages('chimera_config.flush')}</span>
                                    <span>{getDisplayValue(chimeraConfig.chimera_config.flush_time_seconds)} {tPages('chimera_config.sec')}</span>
                                </div>
                                <div>
                                    <span className="text-xs uppercase text-gray-400 block">{tPages('chimera_config.recirculation')}</span>
                                    <span>{recirculationLabel}</span>
                                </div>
                                <div>
                                    <span className="text-xs uppercase text-gray-400 block">{tPages('chimera_config.every')}</span>
                                    <span>{getDisplayValue(chimeraConfig.chimera_config.recirculation_delay_seconds)} {tPages('chimera_config.sec')}</span>
                                </div>
                            </div>
                        ) : (
                            <div className="text-sm text-gray-500 mb-3">{tPages('database.no_channels')}</div>
                        )}

                        {chimeraConfig.channels?.length > 0 ? (
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-xs">
                                    <thead className="text-[10px] uppercase tracking-wider text-gray-400">
                                        <tr>
                                            <th className="px-2 py-2 text-left">{tPages('test_config.channel')}</th>
                                            <th className="px-2 py-2 text-left">{tPages('chimera_config.open')}</th>
                                            <th className="px-2 py-2 text-left">{tPages('chimera_config.vol')}</th>
                                            <th className="px-2 py-2 text-left">{tPages('database.sample_name')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {chimeraConfig.channels.map(channel => (
                                            <tr key={channel.channel_number} className="border-t border-gray-100">
                                                <td className="px-2 py-2 font-semibold text-gray-700">{channel.channel_number}</td>
                                                <td className="px-2 py-2 text-gray-700">{getDisplayValue(channel.open_time_seconds)}</td>
                                                <td className="px-2 py-2 text-gray-700">{getDisplayValue(channel.volume_threshold_ml)}</td>
                                                <td className="px-2 py-2 text-gray-700">{renderSampleLinks(channel)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="text-sm text-gray-500">{tPages('database.no_channels')}</div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    const renderSampleDetails = (sample) => {
        const isEditing = editingSampleId === sample.id;
        const draft = sampleDrafts[sample.id] || {
            sample_name: sample.sample_name || '',
            substrate_source: sample.substrate_source || '',
            description: sample.description || '',
            substrate_type: sample.substrate_type || '',
            substrate_subtype: sample.substrate_subtype || '',
            substrate_percent_ts: sample.substrate_percent_ts ?? '',
            substrate_percent_vs: sample.substrate_percent_vs ?? '',
            c_content: sample.c_content ?? '',
            n_content: sample.n_content ?? '',
            ash_content: sample.ash_content ?? ''
        };

        return (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        {tPages('database.details')}
                    </h4>
                    {canPerform('modify_sample') && (
                        <div className="flex items-center gap-2">
                            {isEditing ? (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => saveSample(sample.id)}
                                        disabled={savingSampleId === sample.id}
                                        className="px-3 py-1 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60"
                                    >
                                        {savingSampleId === sample.id ? tPages('database.saving') : tPages('database.save')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={cancelEditingSample}
                                        className="px-3 py-1 text-xs font-semibold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
                                    >
                                        {tPages('database.cancel')}
                                    </button>
                                </>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => startEditingSample(sample)}
                                    className="px-3 py-1 text-xs font-semibold text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100"
                                >
                                    {tPages('database.edit')}
                                </button>
                            )}
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-sm text-gray-700">
                    <div className="space-y-4">
                        <div>
                            <h5 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                                {tPages('sample_form.identification')}
                            </h5>
                            <div className="space-y-3">
                                <div>
                                    <span className="text-xs uppercase text-gray-400 block">{tPages('database.sample_name')}</span>
                                    {isEditing ? (
                                        <input
                                            type="text"
                                            value={draft.sample_name}
                                            onChange={(event) => updateSampleDraft(sample.id, 'sample_name', event.target.value)}
                                            className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                                        />
                                    ) : (
                                        <span className="font-medium">{getDisplayValue(sample.sample_name)}</span>
                                    )}
                                </div>
                                <div>
                                    <span className="text-xs uppercase text-gray-400 block">{tPages('database.substrate_source')}</span>
                                    {isEditing ? (
                                        <input
                                            type="text"
                                            value={draft.substrate_source}
                                            onChange={(event) => updateSampleDraft(sample.id, 'substrate_source', event.target.value)}
                                            className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                                        />
                                    ) : (
                                        <span>{getDisplayValue(sample.substrate_source)}</span>
                                    )}
                                </div>
                                <div>
                                    <span className="text-xs uppercase text-gray-400 block">{tPages('database.type')}</span>
                                    {isEditing ? (
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={draft.substrate_type}
                                                onChange={(event) => updateSampleDraft(sample.id, 'substrate_type', event.target.value)}
                                                className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                                                placeholder={tPages('database.type')}
                                            />
                                            <input
                                                type="text"
                                                value={draft.substrate_subtype}
                                                onChange={(event) => updateSampleDraft(sample.id, 'substrate_subtype', event.target.value)}
                                                className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                                                placeholder={tPages('database.sub_type')}
                                            />
                                        </div>
                                    ) : (
                                        <span>{getDisplayValue([sample.substrate_type, sample.substrate_subtype].filter(Boolean).join(' / '))}</span>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div>
                            <h5 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                                {tPages('sample_form.notes_description')}
                            </h5>
                            {isEditing ? (
                                <textarea
                                    value={draft.description}
                                    onChange={(event) => updateSampleDraft(sample.id, 'description', event.target.value)}
                                    rows={4}
                                    className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                                />
                            ) : (
                                <p className="text-sm">{getDisplayValue(sample.description)}</p>
                            )}
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <h5 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                                {tPages('sample_form.physical_properties')}
                            </h5>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <span className="text-xs uppercase text-gray-400 block">{tPages('sample_form.total_solids')}</span>
                                    {isEditing ? (
                                        <input
                                            type="number"
                                            value={draft.substrate_percent_ts}
                                            onChange={(event) => updateSampleDraft(sample.id, 'substrate_percent_ts', event.target.value)}
                                            className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                                        />
                                    ) : (
                                        <span>{getDisplayValue(sample.substrate_percent_ts)}</span>
                                    )}
                                </div>
                                <div>
                                    <span className="text-xs uppercase text-gray-400 block">{tPages('sample_form.volatile_solids')}</span>
                                    {isEditing ? (
                                        <input
                                            type="number"
                                            value={draft.substrate_percent_vs}
                                            onChange={(event) => updateSampleDraft(sample.id, 'substrate_percent_vs', event.target.value)}
                                            className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                                        />
                                    ) : (
                                        <span>{getDisplayValue(sample.substrate_percent_vs)}</span>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div>
                            <h5 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                                {tPages('sample_form.chemical_composition')}
                            </h5>
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <span className="text-xs uppercase text-gray-400 block">{tPages('sample_form.carbon')}</span>
                                    {isEditing ? (
                                        <input
                                            type="number"
                                            value={draft.c_content}
                                            onChange={(event) => updateSampleDraft(sample.id, 'c_content', event.target.value)}
                                            className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                                        />
                                    ) : (
                                        <span>{getDisplayValue(sample.c_content)}</span>
                                    )}
                                </div>
                                <div>
                                    <span className="text-xs uppercase text-gray-400 block">{tPages('sample_form.nitrogen')}</span>
                                    {isEditing ? (
                                        <input
                                            type="number"
                                            value={draft.n_content}
                                            onChange={(event) => updateSampleDraft(sample.id, 'n_content', event.target.value)}
                                            className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                                        />
                                    ) : (
                                        <span>{getDisplayValue(sample.n_content)}</span>
                                    )}
                                </div>
                                <div>
                                    <span className="text-xs uppercase text-gray-400 block">{tPages('sample_form.ash_content')}</span>
                                    {isEditing ? (
                                        <input
                                            type="number"
                                            value={draft.ash_content}
                                            onChange={(event) => updateSampleDraft(sample.id, 'ash_content', event.target.value)}
                                            className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                                        />
                                    ) : (
                                        <span>{getDisplayValue(sample.ash_content)}</span>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <span className="text-xs uppercase text-gray-400 block">{tPages('database.created_by')}</span>
                                <span>{getDisplayValue(sample.author)}</span>
                            </div>
                            <div>
                                <span className="text-xs uppercase text-gray-400 block">{tPages('database.date_created')}</span>
                                <span>{sample.date_created ? new Date(sample.date_created).toLocaleDateString() : tPages('database.na')}</span>
                            </div>
                        </div>

                        <div>
                            <span className="text-xs uppercase text-gray-400 block">{tPages('database.sample_kind')}</span>
                            <span>{sample.is_inoculum ? tPages('sample_form.inoculum') : tPages('sample_form.substrate')}</span>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    // Define columns for each table type
    const samplesColumns = useMemo(() => [
        {
            id: 'expand',
            header: '',
            size: 40,
            cell: info => {
                const sample = info.row.original;
                const isExpanded = expandedSamples.has(sample.id);
                return (
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            toggleSampleExpanded(sample.id);
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 text-gray-500 hover:bg-gray-100"
                        aria-label={tPages('database.details')}
                    >
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                );
            }
        },
        {
            accessorKey: 'sample_name',
            header: tPages('database.sample_name'),
            size: 200,
            cell: info => {
                const sample = info.row.original;
                return (
                    <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{sample.sample_name}</span>
                        {sample.is_inoculum && (
                            <span className="text-[10px] uppercase tracking-wider bg-purple-50 text-purple-700 border border-purple-200 rounded-full px-2 py-0.5">
                                {tPages('database.inoculum')}
                            </span>
                        )}
                    </div>
                );
            }
        },
        { accessorKey: 'substrate_source', header: tPages('database.substrate_source'), size: 180 },
        {
            accessorKey: 'substrate_type',
            header: tPages('database.type'),
            size: 180,
            cell: info => {
                const sample = info.row.original;
                const typeValue = [sample.substrate_type, sample.substrate_subtype].filter(Boolean).join(' / ');
                return getDisplayValue(typeValue);
            }
        },
        {
            accessorKey: 'author',
            header: tPages('database.created_by'),
            size: 140,
            cell: info => getDisplayValue(info.getValue())
        },
        {
            accessorKey: 'date_created',
            header: tPages('database.date_created'),
            size: 140,
            cell: info => info.getValue() ? new Date(info.getValue()).toLocaleDateString() : tPages('database.na')
        }
    ], [tPages, expandedSamples]);

    const testsColumns = useMemo(() => [
        {
            id: 'expand',
            header: '',
            size: 36,
            cell: info => {
                const test = info.row.original;
                const isExpanded = expandedTests.has(test.id);
                return (
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            toggleTestExpanded(test);
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 text-gray-500 hover:bg-gray-100"
                        aria-label={tPages('database.details')}
                    >
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                );
            }
        },
        {
            accessorKey: 'name',
            header: tPages('database.test_name'),
            size: 140,
            cell: info => {
                const test = info.row.original;
                const isEditing = editingTestIdRef.current === test.id;
                const canEditTest = canPerform('modify_test');
                if (!isEditing) {
                    return (
                        <div className="flex items-start gap-2 group/edit whitespace-normal">
                            <span className="line-clamp-2">{getDisplayValue(test.name)}</span>
                            {canEditTest && (
                                <button
                                    type="button"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        startEditingTest(test);
                                    }}
                                    className="opacity-0 group-hover/edit:opacity-100 text-gray-400 hover:text-blue-600 transition-opacity shrink-0"
                                    aria-label={tPages('database.edit')}
                                >
                                    <Edit2 size={14} />
                                </button>
                            )}
                        </div>
                    );
                }
                const draft = testDraftsRef.current[test.id] || { name: test.name || '', description: test.description || '' };
                return (
                    <input
                        type="text"
                        value={draft.name}
                        onChange={(event) => updateTestDraft(test.id, 'name', event.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    />
                );
            }
        },
        {
            accessorKey: 'description',
            header: tPages('database.description'),
            size: 180,
            cell: info => {
                const test = info.row.original;
                const isEditing = editingTestIdRef.current === test.id;
                const canEditTest = canPerform('modify_test');
                if (!isEditing) {
                    return (
                        <div className="flex items-start gap-2 group/edit whitespace-normal">
                            <span className="line-clamp-2">{getDisplayValue(info.getValue())}</span>
                            {canEditTest && (
                                <button
                                    type="button"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        startEditingTest(test);
                                    }}
                                    className="opacity-0 group-hover/edit:opacity-100 text-gray-400 hover:text-blue-600 transition-opacity shrink-0"
                                    aria-label={tPages('database.edit')}
                                >
                                    <Edit2 size={14} />
                                </button>
                            )}
                        </div>
                    );
                }
                const draft = testDraftsRef.current[test.id] || { name: test.name || '', description: test.description || '' };
                return (
                    <input
                        type="text"
                        value={draft.description}
                        onChange={(event) => updateTestDraft(test.id, 'description', event.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    />
                );
            }
        },
        {
            accessorKey: 'status',
            header: tPages('database.status'),
            size: 80,
            cell: info => {
                const status = info.getValue();
                const colorClass = status === 'running' ? 'bg-green-100 text-green-800' :
                    status === 'completed' ? 'bg-blue-100 text-blue-800' :
                        'bg-gray-100 text-gray-800';
                const statusLabel = status === 'running' ? tPages('database.running') :
                    status === 'completed' ? tPages('database.completed') : status;
                return (
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${colorClass}`}>
                        {statusLabel}
                    </span>
                );
            }
        },
        {
            accessorKey: 'date_started',
            header: tPages('database.started'),
            size: 85,
            cell: info => info.getValue() ? new Date(info.getValue()).toLocaleDateString() : '-'
        },
        {
            accessorKey: 'date_ended',
            header: tPages('database.ended'),
            size: 85,
            cell: info => info.getValue() ? new Date(info.getValue()).toLocaleDateString() : '-'
        },
        { accessorKey: 'created_by', header: tPages('database.created_by'), size: 90 },
        {
            id: 'actions',
            header: tPages('database.actions'),
            size: 250,
            cell: info => {
                const test = info.row.original;
                const hasDevices = test.devices && test.devices.length > 0;
                const canEditTest = canPerform('modify_test');
                const isEditing = editingTestIdRef.current === test.id;
                const isSaving = savingTestIdRef.current === test.id;
                const draft = testDraftsRef.current[test.id] || { name: test.name || '', description: test.description || '' };

                return (
                    <div className="flex items-center justify-between gap-2 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <button
                                onClick={() => hasDevices && onViewPlot(test.id, test.devices[0].id, 'database')}
                                disabled={!hasDevices}
                                className="px-2 py-1 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {tPages('database.view_plot')}
                            </button>
                            {canPerform('delete_test') && (
                                <button
                                    onClick={async () => {
                                        try {
                                            const response = await authFetch(`/api/v1/tests/${test.id}/download`);
                                            if (response.ok) {
                                                const blob = await response.blob();
                                                const url = window.URL.createObjectURL(blob);
                                                const a = document.createElement('a');
                                                a.href = url;
                                                // Use filename from Content-Disposition header if available
                                                const disposition = response.headers.get('Content-Disposition');
                                                const filenameMatch = disposition && disposition.match(/filename=(.+)/);
                                                a.download = filenameMatch ? filenameMatch[1] : `test_${test.id}_data.csv`;
                                                document.body.appendChild(a);
                                                a.click();
                                                window.URL.revokeObjectURL(url);
                                                a.remove();
                                            } else {
                                                alert(tPages('database.download_failed'));
                                            }
                                        } catch (error) {
                                            console.error('Download error:', error);
                                            alert(tPages('database.download_failed'));
                                        }
                                    }}
                                    className="px-2 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                                >
                                    {tPages('database.download')}
                                </button>
                            )}
                            {test.status === 'running' ? (
                                canPerform('stop_test') && (
                                    <button
                                        onClick={async () => {
                                            const stopWarningMessage = `${tPages('database.stop_confirmation')}\n\nStopping this test will stop logging on all devices associated with this test.`;
                                            if (window.confirm(stopWarningMessage)) {
                                                try {
                                                    const response = await authFetch(`/api/v1/tests/${test.id}/stop`, {
                                                        method: 'POST'
                                                    });
                                                    if (response.ok) {
                                                        fetchDataRef.current();
                                                    } else {
                                                        const err = await response.json();
                                                        alert(tPages('database.stop_failed') + (err.error || 'Unknown error'));
                                                    }
                                                } catch (error) {
                                                    console.error('Error stopping test:', error);
                                                    alert(tPages('database.stop_error'));
                                                }
                                            }
                                        }}
                                        className="px-2 py-1 text-xs font-medium text-orange-600 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors"
                                    >
                                        {tPages('database.stop')}
                                    </button>
                                )
                            ) : (
                                canPerform('delete_test') && (
                                    <button
                                        onClick={async () => {
                                            if (window.confirm(tPages('database.delete_confirmation'))) {
                                                try {
                                                    const response = await authFetch(`/api/v1/tests/${test.id}`, {
                                                        method: 'DELETE'
                                                    });
                                                    if (response.ok) {
                                                        fetchDataRef.current();
                                                    } else {
                                                        const err = await response.json();
                                                        alert(tPages('database.delete_failed') + err.error);
                                                    }
                                                } catch (error) {
                                                    console.error('Error deleting test:', error);
                                                    alert(tPages('database.delete_error'));
                                                }
                                            }
                                        }}
                                        className="px-2 py-1 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                                    >
                                        {tPages('database.delete')}
                                    </button>
                                )
                            )}
                        </div>
                        {canEditTest && isEditing && (
                            <div className="flex items-center gap-1.5">
                                <button
                                    onClick={() => saveTest(test.id)}
                                    disabled={isSaving || !String(draft.name || '').trim()}
                                    className="px-2 py-1 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60"
                                >
                                    {isSaving ? tPages('database.saving') : tPages('database.save')}
                                </button>
                                <button
                                    onClick={cancelEditingTest}
                                    className="px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
                                >
                                    {tPages('database.cancel')}
                                </button>
                            </div>
                        )}
                    </div>
                );
            }
        }
    ], [
        onViewPlot,
        canPerform,
        tPages,
        expandedTests,
        startEditingTest,
        updateTestDraft,
        saveTest,
        cancelEditingTest
    ]);

    const columns = useMemo(() => {
        if (activeTable === 'samples') return samplesColumns;
        if (activeTable === 'tests') return testsColumns;
        return [];
    }, [activeTable, samplesColumns, testsColumns]);

    const table = useReactTable({
        data,
        columns,
        state: {
            globalFilter,
            sorting,
            pagination
        },
        onGlobalFilterChange: setGlobalFilter,
        onSortingChange: setSorting,
        onPaginationChange: handlePaginationChange,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
    });

    return (
        <div className="space-y-4">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{tPages('database.title')}</h1>

            <div className="bg-white rounded-lg shadow-sm p-6">
                {/* Table Selection */}
                <div className="mb-6">
                    <div className="flex space-x-4 mb-4">
                        <button
                            onClick={() => setActiveTable('samples')}
                            className={`px-4 py-2 rounded-lg font-medium border-2 transition-all ${activeTable === 'samples'
                                ? '!border-blue-600 !bg-white !text-black'
                                : '!border-gray-300 !bg-gray-100 !text-gray-700'
                                } hover:!bg-gray-200`}
                        >
                            {tPages('database.samples')}
                        </button>
                        <button
                            onClick={() => setActiveTable('tests')}
                            className={`px-4 py-2 rounded-lg font-medium border-2 transition-all ${activeTable === 'tests'
                                ? '!border-blue-600 !bg-white !text-black'
                                : '!border-gray-300 !bg-gray-100 !text-gray-700'
                                } hover:!bg-gray-200`}
                        >
                            {tPages('database.tests')}
                        </button>
                    </div>

                    {/* Search and Refresh */}
                    <div className="flex items-center space-x-4">
                        <input
                            type="text"
                            placeholder={tPages('database.search_placeholder')}
                            value={globalFilter ?? ''}
                            onChange={e => setGlobalFilter(e.target.value)}
                            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <button
                            onClick={fetchData}
                            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                        >
                            {tPages('database.refresh')}
                        </button>
                    </div>
                </div>

                {/* Table */}
                {loading ? (
                    <div className="flex justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent"></div>
                    </div>
                ) : (
                    <>
                        <div className="overflow-hidden border border-gray-200 rounded-lg">
                            <table className="w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    {table.getHeaderGroups().map(headerGroup => (
                                        <tr key={headerGroup.id}>
                                            {headerGroup.headers.map(header => (
                                                <th
                                                    key={header.id}
                                                    className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                                    onClick={header.column.getToggleSortingHandler()}
                                                    style={{ width: header.column.columnDef.size }}
                                                >
                                                    <div className="flex items-center gap-2">
                                                        {flexRender(
                                                            header.column.columnDef.header,
                                                            header.getContext()
                                                        )}
                                                        {{
                                                            asc: ' 🔼',
                                                            desc: ' 🔽',
                                                        }[header.column.getIsSorted()] ?? null}
                                                    </div>
                                                </th>
                                            ))}
                                        </tr>
                                    ))}
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {table.getRowModel().rows.map(row => {
                                        const rowItem = row.original;
                                        const isTestExpanded = activeTable === 'tests' && expandedTests.has(rowItem.id);
                                        const isSampleExpanded = activeTable === 'samples' && expandedSamples.has(rowItem.id);
                                        return (
                                            <React.Fragment key={row.id}>
                                                <tr className="hover:bg-gray-50">
                                                    {row.getVisibleCells().map(cell => (
                                                        <td
                                                            key={cell.id}
                                                            className="px-3 py-2 text-sm text-gray-900 whitespace-nowrap"
                                                        >
                                                            {flexRender(
                                                                cell.column.columnDef.cell,
                                                                cell.getContext()
                                                            )}
                                                        </td>
                                                    ))}
                                                </tr>
                                                {isTestExpanded && (
                                                    <tr className="bg-gray-50">
                                                        <td
                                                            colSpan={table.getVisibleFlatColumns().length}
                                                            className="px-4 py-4"
                                                        >
                                                            {renderTestDetails(rowItem)}
                                                        </td>
                                                    </tr>
                                                )}
                                                {isSampleExpanded && (
                                                    <tr className="bg-gray-50">
                                                        <td
                                                            colSpan={table.getVisibleFlatColumns().length}
                                                            className="px-4 py-4"
                                                        >
                                                            {renderSampleDetails(rowItem)}
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination */}
                        <div className="flex items-center justify-between mt-4">
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-700">
                                    {tPages('database.showing')} {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1} {tPages('database.to')}{' '}
                                    {Math.min(
                                        (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
                                        table.getFilteredRowModel().rows.length
                                    )}{' '}
                                    {tPages('database.of')} {table.getFilteredRowModel().rows.length} {tPages('database.entries')}
                                </span>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => table.setPageIndex(0)}
                                    disabled={!table.getCanPreviousPage()}
                                    className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {'<<'}
                                </button>
                                <button
                                    onClick={() => table.previousPage()}
                                    disabled={!table.getCanPreviousPage()}
                                    className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {'<'}
                                </button>
                                <span className="text-sm text-gray-700">
                                    {tPages('database.page')} {table.getState().pagination.pageIndex + 1} {tPages('database.of')} {table.getPageCount()}
                                </span>
                                <button
                                    onClick={() => table.nextPage()}
                                    disabled={!table.getCanNextPage()}
                                    className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {'>'}
                                </button>
                                <button
                                    onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                                    disabled={!table.getCanNextPage()}
                                    className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {'>>'}
                                </button>
                                <select
                                    value={table.getState().pagination.pageSize}
                                    onChange={e => table.setPageSize(Number(e.target.value))}
                                    className="ml-2 px-2 py-1 border border-gray-300 rounded"
                                >
                                    {[10, 20, 50, 100].map(pageSize => (
                                        <option key={pageSize} value={pageSize}>
                                            {tPages('database.show')} {pageSize}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Empty State */}
                        {table.getFilteredRowModel().rows.length === 0 && (
                            <div className="text-center py-8 text-gray-500">
                                {tPages('database.no_data_found', { table: activeTable })}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

export default Database;
