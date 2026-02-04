import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
    useReactTable,
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    flexRender,
} from '@tanstack/react-table';
import Plotly from 'react-plotly.js';
import { useToast } from '../components/Toast';
import { Settings, X, Maximize2, Minimize2, Info, AlertTriangle, Eye, EyeOff, Trash2 } from 'lucide-react';
import { useAuth } from '../components/AuthContext';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../components/ThemeContext';
import ConfirmDialog from '../components/ConfirmDialog';

// Format gas names with proper subscripts (for Plotly - uses HTML)
const formatGasName = (name) => {
    if (!name) return name;
    return name.replace(/([A-Za-z])(\d+)/g, '$1<sub>$2</sub>');
};

// Format gas names with Unicode subscripts (for React text/dropdowns)
const formatGasNameUnicode = (name) => {
    if (!name) return name;
    const subscripts = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };
    return name.replace(/([A-Za-z])(\d+)/g, (_match, letter, num) => {
        return letter + num.split('').map(d => subscripts[d] || d).join('');
    });
};

function Plot({ initialParams, onNavigate }) {
    const { authFetch, canPerform } = useAuth(); 
    const toast = useToast();
    const { t: tPages } = useTranslation('pages');
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    // All state declarations first
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [globalFilter, setGlobalFilter] = useState('');
    const [sorting, setSorting] = useState([]);
    const [selectedTest, setSelectedTest] = useState(null);
    const [showPlotView, setShowPlotView] = useState(false);
    const [testDetails, setTestDetails] = useState(null);
    const [devices, setDevices] = useState([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState(null);
    const [plotData, setPlotData] = useState(null);
    const [fetchingData, setFetchingData] = useState(false);
    const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
    const [fullscreenGraph, setFullscreenGraph] = useState(false);
    const [aggregation, setAggregation] = useState('none'); // 'daily', 'hourly', 'none'
    const [yAxisMetric, setYAxisMetric] = useState('temperature');
    const [graphType, setGraphType] = useState('scatter'); // 'scatter', 'line', 'bar'
    const [selectedPoints, setSelectedPoints] = useState([]);
    const [outlierIds, setOutlierIds] = useState(new Set());  // Set of DB row IDs currently labeled as outliers
    const [showOutliers, setShowOutliers] = useState(true);   // toggle: true = outliers visible as X markers; false = hidden entirely
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false); // gates the ConfirmDialog
    const [xAxisMode, setXAxisMode] = useState('timestamp'); // 'timestamp', 'day', 'hour', 'minute'
    const [groupingMode, setGroupingMode] = useState('gas'); // 'gas', 'channel'
    const [selectedChannel, setSelectedChannel] = useState(null);
    const [error, setError] = useState(null);
    const [selectedGas, setSelectedGas] = useState(null);
    const [unitFilter, setUnitFilter] = useState('all'); // 'all', 'ppm', 'percent'

    // All refs next
    const plotDivRef = useRef(null);

    // Define fetch functions as useCallbacks BEFORE useEffects that use them
    const fetchTests = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await authFetch('/api/v1/tests');
            if (response.ok) {
                const result = await response.json();
                const sortedData = result.sort((a, b) => b.id - a.id);
                setData(sortedData);
            }
        } catch (error) {
            console.error('Error fetching tests:', error);
        } finally {
            setLoading(false);
        }
    }, [authFetch]);

    const fetchTestDetails = useCallback(async (testId, targetDeviceId = null) => {
        setError(null);
        try {
            const response = await authFetch(`/api/v1/tests/${testId}`);
            if (response.ok) {
                const details = await response.json();
                setTestDetails(details);
            }

            const devicesResponse = await authFetch(`/api/v1/tests/${testId}/devices`);
            if (devicesResponse.ok) {
                const testDevices = await devicesResponse.json();
                setDevices(testDevices);

                if (testDevices.length > 0) {
                    const deviceIdToSelect = targetDeviceId || testDevices[0].id;
                    setSelectedDeviceId(deviceIdToSelect);
                }
            }
        } catch (error) {
            console.error('Error fetching test details:', error);
        }
    }, [authFetch]);

    const fetchPlotData = useCallback(async () => {
        if (!selectedTest || !selectedDeviceId) return;

        setFetchingData(true);

        try {
            // Determine data type based on aggregation and device
            const device = devices.find(d => d.id === selectedDeviceId);
            let type = 'processed';
            let aggParam = aggregation;

            if (device && device.device_type.includes('chimera')) {
                type = 'raw';
                // Allow aggregation for Chimera
                aggParam = aggregation === 'none' ? 'raw' : aggregation;
            } else {
                // BlackBox
                // Default to 'processed' (Event Log), backend will fallback to 'raw' if empty
                type = 'processed';

                // Aggregation logic
                if (aggregation === 'none') {
                    aggParam = 'raw';
                } else {
                    aggParam = aggregation;
                }
            }

            const url = `/api/v1/tests/${selectedTest.id}/device/${selectedDeviceId}/data?type=${type}&aggregation=${aggParam}`;

            const response = await authFetch(url);
            if (response.ok) {
                const result = await response.json();
                setPlotData(result);
                setError(null);
            } else {
                const err = await response.json();
                console.error('Failed to fetch plot data', err);
                setPlotData(null);
                if (err.code === 'NO_EVENT_LOG_DATA' || err.code === 'NO_CHANNEL_CONFIG') {
                    setError(err.error);
                } else {
                    setError('Failed to load data');
                }
            }
        } catch (error) {
            console.error('Error fetching plot data:', error);
            setPlotData(null);
        } finally {
            setFetchingData(false);
        }
    }, [selectedTest, selectedDeviceId, devices, aggregation, authFetch]);

    // Fetch tests on component mount
    useEffect(() => {
        fetchTests();
    }, [fetchTests]);

    // Handle initial params
    useEffect(() => {
        if (initialParams && initialParams.testId) {
            authFetch(`/api/v1/tests/${initialParams.testId}`)
                .then(res => res.json())
                .then(test => {
                    setSelectedTest(test);
                    setShowPlotView(true);
                })
                .catch(err => console.error("Failed to load initial test", err));
        }
    }, [initialParams, authFetch]);

    useEffect(() => {
        if (selectedTest) {
            fetchTestDetails(selectedTest.id, initialParams?.deviceId);
        }
    }, [selectedTest, initialParams?.deviceId, fetchTestDetails]);

    // Fetch plot data when test/device/aggregation changes
    useEffect(() => {
        if (selectedTest && selectedDeviceId) {
            // Reset aggregation when device changes if needed
            const device = devices.find(d => d.id === selectedDeviceId);
            if (device) {
                if (device.device_type.includes('chimera')) {
                    // Chimera now supports aggregation, so no need to force reset unless invalid
                    if (!['daily', 'hourly', 'minute', 'none'].includes(aggregation)) setAggregation('none');
                }
            }
            fetchPlotData();
        } else {
            setPlotData(null);
        }
    }, [selectedTest, selectedDeviceId, aggregation, devices, fetchPlotData]);

    // Helper to determine data type based on device
    const getDataType = useCallback(() => {
        const device = devices.find(d => d.id === selectedDeviceId);
        return device?.device_type.includes('chimera') ? 'raw' : 'processed';
    }, [devices, selectedDeviceId]);

    // Fetch outliers from database
    const fetchOutliers = useCallback(async () => {
        if (!selectedTest || !selectedDeviceId) {
            setOutlierIds(new Set());
            return;
        }

        const dataType = getDataType();
        try {
            const response = await authFetch(
                `/api/v1/tests/${selectedTest.id}/device/${selectedDeviceId}/outliers?data_type=${dataType}`
            );
            if (response.ok) {
                const result = await response.json();
                const ids = result.outliers.map(o => o.data_point_id);
                setOutlierIds(new Set(ids));
            } else {
                setOutlierIds(new Set());
            }
        } catch (error) {
            console.error('Error fetching outliers:', error);
            setOutlierIds(new Set());
        }
    }, [selectedTest, selectedDeviceId, getDataType, authFetch]);

    // Metric Options based on Aggregation and Device - MUST be defined before useEffects that use it
    const getMetricOptions = useCallback(() => {
        const device = devices.find(d => d.id === selectedDeviceId);
        if (!device) return [];

        if (device.device_type.includes('chimera')) {
            return [
                { value: 'peak_value', label: tPages('plot.peak_value_label') },
                { value: 'gas_name', label: tPages('plot.gas_name_label') }
            ];
        }

        // BlackBox - Dynamic based on data content
        // If we have data, check what fields are present
        if (plotData && plotData.data && plotData.data.length > 0) {
            const firstItem = plotData.data[0];
            const options = [];

            if (firstItem.hasOwnProperty('temperature')) options.push({ value: 'temperature', label: tPages('plot.temperature_label') });
            if (firstItem.hasOwnProperty('pressure')) options.push({ value: 'pressure', label: tPages('plot.pressure_label') });

            // Event Log specific
            if (firstItem.hasOwnProperty('cumulative_tips')) options.push({ value: 'cumulative_tips', label: tPages('plot.cumulative_tips_label') });
            if (firstItem.hasOwnProperty('total_volume_stp')) options.push({ value: 'total_volume_stp', label: tPages('plot.total_volume_label') });
            if (firstItem.hasOwnProperty('net_volume_per_gram')) options.push({ value: 'net_volume_per_gram', label: tPages('plot.net_volume_label') });

            // Raw specific
            if (firstItem.hasOwnProperty('tip_number')) options.push({ value: 'tip_number', label: tPages('plot.tips_label') });

            return options;
        }

        // Default fallback if no data yet (assume Event Log structure as primary)
        return [
            { value: 'temperature', label: tPages('plot.temperature_label') },
            { value: 'pressure', label: tPages('plot.pressure_label') },
            { value: 'cumulative_tips', label: tPages('plot.cumulative_tips_label') },
            { value: 'total_volume_stp', label: tPages('plot.total_volume_label') }
        ];
    }, [devices, selectedDeviceId, plotData, tPages]);

    const getAggregationOptions = useCallback(() => {
        const device = devices.find(d => d.id === selectedDeviceId);
        if (!device) return [];

        if (device.device_type.includes('chimera')) {
            return ['daily', 'hourly', 'minute', 'none'];
        }

        // BlackBox
        return ['daily', 'hourly', 'minute', 'none'];
    }, [devices, selectedDeviceId]);

    // Reset Y-Axis when aggregation changes
    useEffect(() => {
        const options = getMetricOptions();
        if (!options.find(o => o.value === yAxisMetric)) {
            setYAxisMetric(options[0]?.value || 'temperature');
        }
    }, [aggregation, selectedDeviceId, getMetricOptions, yAxisMetric]);

    // Fetch outliers from database when test/device changes or data loads
    useEffect(() => {
        if (selectedTest && selectedDeviceId && plotData) {
            fetchOutliers();
        }
    }, [selectedTest, selectedDeviceId, plotData, fetchOutliers]);

    // Columns for Selected Data Table
    const selectedDataColumns = useMemo(() => {
        const device = devices.find(d => d.id === selectedDeviceId);
        if (!device) return [];

        const common = [
            {
                accessorKey: 'timestamp',
                header: tPages('plot.timestamp_label'),
                cell: info => {
                    const val = info.getValue();
                    // Handle both seconds (from backend) and ISO strings (if any legacy)
                    // Backend sends unix timestamp in seconds
                    return val ? new Date(val * 1000).toLocaleString() : '-';
                }
            },
            {
                accessorKey: 'channel_number',
                header: tPages('plot.channel_label'),
            }
        ];

        if (device.device_type.includes('chimera')) {
            return [
                ...common,
                { accessorKey: 'gas_name', header: tPages('plot.gas_name_label') },
                { accessorKey: 'peak_value', header: tPages('plot.peak_value_label') },
            ];
        }

        // BlackBox
        return [
            ...common,
            {
                accessorKey: 'temperature',
                header: tPages('plot.temp_label'),
                cell: info => {
                    const val = info.getValue();
                    return typeof val === 'number' ? val.toFixed(2) : '-';
                }
            },
            {
                accessorKey: 'pressure',
                header: tPages('plot.pressure_label'),
                cell: info => {
                    const val = info.getValue();
                    return typeof val === 'number' ? val.toFixed(2) : '-';
                }
            },
            { accessorKey: 'cumulative_tips', header: tPages('plot.cumulative_tips_label') },
            {
                accessorKey: 'total_volume_stp',
                header: tPages('plot.total_volume_label'),
                cell: info => {
                    const val = info.getValue();
                    return typeof val === 'number' ? val.toFixed(4) : '-';
                }
            },
            {
                accessorKey: 'net_volume_per_gram',
                header: tPages('plot.net_volume_label'),
                cell: info => {
                    const val = info.getValue();
                    return typeof val === 'number' ? val.toFixed(4) : '-';
                }
            },
        ];
    }, [selectedDeviceId, devices, tPages]);

    // Copy selected data to clipboard
    const copySelectedData = useCallback(() => {
        if (selectedPoints.length === 0) return;

        const headers = selectedDataColumns.map(col => col.header).join('\t');
        const rows = selectedPoints.map(point => {
            return selectedDataColumns.map(col => {
                const value = point[col.accessorKey];
                if (col.accessorKey === 'timestamp') {
                    return value ? new Date(value * 1000).toLocaleString() : '-';
                }
                if (typeof value === 'number' && col.cell) {
                    return value.toFixed(2);
                }
                return value !== undefined && value !== null ? value : '-';
            }).join('\t');
        });

        const tsv = [headers, ...rows].join('\n');
        navigator.clipboard.writeText(tsv).then(() => {
            toast.info(tPages('plot.data_copied'));
        }).catch(err => {
            console.error('Failed to copy:', err);
            toast.error(tPages('plot.copy_failed'));
        });
    }, [selectedPoints, selectedDataColumns, toast, tPages]);

    // Download selected data as CSV
    const downloadSelectedData = useCallback(() => {
        if (selectedPoints.length === 0) return;

        const headers = selectedDataColumns.map(col => col.header).join(',');
        const rows = selectedPoints.map(point => {
            return selectedDataColumns.map(col => {
                let value = point[col.accessorKey];
                if (col.accessorKey === 'timestamp') {
                    value = value ? new Date(value * 1000).toLocaleString() : '-';
                }
                if (typeof value === 'number' && col.cell) {
                    value = value.toFixed(2);
                }
                value = value !== undefined && value !== null ? value : '-';
                if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                    value = `"${value.replace(/"/g, '""')}"`;
                }
                return value;
            }).join(',');
        });

        const csv = [headers, ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `selected_data_${selectedTest?.name || 'test'}_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, [selectedPoints, selectedDataColumns, selectedTest]);

    const selectedTable = useReactTable({
        data: selectedPoints,
        columns: selectedDataColumns,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        initialState: { pagination: { pageSize: 5 } },
    });

    // Label selected points as outliers (saves to database)
    const labelAsOutliers = useCallback(async () => {
        if (selectedPoints.length === 0) return;
        const newIds = selectedPoints.map(p => p.id).filter(id => id != null);
        if (newIds.length === 0) {
            toast.error(tPages('plot.outlier_no_id'));
            return;
        }

        if (!selectedTest || !selectedDeviceId) return;

        const dataType = getDataType();

        try {
            const response = await authFetch(
                `/api/v1/tests/${selectedTest.id}/device/${selectedDeviceId}/outliers`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: newIds, data_type: dataType }),
                }
            );

            if (response.ok) {
                // Update local state optimistically
                setOutlierIds(prev => {
                    const next = new Set(prev);
                    newIds.forEach(id => next.add(id));
                    return next;
                });
                setSelectedPoints([]);
            } else {
                const err = await response.json().catch(() => ({ error: 'Unknown error' }));
                toast.error(err.error || 'Failed to label outliers');
            }
        } catch (error) {
            console.error('Error labeling outliers:', error);
            toast.error('Failed to label outliers');
        }
    }, [selectedPoints, selectedTest, selectedDeviceId, getDataType, authFetch, toast, tPages]);

    // Delete outliers (deletes data points AND removes outlier labels from database)
    const deleteOutliers = useCallback(async () => {
        console.log('deleteOutliers called with IDs:', [...outlierIds]);
        if (!selectedTest || !selectedDeviceId) {
            console.error('Missing selectedTest or selectedDeviceId');
            return;
        }

        const dataType = getDataType();
        const idsToDelete = [...outlierIds];

        console.log('Sending DELETE request:', { idsToDelete, dataType, testId: selectedTest.id, deviceId: selectedDeviceId });

        try {
            // First, delete the actual data points
            const response = await authFetch(
                `/api/v1/tests/${selectedTest.id}/device/${selectedDeviceId}/data`,
                {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: idsToDelete, data_type: dataType }),
                }
            );
            console.log('Response status:', response.status, 'ok:', response.ok);

            if (response.ok) {
                const result = await response.json();
                console.log('Delete success:', result);

                // Also remove the outlier labels from the database
                await authFetch(
                    `/api/v1/tests/${selectedTest.id}/device/${selectedDeviceId}/outliers`,
                    {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ids: idsToDelete, data_type: dataType }),
                    }
                );

                // Clear outliers from state
                setOutlierIds(new Set());
                toast.info(tPages('plot.outliers_deleted'));
                setDeleteConfirmOpen(false);
                // Re-fetch to sync the chart with the database
                setTimeout(() => fetchPlotData(), 100);
            } else {
                const err = await response.json().catch(() => ({ error: 'Unknown error' }));
                console.error('Delete failed:', err);
                toast.error(err.error || tPages('plot.outliers_delete_failed'));
                setDeleteConfirmOpen(false);
            }
        } catch (error) {
            console.error('deleteOutliers error:', error);
            toast.error(tPages('plot.outliers_delete_failed'));
            setDeleteConfirmOpen(false);
        }
    }, [outlierIds, selectedDeviceId, selectedTest, getDataType, authFetch, toast, tPages, fetchPlotData]);

    // Unlabel outliers (removes labels but keeps the data points)
    const unlabelOutliers = useCallback(async () => {
        if (!selectedTest || !selectedDeviceId) return;

        const dataType = getDataType();
        const idsToUnlabel = [...outlierIds];

        try {
            const response = await authFetch(
                `/api/v1/tests/${selectedTest.id}/device/${selectedDeviceId}/outliers`,
                {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: idsToUnlabel, data_type: dataType }),
                }
            );

            if (response.ok) {
                setOutlierIds(new Set());
                toast.info(tPages('plot.outliers_unlabeled') || 'Outlier labels removed');
            } else {
                const err = await response.json().catch(() => ({ error: 'Unknown error' }));
                toast.error(err.error || 'Failed to remove outlier labels');
            }
        } catch (error) {
            console.error('unlabelOutliers error:', error);
            toast.error('Failed to remove outlier labels');
        }
    }, [outlierIds, selectedDeviceId, selectedTest, getDataType, authFetch, toast, tPages]);

    const columns = useMemo(() => [
        { accessorKey: 'name', header: tPages('plot.table_name'), size: 150 },
        { accessorKey: 'description', header: tPages('plot.table_description'), size: 200 },
        {
            accessorKey: 'status',
            header: tPages('plot.table_status'),
            size: 100,
            cell: info => {
                const status = info.getValue();
                const colorClass = status === 'running' ? 'bg-green-100 text-green-800' :
                    status === 'completed' ? 'bg-blue-100 text-blue-800' :
                        'bg-gray-100 text-gray-800';
                const translatedStatus = status === 'running' ? tPages('plot.running') :
                    status === 'completed' ? tPages('plot.completed') : status;
                return (
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${colorClass}`}>
                        {translatedStatus}
                    </span>
                );
            }
        },
        {
            accessorKey: 'date_created',
            header: tPages('plot.table_created'),
            size: 120,
            cell: info => info.getValue() ? new Date(info.getValue()).toLocaleDateString() : '-'
        },
        {
            accessorKey: 'date_ended',
            header: tPages('plot.table_ended'),
            size: 120,
            cell: info => info.getValue() ? new Date(info.getValue()).toLocaleDateString() : '-'
        },
        {
            id: 'actions',
            header: tPages('plot.table_actions'),
            size: 100,
            cell: ({ row }) => (
                <button
                    onClick={() => {
                        setSelectedTest(row.original);
                        setShowPlotView(true);
                        setSelectedPoints([]);
                        // addDebugLog(`Opened plot view for Test: ${row.original.name}`);
                    }}
                    className="text-blue-600 hover:text-blue-900 font-medium text-sm"
                >
                    {tPages('plot.view_plot')}
                </button>
            )
        }
    ], [tPages]);

    const table = useReactTable({
        data,
        columns,
        state: { globalFilter, sorting },
        onGlobalFilterChange: setGlobalFilter,
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        initialState: { pagination: { pageSize: 10 } },
    });

    // Check if a gas uses ppm units
    const isPpmGas = (gasName) => {
        if (!gasName) return false;
        return gasName === 'H2' || gasName === 'CO' || gasName.includes('H2S') || gasName.includes('NH3');
    };

    // Set default selected gas and channel when data loads
    useEffect(() => {
        const device = devices.find(d => d.id === selectedDeviceId);
        if (device && device.device_type.includes('chimera') && plotData && plotData.data) {
            const gases = [...new Set(plotData.data.map(d => d.gas_name))].sort();
            if (gases.length > 0 && !selectedGas) {
                setSelectedGas(gases[0]);
            }

            const channels = [...new Set(plotData.data.map(d => d.channel_number))].sort((a, b) => a - b);
            if (channels.length > 0 && !selectedChannel) {
                setSelectedChannel(channels[0]);
            }
        }
    }, [plotData, devices, selectedDeviceId, selectedGas, selectedChannel]);

    const plotlyData = useMemo(() => {
        if (!plotData || !plotData.data) return [];

        const device = devices.find(d => d.id === selectedDeviceId);
        if (!device) return [];

        // Helper to get X value based on mode
        const getXValue = (d) => {
            // Both Chimera and BlackBox can use X-axis mode
            if (xAxisMode === 'timestamp') return new Date(d.timestamp * 1000);
            if (xAxisMode === 'day') return d.seconds_elapsed / 86400;
            if (xAxisMode === 'hour') return d.seconds_elapsed / 3600;
            if (xAxisMode === 'minute') return d.seconds_elapsed / 60;
            return new Date(d.timestamp * 1000);
        };

        // Outlier trace accumulator
        const outlierTrace = { x: [], y: [], text: [], customdata: [], name: tPages('plot.outliers_label') };

        if (device.device_type.includes('chimera')) {
            // Filter and Group based on mode
            let filteredData = [];
            let groups = {};

            if (groupingMode === 'channel') {
                if (!selectedChannel) return [];
                filteredData = plotData.data.filter(d => {
                    if (d.channel_number !== selectedChannel) return false;
                    // Apply unit filter
                    if (unitFilter === 'ppm') return isPpmGas(d.gas_name);
                    if (unitFilter === 'percent') return !isPpmGas(d.gas_name);
                    return true; // 'all'
                });

                // Group by Gas
                filteredData.forEach(d => {
                    // Check if this is an outlier
                    if (outlierIds.has(d.id)) {
                        if (showOutliers) {
                            outlierTrace.x.push(getXValue(d));
                            outlierTrace.y.push(d.peak_value);
                            outlierTrace.text.push(
                                `[Outlier] Channel: ${d.channel_number}<br>Gas: ${d.gas_name}<br>Value: ${d.peak_value?.toFixed(2) || 'N/A'}<br>Time: ${new Date(d.timestamp * 1000).toLocaleString()}`
                            );
                            outlierTrace.customdata.push(d);
                        }
                        return; // skip normal trace
                    }

                    if (!groups[d.gas_name]) {
                        groups[d.gas_name] = {
                            x: [],
                            y: [],
                            text: [],
                            customdata: [],
                            name: formatGasName(d.gas_name)
                        };
                    }
                    groups[d.gas_name].x.push(getXValue(d));
                    groups[d.gas_name].y.push(d.peak_value);
                    const peakValue = typeof d.peak_value === 'number' ? d.peak_value.toFixed(2) : 'N/A';
                    groups[d.gas_name].text.push(
                        `Channel: ${d.channel_number}<br>Gas: ${d.gas_name}<br>Value: ${peakValue}<br>Time: ${new Date(d.timestamp * 1000).toLocaleString()}`
                    );
                    groups[d.gas_name].customdata.push(d);
                });
            } else {
                // Default: Group by Gas
                if (!selectedGas) return [];
                filteredData = plotData.data.filter(d => d.gas_name === selectedGas);

                // Group by Channel
                filteredData.forEach(d => {
                    // Check if this is an outlier
                    if (outlierIds.has(d.id)) {
                        if (showOutliers) {
                            outlierTrace.x.push(getXValue(d));
                            outlierTrace.y.push(d.peak_value);
                            outlierTrace.text.push(
                                `[Outlier] Channel: ${d.channel_number}<br>Gas: ${d.gas_name}<br>Value: ${d.peak_value?.toFixed(2) || 'N/A'}<br>Time: ${new Date(d.timestamp * 1000).toLocaleString()}`
                            );
                            outlierTrace.customdata.push(d);
                        }
                        return; // skip normal trace
                    }

                    if (!groups[d.channel_number]) {
                        groups[d.channel_number] = {
                            x: [],
                            y: [],
                            text: [],
                            customdata: [],
                            name: `Channel ${d.channel_number}`
                        };
                    }
                    groups[d.channel_number].x.push(getXValue(d));
                    groups[d.channel_number].y.push(d.peak_value);
                    const peakValue = typeof d.peak_value === 'number' ? d.peak_value.toFixed(2) : 'N/A';
                    groups[d.channel_number].text.push(
                        `Channel: ${d.channel_number}<br>Gas: ${d.gas_name}<br>Value: ${peakValue}<br>Time: ${new Date(d.timestamp * 1000).toLocaleString()}`
                    );
                    groups[d.channel_number].customdata.push(d);
                });
            }

            const traces = Object.values(groups).map(group => {
                let mode = 'lines+markers';
                if (graphType === 'scatter') mode = 'markers';
                if (graphType === 'line') mode = 'lines+markers';

                return {
                    ...group,
                    mode: graphType === 'bar' ? undefined : mode,
                    type: graphType === 'bar' ? 'bar' : 'scatter',
                    textposition: graphType === 'bar' ? 'none' : undefined,
                };
            });

            // Append outlier trace if it has data
            if (outlierTrace.x.length > 0) {
                traces.push({
                    ...outlierTrace,
                    type: 'scatter',
                    mode: 'markers',
                    marker: {
                        symbol: 'x',
                        size: 8,
                        color: '#ef4444',   // red-500
                        line: { color: '#991b1b', width: 1 }  // red-800 border, thinner line
                    },
                    showlegend: true,
                });
            }

            return traces;
        } else {
            // BlackBox Logic
            const channelGroups = {};

            plotData.data.forEach(d => {
                // Check if this is an outlier
                if (outlierIds.has(d.id)) {
                    if (showOutliers) {
                        outlierTrace.x.push(getXValue(d));
                        let yVal = d[yAxisMetric];
                        outlierTrace.y.push(yVal);
                        outlierTrace.text.push(
                            `[Outlier] Channel: ${d.channel_number}<br>${yAxisMetric}: ${yVal}<br>Time: ${new Date(d.timestamp * 1000).toLocaleString()}`
                        );
                        outlierTrace.customdata.push(d);
                    }
                    return; // skip normal trace
                }

                if (!channelGroups[d.channel_number]) {
                    channelGroups[d.channel_number] = {
                        x: [],
                        y: [],
                        text: [],
                        customdata: [],
                        name: `Channel ${d.channel_number}`
                    };
                }

                let yVal = d[yAxisMetric];

                channelGroups[d.channel_number].x.push(getXValue(d));
                channelGroups[d.channel_number].y.push(yVal);
                channelGroups[d.channel_number].text.push(
                    `Channel: ${d.channel_number}<br>${yAxisMetric}: ${yVal}<br>Time: ${new Date(d.timestamp * 1000).toLocaleString()}`
                );
                channelGroups[d.channel_number].customdata.push(d);
            });

            const traces = Object.values(channelGroups).map(group => {
                let mode = 'lines+markers';
                if (graphType === 'scatter') mode = 'markers';
                if (graphType === 'line') mode = 'lines+markers';

                return {
                    ...group,
                    mode: graphType === 'bar' ? undefined : mode,
                    type: graphType === 'bar' ? 'bar' : 'scatter',
                    textposition: graphType === 'bar' ? 'none' : undefined,
                };
            });

            // Append outlier trace if it has data
            if (outlierTrace.x.length > 0) {
                traces.push({
                    ...outlierTrace,
                    type: 'scatter',
                    mode: 'markers',
                    marker: {
                        symbol: 'x',
                        size: 8,
                        color: '#ef4444',   // red-500
                        line: { color: '#991b1b', width: 1 }  // red-800 border, thinner line
                    },
                    showlegend: true,
                });
            }

            return traces;
        }
    }, [plotData, devices, selectedDeviceId, selectedGas, graphType, yAxisMetric, xAxisMode, groupingMode, selectedChannel, unitFilter, outlierIds, showOutliers, tPages]);

    // Handle plot initialization and attach native Plotly event listeners
    const handlePlotInitialized = useCallback((figure, graphDiv) => {
        // Store the graphDiv reference
        plotDivRef.current = graphDiv;

        // Remove any existing event listeners to avoid duplicates
        graphDiv.removeAllListeners && graphDiv.removeAllListeners('plotly_selected');
        graphDiv.removeAllListeners && graphDiv.removeAllListeners('plotly_deselect');

        // Attach native Plotly event listeners
        graphDiv.on('plotly_selected', (eventData) => {
            if (eventData && eventData.points) {
                const points = eventData.points.map(p => {
                    // Robustly retrieve customdata
                    if (p.customdata) return p.customdata;
                    if (p.data && p.data.customdata) {
                        return p.data.customdata[p.pointNumber];
                    }
                    return null;
                }).filter(Boolean);
                setSelectedPoints(points);
            }
        });

        graphDiv.on('plotly_deselect', () => {
            setSelectedPoints([]);
        });
    }, []);

    const plotlyLayout = useMemo(() => {
        const device = devices.find(d => d.id === selectedDeviceId);
        const axisTextColor = isDark ? '#cbd5e1' : '#6b7280';
        const axisTitleColor = isDark ? '#e2e8f0' : '#374151';
        const gridColor = isDark ? 'rgba(148, 163, 184, 0.25)' : '#e5e7eb';
        const zeroLineColor = isDark ? 'rgba(148, 163, 184, 0.35)' : '#e5e7eb';
        const axisLineColor = isDark ? 'rgba(148, 163, 184, 0.4)' : '#d1d5db';

        // Axis title styling
        const axisTitleFont = {
            family: 'Arial, sans-serif',
            size: 14,
            color: axisTitleColor
        };

        // Base Layout
        const layout = {
            autosize: true,
            margin: { l: 40, r: 15, t: 20, b: 50 },
            legend: {
                orientation: 'h',
                y: -0.15,
                font: { size: 11, color: axisTextColor }
            },
            hovermode: 'closest',
            dragmode: 'lasso', // Enable lasso selection
            paper_bgcolor: isDark ? '#0b1220' : '#ffffff',
            plot_bgcolor: isDark ? '#0b1220' : '#ffffff',
            font: { color: axisTextColor },
        };

        const axisTheme = {
            tickfont: { size: 11, color: axisTextColor },
            gridcolor: gridColor,
            zerolinecolor: zeroLineColor,
            linecolor: axisLineColor,
        };

        // Chimera Layout
        if (device && device.device_type.includes('chimera')) {
            // Dynamic X-axis title based on mode
            let xAxisTitle = tPages('plot.x_axis_timestamp');
            if (xAxisMode === 'day') xAxisTitle = tPages('plot.elapsed_time_days');
            else if (xAxisMode === 'hour') xAxisTitle = tPages('plot.elapsed_time_hours');
            else if (xAxisMode === 'minute') xAxisTitle = tPages('plot.elapsed_time_minutes');

            layout.xaxis = {
                title: {
                    text: xAxisTitle,
                    font: axisTitleFont,
                    standoff: 10
                },
                ...axisTheme
            };

            // Determine unit based on selected gas (if in gas mode) or generally
            let unit = tPages('plot.concentration_percent');
            let isPPM = false;

            if (groupingMode === 'gas') {
                if (selectedGas && (selectedGas.includes('NH3') || selectedGas.includes('H2S') || selectedGas === 'H2' || selectedGas === 'CO' || selectedGas.toLowerCase().includes('ppm'))) {
                    unit = tPages('plot.concentration_ppm');
                    isPPM = true;
                }
            } else {
                // In channel mode, use the unit filter to determine axis title
                if (unitFilter === 'ppm') {
                    unit = tPages('plot.concentration_ppm');
                    isPPM = true;
                } else if (unitFilter === 'percent') {
                    unit = tPages('plot.concentration_percent');
                } else {
                    // 'all' - show mixed units indicator
                    unit = tPages('plot.concentration_mixed');
                }
            }

            layout.yaxis = {
                title: {
                    text: unit,
                    font: axisTitleFont,
                    standoff: 5
                },
                ...axisTheme,
                rangemode: 'nonnegative'
            };

            // If grouping by gas and it's a percentage gas (not PPM), enforce 0-100 range
            if (groupingMode === 'gas' && !isPPM) {
                layout.yaxis.range = [0, 100];
            }
        } else {
            // BlackBox Layout
            let xTitle = tPages('plot.x_axis_timestamp');
            if (xAxisMode === 'day') xTitle = tPages('plot.elapsed_time_days');
            if (xAxisMode === 'hour') xTitle = tPages('plot.elapsed_time_hours');
            if (xAxisMode === 'minute') xTitle = tPages('plot.elapsed_time_minutes');

            const yLabel = getMetricOptions().find(o => o.value === yAxisMetric)?.label || yAxisMetric;

            layout.xaxis = {
                title: {
                    text: xTitle,
                    font: axisTitleFont,
                    standoff: 10
                },
                ...axisTheme
            };
            layout.yaxis = {
                title: {
                    text: yLabel,
                    font: axisTitleFont,
                    standoff: 5
                },
                ...axisTheme
            };
        }

        return layout;
    }, [yAxisMetric, getMetricOptions, devices, selectedDeviceId, selectedGas, xAxisMode, groupingMode, tPages, isDark]);

    // MUST be defined before any conditional returns
    const dialogMessage = React.useMemo(() => {
        const template = tPages('plot.delete_outliers_confirm');
        return template.replace('{{count}}', outlierIds.size);
    }, [outlierIds.size, tPages]);

    if (showPlotView && selectedTest) {
        const selectedDevice = devices.find(d => d.id === selectedDeviceId);

        // Get available gases for dropdown
        const availableGases = selectedDevice && selectedDevice.device_type.includes('chimera') && plotData && plotData.data
            ? [...new Set(plotData.data.map(d => d.gas_name))].sort()
            : [];

        // Fullscreen Graph Modal
        if (fullscreenGraph) {
            return (
                <div className="fixed inset-0 z-50 bg-white flex flex-col">
                    {/* Fullscreen Header */}
                    <div className="flex items-center justify-between p-3 bg-gray-50 border-b border-gray-200 shrink-0">
                        <div className="min-w-0 flex-1">
                            <h3 className="text-sm font-bold text-gray-900 truncate">{selectedDevice?.name}</h3>
                            <p className="text-xs text-gray-500">{selectedTest.name}</p>
                        </div>
                        <button
                            onClick={() => setFullscreenGraph(false)}
                            className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors ml-2"
                        >
                            <Minimize2 size={20} className="text-gray-600" />
                        </button>
                    </div>
                    {/* Fullscreen Plot */}
                    <div className="flex-1 p-2">
                        {plotData && plotData.data && plotData.data.length > 0 ? (
                            <Plotly
                                data={plotlyData}
                                layout={{
                                    ...plotlyLayout,
                                    margin: { l: 50, r: 20, t: 10, b: 80 },
                                    legend: {
                                        orientation: 'h',
                                        y: -0.25,
                                        x: 0.5,
                                        xanchor: 'center',
                                        font: { size: 10 }
                                    }
                                }}
                                config={{
                                    displayModeBar: true,
                                    displaylogo: false,
                                }}
                                useResizeHandler={true}
                                style={{ width: '100%', height: '100%' }}
                            />
                        ) : (
                            <div className="h-full flex justify-center items-center text-gray-400">
                                No data available
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        return (
            <>
            <ConfirmDialog
                isOpen={deleteConfirmOpen}
                title={tPages('plot.delete_outliers_title')}
                message={dialogMessage}
                confirmText={tPages('plot.delete_outliers_confirm_btn')}
                cancelText={tPages('plot.cancel')}
                onConfirm={deleteOutliers}
                onCancel={() => {
                    console.log('ConfirmDialog Cancel clicked');
                    setDeleteConfirmOpen(false);
                }}
                danger={true}
            />
            <div className="flex flex-col lg:flex-row h-screen bg-gray-100 overflow-hidden">
                {/* Mobile Header */}
                <div className="lg:hidden flex items-center justify-between p-4 bg-white border-b border-gray-200 shrink-0">
                    <button
                        onClick={() => {
                            if (initialParams) {
                                onNavigate(initialParams.source || 'dashboard');
                            } else {
                                setShowPlotView(false);
                                setSelectedTest(null);
                                setDevices([]);
                                setSelectedDeviceId(null);
                                setSelectedPoints([]);
                            }
                        }}
                        className="text-gray-600 hover:text-gray-900 flex items-center gap-2"
                    >
                        <span>←</span> {initialParams ? (initialParams.source === 'database' ? tPages('plot.back_to_database') : tPages('plot.back_to_dashboard')) : tPages('plot.back_to_tests')}
                    </button>
                    <h2 className="text-lg font-bold text-gray-800 truncate mx-4">{selectedTest.name}</h2>
                    <button
                        onClick={() => setSettingsPanelOpen(true)}
                        className="p-2 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                    >
                        <Settings size={20} />
                    </button>
                </div>

                {/* Mobile Settings Panel Overlay */}
                {settingsPanelOpen && (
                    <div
                        className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-40"
                        onClick={() => setSettingsPanelOpen(false)}
                    />
                )}

                {/* Sidebar Settings Panel */}
                <div className={`
                    fixed lg:relative inset-y-0 left-0 z-50 lg:z-10
                    w-72 lg:w-70 bg-white shadow-lg flex flex-col border-r border-gray-200
                    transform transition-transform duration-300 ease-in-out
                    ${settingsPanelOpen ? 'translate-x-0' : '-translate-x-full'}
                    lg:translate-x-0
                `}>
                    <div className="p-4 lg:p-6 border-b border-gray-200">
                        <div className="flex items-center justify-between lg:block">
                            <button
                                onClick={() => {
                                    if (initialParams) {
                                        onNavigate(initialParams.source || 'dashboard');
                                    } else {
                                        setShowPlotView(false);
                                        setSelectedTest(null);
                                        setDevices([]);
                                        setSelectedDeviceId(null);
                                        setSelectedPoints([]);
                                    }
                                }}
                                className="hidden lg:flex text-gray-600 hover:text-gray-900 items-center gap-2 mb-4"
                            >
                                <span>←</span> {initialParams ? (initialParams.source === 'database' ? tPages('plot.back_to_database') : tPages('plot.back_to_dashboard')) : tPages('plot.back_to_tests')}
                            </button>
                            <div>
                                <h2 className="text-xl font-bold text-gray-800">{selectedTest.name}</h2>
                                <p className="text-sm text-gray-500 mt-1">{tPages('plot.plot_settings')}</p>
                            </div>
                            <button
                                onClick={() => setSettingsPanelOpen(false)}
                                className="lg:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors"
                            >
                                <X size={20} className="text-gray-500" />
                            </button>
                        </div>
                    </div>

                    <div className="p-6 flex-1 overflow-y-auto space-y-7">
                        {/* Device Selection */}
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-3">{tPages('plot.device')}</label>
                            <div className="space-y-2">
                                {devices.map(device => (
                                    <button
                                        key={device.id}
                                        onClick={() => setSelectedDeviceId(device.id)}
                                        className={`w-full text-left px-4 py-3 rounded-lg border transition-all ${selectedDeviceId === device.id
                                            ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-700'
                                            }`}
                                    >
                                        <div className="font-medium">{device.name}</div>
                                        <div className="text-xs text-gray-500 mt-1">
                                            {device.device_type.replace('_', ' ')} • {device.channels.length} channels
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Grouping Mode (Chimera Only) */}
                        {selectedDevice?.device_type.includes('chimera') && (
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-3">{tPages('plot.grouping_mode')}</label>
                                <div className="flex bg-gray-100 p-1 rounded-lg mb-4">
                                    <button
                                        onClick={() => setGroupingMode('gas')}
                                        className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${groupingMode === 'gas'
                                            ? 'bg-white text-blue-600 shadow-sm'
                                            : 'text-gray-500 hover:text-gray-700'
                                            }`}
                                    >
                                        {tPages('plot.group_by_gas')}
                                    </button>
                                    <button
                                        onClick={() => setGroupingMode('channel')}
                                        className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${groupingMode === 'channel'
                                            ? 'bg-white text-blue-600 shadow-sm'
                                            : 'text-gray-500 hover:text-gray-700'
                                            }`}
                                    >
                                        {tPages('plot.group_by_channel')}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Gas Selection (Chimera Only - Gas Mode) */}
                        {selectedDevice?.device_type.includes('chimera') && groupingMode === 'gas' && availableGases.length > 0 && (
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-3">{tPages('plot.select_gas')}</label>
                                <select
                                    value={selectedGas || ''}
                                    onChange={(e) => setSelectedGas(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    {availableGases.map(gas => (
                                        <option key={gas} value={gas}>{formatGasNameUnicode(gas)}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Channel Selection (Chimera Only - Channel Mode) */}
                        {selectedDevice?.device_type.includes('chimera') && groupingMode === 'channel' && (
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-3">{tPages('plot.select_channel')}</label>
                                <select
                                    value={selectedChannel || ''}
                                    onChange={(e) => setSelectedChannel(Number(e.target.value))}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    {[...new Set(plotData?.data?.map(d => d.channel_number) || [])].sort((a, b) => a - b).map(channel => (
                                        <option key={channel} value={channel}>{tPages('plot.channel_label')} {channel}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Unit Filter (Chimera Only - Channel Mode) */}
                        {selectedDevice?.device_type.includes('chimera') && groupingMode === 'channel' && (
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-3">{tPages('plot.unit_filter')}</label>
                                <div className="flex bg-gray-100 p-1 rounded-lg">
                                    <button
                                        onClick={() => setUnitFilter('all')}
                                        className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                                            unitFilter === 'all' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                                        }`}
                                    >
                                        {tPages('plot.unit_all')}
                                    </button>
                                    <button
                                        onClick={() => setUnitFilter('ppm')}
                                        className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                                            unitFilter === 'ppm' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                                        }`}
                                    >
                                        {tPages('plot.unit_ppm')}
                                    </button>
                                    <button
                                        onClick={() => setUnitFilter('percent')}
                                        className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                                            unitFilter === 'percent' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                                        }`}
                                    >
                                        {tPages('plot.unit_percent')}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* X-Axis Mode */}
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-3">{tPages('plot.x_axis_mode')}</label>
                            <select
                                value={xAxisMode}
                                onChange={(e) => setXAxisMode(e.target.value)}
                                className="w-full p-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                                <option value="timestamp">{tPages('plot.x_axis_timestamp')}</option>
                                <option value="day">{tPages('plot.x_axis_days')}</option>
                                <option value="hour">{tPages('plot.x_axis_hours')}</option>
                                <option value="minute">{tPages('plot.x_axis_minutes')}</option>
                            </select>
                        </div>

                        {/* Time Aggregation */}
                        <div>
                            <div className="flex items-center gap-2 mb-3">
                                <label className="block text-sm font-bold text-gray-700">{tPages('plot.time_aggregation')}</label>
                                <div className="relative group">
                                    <Info size={14} className="text-gray-400 cursor-help" />
                                    <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-3 py-2 bg-gray-800 text-white text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 w-56 z-50 pointer-events-none">
                                        {selectedDevice?.device_type.includes('chimera')
                                            ? tPages('plot.aggregation_chimera_tooltip')
                                            : tPages('plot.aggregation_blackbox_tooltip')}
                                        <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800"></div>
                                    </div>
                                </div>
                            </div>
                            <div className="flex bg-gray-100 p-1 rounded-lg">
                                {getAggregationOptions().map(opt => (
                                    <button
                                        key={opt}
                                        onClick={() => setAggregation(opt)}
                                        className={`flex-1 py-2 text-sm font-medium rounded-md capitalize transition-all ${aggregation === opt
                                            ? 'bg-white text-blue-600 shadow-sm'
                                            : 'text-gray-500 hover:text-gray-700'
                                            }`}
                                    >
                                        {opt === 'none' ? tPages('plot.aggregation_none') : tPages(`plot.aggregation_${opt}`)}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Graph Type */}
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-3">{tPages('plot.graph_type')}</label>
                            <div className="grid grid-cols-3 gap-2">
                                {['scatter', 'line', 'bar'].map(type => (
                                    <button
                                        key={type}
                                        onClick={() => setGraphType(type)}
                                        className={`py-2 text-sm font-medium rounded-lg border transition-all ${graphType === type
                                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                                            : 'border-gray-200 hover:border-gray-300 text-gray-600'
                                            }`}
                                    >
                                        {tPages(`plot.graph_${type}`)}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Y-Axis Metric (BlackBox Only) */}
                        {!selectedDevice?.device_type.includes('chimera') && (
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-3">{tPages('plot.y_axis_metric')}</label>
                                <select
                                    value={yAxisMetric}
                                    onChange={(e) => setYAxisMetric(e.target.value)}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                                >
                                    {getMetricOptions().map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 flex flex-col h-full overflow-hidden">
                    {/* Plot Area */}
                    <div className="flex-1 flex flex-col overflow-hidden">
                        {selectedDevice ? (
                            <>
                                <div className="bg-white border-b border-gray-200 flex-[2.5] min-h-0 flex flex-col">
                                    <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                                        <div className="min-w-0 flex-1">
                                            <h3 className="text-base sm:text-lg font-bold text-gray-900 truncate">
                                                {selectedDevice.name} {tPages('plot.data_header')}
                                            </h3>
                                            <p className="text-xs sm:text-sm text-gray-500 truncate">
                                                {aggregation === 'none' ? 'Timestamp' : aggregation} • {
                                                    selectedDevice?.device_type.includes('chimera')
                                                        ? (groupingMode === 'gas' && selectedGas
                                                            ? formatGasNameUnicode(selectedGas)
                                                            : `Channel ${selectedChannel || '?'}${unitFilter !== 'all' ? ` (${unitFilter})` : ''}`)
                                                        : (getMetricOptions().find(o => o.value === yAxisMetric)?.label || yAxisMetric)
                                                }
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {/* Fullscreen button */}
                                            <button
                                                onClick={() => setFullscreenGraph(true)}
                                                className="p-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
                                                title="Fullscreen"
                                            >
                                                <Maximize2 size={18} />
                                            </button>
                                            <button
                                                onClick={() => fetchPlotData()}
                                                disabled={fetchingData}
                                                className="px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs sm:text-sm font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                                </svg>
                                                <span className="hidden sm:inline">{tPages('plot.refresh')}</span>
                                            </button>
                                        </div>
                                    </div>

                                    <div className="flex-1 pb-4 px-4 min-h-0">
                                        {fetchingData ? (
                                            <div className="h-full flex flex-col justify-center items-center text-gray-400">
                                                <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mb-4"></div>
                                                <p>{tPages('plot.loading_data')}</p>
                                            </div>
                                        ) : error ? (
                                            <div className="h-full flex flex-col justify-center items-center text-red-500 bg-red-50 rounded-lg border-2 border-dashed border-red-200 p-6 text-center">
                                                <svg className="w-12 h-12 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                                </svg>
                                                <p className="font-medium text-lg">{error}</p>
                                            </div>
                                        ) : plotData && plotData.data && plotData.data.length > 0 ? (
                                            <Plotly
                                                data={plotlyData}
                                                layout={plotlyLayout}
                                                config={{
                                                    displayModeBar: true,
                                                    displaylogo: false,
                                                }}
                                                useResizeHandler={true}
                                                style={{ width: '100%', height: '100%' }}
                                                onInitialized={handlePlotInitialized}
                                                onUpdate={handlePlotInitialized}
                                            />
                                        ) : plotData ? (
                                            <div className="h-full flex flex-col justify-center items-center text-gray-400 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 p-6 text-center">
                                                <svg className="w-16 h-16 mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                                </svg>
                                                <p className="font-medium text-gray-600 mb-2">{tPages('plot.configured_no_data')}</p>
                                                <p className="text-sm text-gray-500">{tPages('plot.no_data_collected')}</p>
                                            </div>
                                        ) : (
                                            <div className="h-full flex justify-center items-center text-gray-400 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                                                {tPages('plot.no_data_available')}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Selected Data Table */}
                                <div className="bg-white flex-1 flex flex-col min-h-0">
                                    <div className="px-4 sm:px-6 py-3 border-b border-gray-200 bg-gray-50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                                        <h3 className="text-sm font-bold text-gray-700">{tPages('plot.selected_points')} ({selectedPoints.length})</h3>
                                        {selectedPoints.length > 0 && (
                                            <div className="flex gap-2 flex-wrap">
                                                {canPerform('delete_test') && (
                                                    <>
                                                        <button
                                                            onClick={copySelectedData}
                                                            className="px-2 sm:px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 transition-colors flex items-center gap-1"
                                                        >
                                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                            </svg>
                                                            <span className="hidden sm:inline">{tPages('plot.copy')}</span>
                                                        </button>
                                                        <button
                                                            onClick={downloadSelectedData}
                                                            className="px-2 sm:px-3 py-1 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 transition-colors flex items-center gap-1"
                                                        >
                                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                                            </svg>
                                                            <span className="hidden sm:inline">{tPages('plot.download_csv')}</span>
                                                        </button>
                                                    </>
                                                )}
                                                {canPerform('delete_data_points') && aggregation === 'none' && selectedPoints.length > 0 && (
                                                    <button
                                                        onClick={labelAsOutliers}
                                                        className="px-2 sm:px-3 py-1 bg-orange-600 text-white rounded text-xs font-medium hover:bg-orange-700 transition-colors flex items-center gap-1"
                                                    >
                                                        <AlertTriangle size={12} />
                                                        <span className="hidden sm:inline">{tPages('plot.label_outlier')}</span>
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => setSelectedPoints([])}
                                                    className="px-2 sm:px-3 py-1 text-red-600 hover:text-red-800 font-medium text-xs border border-red-300 rounded hover:bg-red-50 transition-colors"
                                                >
                                                    {tPages('plot.clear')}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    {outlierIds.size > 0 && aggregation === 'none' && (
                                        <div className="px-4 sm:px-6 py-2 bg-orange-50 border-b border-orange-200 flex items-center gap-3 flex-wrap">
                                            <span className="text-xs text-orange-600 font-medium">
                                                {(() => {
                                                    const template = tPages('plot.outliers_count');
                                                    return template.replace('{{count}}', outlierIds.size);
                                                })()}
                                            </span>
                                            {/* Show/Hide toggle - available to everyone */}
                                            <button
                                                onClick={() => setShowOutliers(prev => !prev)}
                                                className={`px-2 py-1 text-xs font-medium rounded border transition-colors flex items-center gap-1 ${
                                                    showOutliers
                                                        ? 'border-orange-400 bg-orange-50 text-orange-700 hover:bg-orange-100'
                                                        : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                                                }`}
                                            >
                                                {showOutliers ? <Eye size={12} /> : <EyeOff size={12} />}
                                                <span>{showOutliers ? tPages('plot.outliers_showing') : tPages('plot.outliers_hidden')}</span>
                                            </button>
                                            {/* Unlabel button - only for admin/operator */}
                                            {canPerform('delete_data_points') && (
                                                <button
                                                    onClick={unlabelOutliers}
                                                    className="px-2 py-1 border border-orange-400 text-orange-700 rounded text-xs font-medium hover:bg-orange-100 transition-colors flex items-center gap-1"
                                                >
                                                    <X size={12} />
                                                    <span className="hidden sm:inline">{tPages('plot.unlabel_outliers') || 'Unlabel'}</span>
                                                </button>
                                            )}
                                            {/* Delete button - only for admin/operator */}
                                            {canPerform('delete_data_points') && (
                                                <button
                                                    onClick={() => {
                                                        console.log('Delete button clicked, opening confirmation dialog');
                                                        setDeleteConfirmOpen(true);
                                                    }}
                                                    className="px-2 py-1 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700 transition-colors flex items-center gap-1"
                                                >
                                                    <Trash2 size={12} />
                                                    <span className="hidden sm:inline">{tPages('plot.delete_outliers')}</span>
                                                </button>
                                            )}
                                        </div>
                                    )}
                                    <div className="flex-1 overflow-auto">
                                        {selectedPoints.length > 0 ? (
                                            <table className="min-w-full divide-y divide-gray-200">
                                                <thead className="bg-gray-50 sticky top-0">
                                                    {selectedTable.getHeaderGroups().map(headerGroup => (
                                                        <tr key={headerGroup.id}>
                                                            {headerGroup.headers.map(header => (
                                                                <th
                                                                    key={header.id}
                                                                    className="px-6 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                                                                >
                                                                    {flexRender(header.column.columnDef.header, header.getContext())}
                                                                </th>
                                                            ))}
                                                        </tr>
                                                    ))}
                                                </thead>
                                                <tbody className="bg-white divide-y divide-gray-200">
                                                    {selectedTable.getRowModel().rows.map(row => (
                                                        <tr key={row.id} className="hover:bg-gray-50">
                                                            {row.getVisibleCells().map(cell => (
                                                                <td key={cell.id} className="px-6 py-2 text-sm text-gray-900 whitespace-nowrap">
                                                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                                </td>
                                                            ))}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        ) : (
                                            <div className="h-full flex justify-center items-center text-gray-400 italic text-sm">
                                                {tPages('plot.select_points_message')}
                                            </div>
                                        )}
                                    </div>
                                    {/* Pagination for Selected Data */}
                                    {selectedPoints.length > 0 && (
                                        <div className="px-6 py-2 border-t border-gray-200 flex items-center justify-between bg-gray-50">
                                            <span className="text-xs text-gray-500">
                                                {tPages('plot.pagination_page')} {selectedTable.getState().pagination.pageIndex + 1} {tPages('plot.pagination_of')} {selectedTable.getPageCount()}
                                            </span>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => selectedTable.previousPage()}
                                                    disabled={!selectedTable.getCanPreviousPage()}
                                                    className="px-2 py-1 border border-gray-300 rounded text-xs disabled:opacity-50 hover:bg-white"
                                                >
                                                    {tPages('plot.pagination_prev')}
                                                </button>
                                                <button
                                                    onClick={() => selectedTable.nextPage()}
                                                    disabled={!selectedTable.getCanNextPage()}
                                                    className="px-2 py-1 border border-gray-300 rounded text-xs disabled:opacity-50 hover:bg-white"
                                                >
                                                    {tPages('plot.pagination_next')}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div className="h-full flex flex-col justify-center items-center text-gray-400 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 p-6 text-center m-4">
                                <svg className="w-16 h-16 mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                </svg>
                                <p className="font-medium text-gray-600 mb-2">{tPages('plot.test_configured_no_data')}</p>
                                <p className="text-sm text-gray-500">{tPages('plot.test_data_wait')}</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            </>
        );
    }

    return (
        <>
            <ConfirmDialog
                isOpen={deleteConfirmOpen}
                title={tPages('plot.delete_outliers_title')}
                message={dialogMessage}
                confirmText={tPages('plot.delete_outliers_confirm_btn')}
                cancelText={tPages('plot.cancel')}
                onConfirm={deleteOutliers}
                onCancel={() => {
                    console.log('ConfirmDialog Cancel clicked');
                    setDeleteConfirmOpen(false);
                }}
                danger={true}
            />
            <div className="space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">{tPages('plot.title')}</h1>
                <div className="flex gap-2 sm:gap-4 w-full sm:w-auto">
                    <input
                        type="text"
                        placeholder={tPages('plot.search_placeholder')}
                        value={globalFilter ?? ''}
                        onChange={e => setGlobalFilter(e.target.value)}
                        className="px-3 sm:px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none flex-1 sm:flex-none sm:w-64 text-sm sm:text-base"
                    />
                    <button
                        onClick={fetchTests}
                        className="px-3 sm:px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm sm:text-base whitespace-nowrap"
                    >
                        {tPages('plot.refresh')}
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                {loading ? (
                    <div className="flex justify-center py-12">
                        <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent"></div>
                    </div>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    {table.getHeaderGroups().map(headerGroup => (
                                        <tr key={headerGroup.id}>
                                            {headerGroup.headers.map(header => (
                                                <th
                                                    key={header.id}
                                                    className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                                                    onClick={header.column.getToggleSortingHandler()}
                                                    style={{ width: header.column.columnDef.size }}
                                                >
                                                    <div className="flex items-center gap-2">
                                                        {flexRender(header.column.columnDef.header, header.getContext())}
                                                        {{ asc: ' ↑', desc: ' ↓' }[header.column.getIsSorted()] ?? null}
                                                    </div>
                                                </th>
                                            ))}
                                        </tr>
                                    ))}
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {table.getRowModel().rows.map(row => (
                                        <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                                            {row.getVisibleCells().map(cell => (
                                                <td key={cell.id} className="px-6 py-4 text-sm text-gray-900">
                                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination */}
                        <div className="flex flex-col sm:flex-row items-center justify-between px-4 py-3 sm:py-4 border-t border-gray-200 gap-3">
                            <div className="text-xs sm:text-sm text-gray-700 text-center sm:text-left">
                                {tPages('plot.pagination_showing')} {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1} {tPages('plot.pagination_to')}{' '}
                                {Math.min(
                                    (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
                                    table.getFilteredRowModel().rows.length
                                )}{' '}
                                {tPages('plot.pagination_of')} {table.getFilteredRowModel().rows.length}
                            </div>

                            <div className="flex items-center gap-1 sm:gap-2 flex-wrap justify-center">
                                <button
                                    onClick={() => table.setPageIndex(0)}
                                    disabled={!table.getCanPreviousPage()}
                                    className="px-2 sm:px-3 py-1 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                                >
                                    {tPages('plot.pagination_first')}
                                </button>
                                <button
                                    onClick={() => table.previousPage()}
                                    disabled={!table.getCanPreviousPage()}
                                    className="px-2 sm:px-3 py-1 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                                >
                                    {'<'}
                                </button>
                                <span className="text-xs sm:text-sm text-gray-700 px-2">
                                    {table.getState().pagination.pageIndex + 1}/{table.getPageCount()}
                                </span>
                                <button
                                    onClick={() => table.nextPage()}
                                    disabled={!table.getCanNextPage()}
                                    className="px-2 sm:px-3 py-1 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                                >
                                    {'>'}
                                </button>
                                <button
                                    onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                                    disabled={!table.getCanNextPage()}
                                    className="px-2 sm:px-3 py-1 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                                >
                                    {tPages('plot.pagination_last')}
                                </button>
                                <select
                                    value={table.getState().pagination.pageSize}
                                    onChange={e => table.setPageSize(Number(e.target.value))}
                                    className="ml-1 sm:ml-2 px-1 sm:px-2 py-1 border border-gray-300 rounded text-xs sm:text-sm"
                                >
                                    {[10, 20, 50, 100].map(pageSize => (
                                        <option key={pageSize} value={pageSize}>
                                            {pageSize}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </>
                )}
            </div>
            </div>
        </>
    );
}

export default Plot;
