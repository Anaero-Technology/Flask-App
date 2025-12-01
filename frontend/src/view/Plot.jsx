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

function Plot() {
    const toast = useToast();
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

    // New State for Enhanced Plotting
    const [aggregation, setAggregation] = useState('none'); // 'daily', 'hourly', 'none'
    const [yAxisMetric, setYAxisMetric] = useState('temperature');
    const [graphType, setGraphType] = useState('scatter'); // 'scatter', 'line', 'bar'

    useEffect(() => {
        fetchTests();
    }, []);

    useEffect(() => {
        if (selectedTest) {
            fetchTestDetails(selectedTest.id);
        }
    }, [selectedTest]);

    useEffect(() => {
        if (selectedTest && selectedDeviceId) {
            // Reset aggregation when device changes if needed
            const device = devices.find(d => d.id === selectedDeviceId);
            if (device) {
                if (device.device_type.includes('chimera')) {
                    // Chimera now supports aggregation, so no need to force reset unless invalid
                    if (!['daily', 'hourly', 'minute', 'none'].includes(aggregation)) setAggregation('none');
                } else {
                    // BlackBox - default to daily if switching from chimera, or keep current if valid
                    // If current is 'none', it's valid for BlackBox too now
                }
            }
            fetchPlotData();
        } else {
            setPlotData(null);
        }
    }, [selectedTest, selectedDeviceId, aggregation]);

    // Reset Y-Axis when aggregation changes
    useEffect(() => {
        const options = getMetricOptions();
        if (!options.find(o => o.value === yAxisMetric)) {
            setYAxisMetric(options[0]?.value || 'temperature');
        }
    }, [aggregation, selectedDeviceId]);

    // Selected Data State
    const [selectedPoints, setSelectedPoints] = useState([]);

    // Ref to store the plot div for native event binding
    const plotDivRef = useRef(null);

    // Metric Options based on Aggregation and Device
    const getMetricOptions = useCallback(() => {
        const device = devices.find(d => d.id === selectedDeviceId);
        if (!device) return [];

        if (device.device_type.includes('chimera')) {
            return [
                { value: 'peak_value', label: 'Peak Value' },
                { value: 'gas_name', label: 'Gas Name' }
            ];
        }

        // BlackBox - Dynamic based on data content
        // If we have data, check what fields are present
        if (plotData && plotData.data && plotData.data.length > 0) {
            const firstItem = plotData.data[0];
            const options = [];

            if (firstItem.hasOwnProperty('temperature')) options.push({ value: 'temperature', label: 'Temperature (°C)' });
            if (firstItem.hasOwnProperty('pressure')) options.push({ value: 'pressure', label: 'Pressure (mbar)' });

            // Event Log specific
            if (firstItem.hasOwnProperty('tumbler_volume')) options.push({ value: 'tumbler_volume', label: 'Tumbler Volume' });
            if (firstItem.hasOwnProperty('cumulative_tips')) options.push({ value: 'cumulative_tips', label: 'Cumulative Tips' });
            if (firstItem.hasOwnProperty('total_volume_stp')) options.push({ value: 'total_volume_stp', label: 'Total Volume STP' });
            if (firstItem.hasOwnProperty('net_volume_per_gram')) options.push({ value: 'net_volume_per_gram', label: 'Net Volume/Gram' });
            if (firstItem.hasOwnProperty('volume_this_hour_stp')) options.push({ value: 'volume_this_hour_stp', label: 'Volume/Hour STP' });

            // Raw specific
            if (firstItem.hasOwnProperty('tip_number')) options.push({ value: 'tip_number', label: 'Tip Number' });

            return options;
        }

        // Default fallback if no data yet (assume Event Log structure as primary)
        return [
            { value: 'temperature', label: 'Temperature (°C)' },
            { value: 'pressure', label: 'Pressure (mbar)' },
            { value: 'cumulative_tips', label: 'Cumulative Tips' },
            { value: 'total_volume_stp', label: 'Total Volume STP' }
        ];
    }, [devices, selectedDeviceId, plotData]);

    const getAggregationOptions = useCallback(() => {
        const device = devices.find(d => d.id === selectedDeviceId);
        if (!device) return [];

        if (device.device_type.includes('chimera')) {
            return ['daily', 'hourly', 'minute', 'none'];
        }

        // BlackBox
        return ['daily', 'hourly', 'minute', 'none'];
    }, [devices, selectedDeviceId]);

    // Columns for Selected Data Table
    const selectedDataColumns = useMemo(() => {
        const device = devices.find(d => d.id === selectedDeviceId);
        if (!device) return [];

        const common = [
            {
                accessorKey: 'timestamp',
                header: 'Timestamp',
                cell: info => {
                    const val = info.getValue();
                    // Handle both seconds (from backend) and ISO strings (if any legacy)
                    // Backend sends unix timestamp in seconds
                    return val ? new Date(val * 1000).toLocaleString() : '-';
                }
            },
            {
                accessorKey: 'channel_number',
                header: 'Channel',
            }
        ];

        if (device.device_type.includes('chimera')) {
            return [
                ...common,
                { accessorKey: 'gas_name', header: 'Gas Name' },
                { accessorKey: 'peak_value', header: 'Peak Value' },
            ];
        }

        // BlackBox
        return [
            ...common,
            {
                accessorKey: 'temperature',
                header: 'Temp (°C)',
                cell: info => {
                    const val = info.getValue();
                    return typeof val === 'number' ? val.toFixed(2) : '-';
                }
            },
            {
                accessorKey: 'pressure',
                header: 'Pressure (mbar)',
                cell: info => {
                    const val = info.getValue();
                    return typeof val === 'number' ? val.toFixed(2) : '-';
                }
            },
            { accessorKey: 'cumulative_tips', header: 'Tips' },
            {
                accessorKey: 'total_volume_stp',
                header: 'Vol STP',
                cell: info => {
                    const val = info.getValue();
                    return typeof val === 'number' ? val.toFixed(4) : '-';
                }
            },
            {
                accessorKey: 'net_volume_per_gram',
                header: 'Net Vol/g',
                cell: info => {
                    const val = info.getValue();
                    return typeof val === 'number' ? val.toFixed(4) : '-';
                }
            },
            { accessorKey: 'tumbler_volume', header: 'Tumbler Vol' },
            {
                accessorKey: 'volume_this_hour_stp',
                header: 'Vol/Hour STP',
                cell: info => {
                    const val = info.getValue();
                    return typeof val === 'number' ? val.toFixed(4) : '-';
                }
            },
        ];
    }, [selectedDeviceId, devices]);

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
            toast.info('Data copied to clipboard!');
        }).catch(err => {
            console.error('Failed to copy:', err);
            toast.error('Failed to copy data');
        });
    }, [selectedPoints, selectedDataColumns, toast]);

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



    const fetchPlotData = async () => {
        if (!selectedTest || !selectedDeviceId) return;

        setFetchingData(true);
        // addDebugLog(`Fetching plot data for Device ${selectedDeviceId}`, { aggregation });

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

            // addDebugLog(`Requesting URL: ${url}`);

            const response = await fetch(url);
            if (response.ok) {
                const result = await response.json();
                setPlotData(result);
                setError(null);
                // addDebugLog(`Data fetched successfully. Count: ${result.count}`, result.data.slice(0, 3));
            } else {
                const err = await response.json();
                console.error('Failed to fetch plot data', err);
                setPlotData(null);
                if (err.code === 'NO_EVENT_LOG_DATA' || err.code === 'NO_CHANNEL_CONFIG') {
                    setError(err.error);
                } else {
                    setError('Failed to load data');
                }
                // addDebugLog('Failed to fetch plot data', { status: response.status });
            }
        } catch (error) {
            console.error('Error fetching plot data:', error);
            setPlotData(null);
            // addDebugLog('Error exception fetching plot data', error);
        } finally {
            setFetchingData(false);
        }
    };

    const fetchTests = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch('/api/v1/tests');
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
    };

    const fetchTestDetails = async (testId) => {
        setError(null);
        try {
            const response = await fetch(`/api/v1/tests/${testId}`);
            if (response.ok) {
                const details = await response.json();
                setTestDetails(details);
            }

            const devicesResponse = await fetch(`/api/v1/tests/${testId}/devices`);
            if (devicesResponse.ok) {
                const testDevices = await devicesResponse.json();
                setDevices(testDevices);

                if (testDevices.length > 0) {
                    setSelectedDeviceId(testDevices[0].id);
                }
            }
        } catch (error) {
            console.error('Error fetching test details:', error);
        }
    };

    const columns = useMemo(() => [
        { accessorKey: 'id', header: 'ID', size: 60 },
        { accessorKey: 'name', header: 'Name', size: 150 },
        { accessorKey: 'description', header: 'Description', size: 200 },
        {
            accessorKey: 'status',
            header: 'Status',
            size: 100,
            cell: info => {
                const status = info.getValue();
                const colorClass = status === 'running' ? 'bg-green-100 text-green-800' :
                    status === 'completed' ? 'bg-blue-100 text-blue-800' :
                        'bg-gray-100 text-gray-800';
                return (
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${colorClass}`}>
                        {status}
                    </span>
                );
            }
        },
        {
            accessorKey: 'date_created',
            header: 'Created',
            size: 120,
            cell: info => info.getValue() ? new Date(info.getValue()).toLocaleDateString() : '-'
        },
        {
            id: 'actions',
            header: 'Actions',
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
                    View Plot
                </button>
            )
        }
    ], []);

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

    const [xAxisMode, setXAxisMode] = useState('timestamp'); // 'timestamp', 'day', 'hour', 'minute'
    const [groupingMode, setGroupingMode] = useState('gas'); // 'gas', 'channel'
    const [selectedChannel, setSelectedChannel] = useState(null);
    const [error, setError] = useState(null);
    const [selectedGas, setSelectedGas] = useState(null);

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

        if (device.device_type.includes('chimera')) {
            // ... (Chimera logic remains mostly same, just ensure X uses getXValue if we wanted to support it later, 
            // but for now request said ignore chimera. However, to be safe, let's just keep chimera as is or use getXValue with forced timestamp)

            // Filter and Group based on mode
            let filteredData = [];
            let groups = {};

            if (groupingMode === 'channel') {
                if (!selectedChannel) return [];
                filteredData = plotData.data.filter(d => d.channel_number === selectedChannel);

                // Group by Gas
                filteredData.forEach(d => {
                    if (!groups[d.gas_name]) {
                        groups[d.gas_name] = {
                            x: [],
                            y: [],
                            text: [],
                            customdata: [],
                            name: d.gas_name
                        };
                    }
                    groups[d.gas_name].x.push(getXValue(d));
                    groups[d.gas_name].y.push(d.peak_value);
                    groups[d.gas_name].text.push(
                        `Channel: ${d.channel_number}<br>Gas: ${d.gas_name}<br>Value: ${d.peak_value.toFixed(2)}<br>Time: ${new Date(d.timestamp * 1000).toLocaleString()}`
                    );
                    groups[d.gas_name].customdata.push(d);
                });
            } else {
                // Default: Group by Gas
                if (!selectedGas) return [];
                filteredData = plotData.data.filter(d => d.gas_name === selectedGas);

                // Group by Channel
                filteredData.forEach(d => {
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
                    groups[d.channel_number].text.push(
                        `Channel: ${d.channel_number}<br>Gas: ${d.gas_name}<br>Value: ${d.peak_value.toFixed(2)}<br>Time: ${new Date(d.timestamp * 1000).toLocaleString()}`
                    );
                    groups[d.channel_number].customdata.push(d);
                });
            }

            return Object.values(groups).map(group => {
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
        } else {
            // BlackBox Logic
            const channelGroups = {};

            plotData.data.forEach(d => {
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
                // Handle cumulative metrics if needed (omitted for brevity as it wasn't requested to change)

                channelGroups[d.channel_number].x.push(getXValue(d));
                channelGroups[d.channel_number].y.push(yVal);
                channelGroups[d.channel_number].text.push(
                    `Channel: ${d.channel_number}<br>${yAxisMetric}: ${yVal}<br>Time: ${new Date(d.timestamp * 1000).toLocaleString()}`
                );
                channelGroups[d.channel_number].customdata.push(d);
            });

            return Object.values(channelGroups).map(group => {
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
        }
    }, [plotData, devices, selectedDeviceId, selectedGas, graphType, yAxisMetric, xAxisMode, groupingMode, selectedChannel]);

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

        // Base Layout
        const layout = {
            autosize: true,
            margin: { l: 60, r: 20, t: 40, b: 50 },
            legend: { orientation: 'h', y: -0.15 },
            hovermode: 'closest',
            dragmode: 'lasso', // Enable lasso selection
        };

        // Chimera Layout
        if (device && device.device_type.includes('chimera')) {
            // Dynamic X-axis title based on mode
            let xAxisTitle = 'Time';
            if (xAxisMode === 'day') xAxisTitle = 'Time (Days Elapsed)';
            else if (xAxisMode === 'hour') xAxisTitle = 'Time (Hours Elapsed)';
            else if (xAxisMode === 'minute') xAxisTitle = 'Time (Minutes Elapsed)';

            layout.xaxis = { title: xAxisTitle };

            // Determine unit based on selected gas (if in gas mode) or generally
            let unit = 'Concentration (%)';
            let isPPM = false;

            if (groupingMode === 'gas') {
                if (selectedGas && (selectedGas.includes('NH3') || selectedGas.includes('H2S') || selectedGas.toLowerCase().includes('ppm'))) {
                    unit = 'Concentration (PPM)';
                    isPPM = true;
                }
            } else {
                // In channel mode, we might have mixed units, but usually gases on one device share unit types or we just show generic
                // For now, let's assume % unless we detect PPM gases in the data for this channel
                // This is a simplification; ideally we'd have dual axis or normalized data if units differ
                unit = 'Concentration';
            }

            layout.yaxis = {
                title: unit,
                rangemode: 'nonnegative'
            };

            // If grouping by gas and it's a percentage gas (not PPM), enforce 0-100 range
            if (groupingMode === 'gas' && !isPPM) {
                layout.yaxis.range = [0, 100];
            }
        } else {
            // BlackBox Layout
            let xTitle = 'Time';
            if (xAxisMode === 'day') xTitle = 'Time (Days Elapsed)';
            if (xAxisMode === 'hour') xTitle = 'Time (Hours Elapsed)';
            if (xAxisMode === 'minute') xTitle = 'Time (Minutes Elapsed)';

            layout.xaxis = { title: xTitle };
            layout.yaxis = { title: getMetricOptions().find(o => o.value === yAxisMetric)?.label || yAxisMetric };
        }

        return layout;
    }, [yAxisMetric, getMetricOptions, devices, selectedDeviceId, selectedGas, xAxisMode]);

    if (showPlotView && selectedTest) {
        const selectedDevice = devices.find(d => d.id === selectedDeviceId);

        // Get available gases for dropdown
        const availableGases = selectedDevice && selectedDevice.device_type.includes('chimera') && plotData && plotData.data
            ? [...new Set(plotData.data.map(d => d.gas_name))].sort()
            : [];

        return (
            <div className="flex h-screen bg-gray-100 overflow-hidden">
                {/* Sidebar Settings Panel */}
                <div className="w-80 bg-white shadow-lg flex flex-col z-10 border-r border-gray-200">
                    <div className="p-6 border-b border-gray-200">
                        <button
                            onClick={() => {
                                setShowPlotView(false);
                                setSelectedTest(null);
                                setTestDetails(null);
                                setDevices([]);
                                setSelectedDeviceId(null);
                                setSelectedPoints([]);
                            }}
                            className="text-gray-600 hover:text-gray-900 flex items-center gap-2 mb-4"
                        >
                            <span>←</span> Back to Tests
                        </button>
                        <h2 className="text-xl font-bold text-gray-800">{selectedTest.name}</h2>
                        <p className="text-sm text-gray-500 mt-1">Plot Settings</p>
                    </div>

                    <div className="p-6 flex-1 overflow-y-auto space-y-8">
                        {/* Device Selection */}
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-3">Device</label>
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
                                <label className="block text-sm font-bold text-gray-700 mb-3">Grouping Mode</label>
                                <div className="flex bg-gray-100 p-1 rounded-lg mb-4">
                                    <button
                                        onClick={() => setGroupingMode('gas')}
                                        className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${groupingMode === 'gas'
                                            ? 'bg-white text-blue-600 shadow-sm'
                                            : 'text-gray-500 hover:text-gray-700'
                                            }`}
                                    >
                                        Group by Gas
                                    </button>
                                    <button
                                        onClick={() => setGroupingMode('channel')}
                                        className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${groupingMode === 'channel'
                                            ? 'bg-white text-blue-600 shadow-sm'
                                            : 'text-gray-500 hover:text-gray-700'
                                            }`}
                                    >
                                        Group by Channel
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Gas Selection (Chimera Only - Gas Mode) */}
                        {selectedDevice?.device_type.includes('chimera') && groupingMode === 'gas' && availableGases.length > 0 && (
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-3">Select Gas</label>
                                <select
                                    value={selectedGas || ''}
                                    onChange={(e) => setSelectedGas(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    {availableGases.map(gas => (
                                        <option key={gas} value={gas}>{gas}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Channel Selection (Chimera Only - Channel Mode) */}
                        {selectedDevice?.device_type.includes('chimera') && groupingMode === 'channel' && (
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-3">Select Channel</label>
                                <select
                                    value={selectedChannel || ''}
                                    onChange={(e) => setSelectedChannel(Number(e.target.value))}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    {[...new Set(plotData?.data?.map(d => d.channel_number) || [])].sort((a, b) => a - b).map(channel => (
                                        <option key={channel} value={channel}>Channel {channel}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* X-Axis Mode */}
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-3">X-Axis Mode</label>
                            <select
                                value={xAxisMode}
                                onChange={(e) => setXAxisMode(e.target.value)}
                                className="w-full p-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                                <option value="timestamp">Timestamp</option>
                                <option value="day">Days Elapsed</option>
                                <option value="hour">Hours Elapsed</option>
                                <option value="minute">Minutes Elapsed</option>
                            </select>
                        </div>

                        {/* Time Aggregation */}
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-3">Time Aggregation</label>
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
                                        {opt === 'none' ? 'None' : opt}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Graph Type */}
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-3">Graph Type</label>
                            <div className="grid grid-cols-3 gap-2">
                                {['scatter', 'line', 'bar'].map(type => (
                                    <button
                                        key={type}
                                        onClick={() => setGraphType(type)}
                                        className={`py-2 text-sm font-medium rounded-lg border transition-all capitalize ${graphType === type
                                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                                            : 'border-gray-200 hover:border-gray-300 text-gray-600'
                                            }`}
                                    >
                                        {type}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Y-Axis Metric (BlackBox Only) */}
                        {!selectedDevice?.device_type.includes('chimera') && (
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-3">Y-Axis Metric</label>
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
                                <div className="bg-white border-b border-gray-200 flex-[2] min-h-0 flex flex-col">
                                    <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                                        <div>
                                            <h3 className="text-lg font-bold text-gray-900">
                                                {selectedDevice.name} Data
                                            </h3>
                                            <p className="text-sm text-gray-500">
                                                {aggregation === 'none' ? 'No Aggregation' : `Aggregated ${aggregation}`} • {getMetricOptions().find(o => o.value === yAxisMetric)?.label || yAxisMetric}
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => fetchPlotData()}
                                            disabled={fetchingData}
                                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                            </svg>
                                            Refresh
                                        </button>
                                    </div>

                                    <div className="flex-1 pb-4 px-4 min-h-0">
                                        {fetchingData ? (
                                            <div className="h-full flex flex-col justify-center items-center text-gray-400">
                                                <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mb-4"></div>
                                                <p>Loading data...</p>
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
                                                <p className="font-medium text-gray-600 mb-2">Device is configured but no data has been collected</p>
                                                <p className="text-sm text-gray-500">Data would appear here once the device starts sending measurements</p>
                                            </div>
                                        ) : (
                                            <div className="h-full flex justify-center items-center text-gray-400 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                                                No data available for this selection
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Selected Data Table */}
                                <div className="bg-white flex-1 flex flex-col min-h-0">
                                    <div className="px-6 py-3 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                                        <h3 className="text-sm font-bold text-gray-700">Selected Data Points ({selectedPoints.length})</h3>
                                        {selectedPoints.length > 0 && (
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={copySelectedData}
                                                    className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 transition-colors flex items-center gap-1"
                                                >
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                    </svg>
                                                    Copy
                                                </button>
                                                <button
                                                    onClick={downloadSelectedData}
                                                    className="px-3 py-1 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 transition-colors flex items-center gap-1"
                                                >
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                                    </svg>
                                                    Download CSV
                                                </button>
                                                <button
                                                    onClick={() => setSelectedPoints([])}
                                                    className="px-3 py-1 text-red-600 hover:text-red-800 font-medium text-xs border border-red-300 rounded hover:bg-red-50 transition-colors"
                                                >
                                                    Clear Selection
                                                </button>
                                            </div>
                                        )}
                                    </div>
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
                                                Select points on the graph to view data
                                            </div>
                                        )}
                                    </div>
                                    {/* Pagination for Selected Data */}
                                    {selectedPoints.length > 0 && (
                                        <div className="px-6 py-2 border-t border-gray-200 flex items-center justify-between bg-gray-50">
                                            <span className="text-xs text-gray-500">
                                                Page {selectedTable.getState().pagination.pageIndex + 1} of {selectedTable.getPageCount()}
                                            </span>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => selectedTable.previousPage()}
                                                    disabled={!selectedTable.getCanPreviousPage()}
                                                    className="px-2 py-1 border border-gray-300 rounded text-xs disabled:opacity-50 hover:bg-white"
                                                >
                                                    Prev
                                                </button>
                                                <button
                                                    onClick={() => selectedTable.nextPage()}
                                                    disabled={!selectedTable.getCanNextPage()}
                                                    className="px-2 py-1 border border-gray-300 rounded text-xs disabled:opacity-50 hover:bg-white"
                                                >
                                                    Next
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
                                <p className="font-medium text-gray-600 mb-2">Test is configured but no data has been collected</p>
                                <p className="text-sm text-gray-500">Data will appear here once devices start sending measurements</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-8">
                <h1 className="text-3xl font-bold text-gray-900">Data Visualization</h1>
                <div className="flex gap-4">
                    <input
                        type="text"
                        placeholder="Search tests..."
                        value={globalFilter ?? ''}
                        onChange={e => setGlobalFilter(e.target.value)}
                        className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none w-64"
                    />
                    <button
                        onClick={fetchTests}
                        className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                        Refresh
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
                        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between bg-gray-50">
                            <span className="text-sm text-gray-700">
                                Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
                            </span>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => table.previousPage()}
                                    disabled={!table.getCanPreviousPage()}
                                    className="px-3 py-1 border border-gray-300 rounded-md disabled:opacity-50 hover:bg-white transition-colors"
                                >
                                    Previous
                                </button>
                                <button
                                    onClick={() => table.nextPage()}
                                    disabled={!table.getCanNextPage()}
                                    className="px-3 py-1 border border-gray-300 rounded-md disabled:opacity-50 hover:bg-white transition-colors"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export default Plot;
