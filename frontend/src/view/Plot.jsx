import React, { useState, useEffect, useMemo } from 'react';
import {
    useReactTable,
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    flexRender,
} from '@tanstack/react-table';

function Plot() {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [globalFilter, setGlobalFilter] = useState('');
    const [sorting, setSorting] = useState([]);
    const [selectedTest, setSelectedTest] = useState(null);
    const [showPlotView, setShowPlotView] = useState(false);
    const [testDetails, setTestDetails] = useState(null);
    const [devices, setDevices] = useState([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState(null);

    useEffect(() => {
        fetchTests();
    }, []);

    useEffect(() => {
        if (selectedTest) {
            fetchTestDetails(selectedTest.id);
        }
    }, [selectedTest]);

    const fetchTests = async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/v1/tests');
            if (response.ok) {
                const result = await response.json();
                // Sort by ID descending (newest first)
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
        try {
            const response = await fetch(`/api/v1/tests/${testId}`);
            if (response.ok) {
                const details = await response.json();
                setTestDetails(details);
            }

            // Fetch devices used in this test
            const devicesResponse = await fetch(`/api/v1/tests/${testId}/devices`);
            if (devicesResponse.ok) {
                const testDevices = await devicesResponse.json();
                setDevices(testDevices);

                // Auto-select first device
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
            accessorKey: 'date_started',
            header: 'Started',
            size: 120,
            cell: info => info.getValue() ? new Date(info.getValue()).toLocaleDateString() : '-'
        },
        {
            accessorKey: 'date_ended',
            header: 'Ended',
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
        state: {
            globalFilter,
            sorting,
        },
        onGlobalFilterChange: setGlobalFilter,
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        initialState: {
            pagination: {
                pageSize: 10,
            },
        },
    });

    if (showPlotView && selectedTest) {
        const selectedDevice = devices.find(d => d.id === selectedDeviceId);

        return (
            <div className="p-6">
                <div className="mb-4">
                    <button
                        onClick={() => {
                            setShowPlotView(false);
                            setSelectedTest(null);
                            setTestDetails(null);
                            setDevices([]);
                            setSelectedDeviceId(null);
                        }}
                        className="px-4 py-2 text-gray-700 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-2"
                    >
                        <span>←</span> Back to Test Selection
                    </button>
                </div>

                <h1 className="text-4xl font-bold text-black pl-6 m-6">
                    Plot: {selectedTest.name}
                </h1>

                <div className="bg-white rounded-lg shadow-sm p-6">
                    {/* Device Selection */}
                    {devices.length > 0 && (
                        <div className="mb-6">
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Select Device to Plot
                            </label>
                            <div className="flex gap-3">
                                {devices.map(device => (
                                    <button
                                        key={device.id}
                                        onClick={() => setSelectedDeviceId(device.id)}
                                        className={`px-4 py-2 rounded-lg border-2 transition-colors ${
                                            selectedDeviceId === device.id
                                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                                : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                                        }`}
                                    >
                                        <div className="font-medium">{device.name}</div>
                                        <div className="text-xs capitalize">
                                            {device.device_type.replace('_', ' ')}
                                        </div>
                                        <div className="text-xs text-gray-500">
                                            {device.channels.length} channel{device.channels.length !== 1 ? 's' : ''}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Plot Display Area */}
                    {selectedDevice && (
                        <div className="bg-gray-50 rounded-lg p-8 border border-gray-200">
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <p className="text-gray-600 mb-2">
                                        Plot visualization for test "{selectedTest.name}"
                                    </p>
                                    <p className="text-sm text-gray-500">
                                        Device: {selectedDevice.name} ({selectedDevice.device_type.replace('_', ' ')})
                                    </p>
                                    <p className="text-sm text-gray-500">
                                        Channels: {selectedDevice.channels.sort((a, b) => a - b).join(', ')}
                                    </p>
                                </div>
                                <a
                                    href={`/api/v1/tests/${selectedTest.id}/export/csv?device_type=${selectedDevice.device_type}`}
                                    download
                                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2"
                                >
                                    <span>↓</span> Export CSV
                                </a>
                            </div>

                            {/* Placeholder for actual plot component */}
                            <div className="bg-white rounded p-6 min-h-[400px] flex items-center justify-center border border-gray-300">
                                <p className="text-gray-400">Plot component will be rendered here</p>
                            </div>
                        </div>
                    )}

                    {devices.length === 0 && (
                        <div className="bg-yellow-50 rounded-lg p-6 border border-yellow-200">
                            <p className="text-yellow-800">
                                No device data found for this test.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="p-6">
            <h1 className="text-4xl font-bold text-black pl-6 m-6">Select a test to plot</h1>

            <div className="bg-white rounded-lg shadow-sm p-6">
                {/* Search and Refresh */}
                <div className="mb-6">
                    <div className="flex items-center space-x-4">
                        <input
                            type="text"
                            placeholder="Search all columns..."
                            value={globalFilter ?? ''}
                            onChange={e => setGlobalFilter(e.target.value)}
                            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <button
                            onClick={fetchTests}
                            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                        >
                            Refresh
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
                        <div className="overflow-x-auto border border-gray-200 rounded-lg">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    {table.getHeaderGroups().map(headerGroup => (
                                        <tr key={headerGroup.id}>
                                            {headerGroup.headers.map(header => (
                                                <th
                                                    key={header.id}
                                                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
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
                                    {table.getRowModel().rows.map(row => (
                                        <tr
                                            key={row.id}
                                            className="hover:bg-gray-50"
                                        >
                                            {row.getVisibleCells().map(cell => (
                                                <td
                                                    key={cell.id}
                                                    className="px-4 py-3 text-sm text-gray-900"
                                                >
                                                    {flexRender(
                                                        cell.column.columnDef.cell,
                                                        cell.getContext()
                                                    )}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination */}
                        <div className="flex items-center justify-between mt-4">
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-700">
                                    Page {table.getState().pagination.pageIndex + 1} of{' '}
                                    {table.getPageCount()}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => table.setPageIndex(0)}
                                    disabled={!table.getCanPreviousPage()}
                                    className="px-3 py-1 border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                                >
                                    {'<<'}
                                </button>
                                <button
                                    onClick={() => table.previousPage()}
                                    disabled={!table.getCanPreviousPage()}
                                    className="px-3 py-1 border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                                >
                                    {'<'}
                                </button>
                                <button
                                    onClick={() => table.nextPage()}
                                    disabled={!table.getCanNextPage()}
                                    className="px-3 py-1 border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                                >
                                    {'>'}
                                </button>
                                <button
                                    onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                                    disabled={!table.getCanNextPage()}
                                    className="px-3 py-1 border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                                >
                                    {'>>'}
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
