import React, { useState, useEffect, useMemo } from 'react';
import {
    useReactTable,
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    flexRender,
} from '@tanstack/react-table';

const Database = ({ onViewPlot }) => {
    const [activeTable, setActiveTable] = useState('tests');
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [globalFilter, setGlobalFilter] = useState('');
    const [sorting, setSorting] = useState([]);

    useEffect(() => {
        fetchData();
    }, [activeTable]);

    const fetchData = async () => {
        setLoading(true);
        try {
            let endpoint = '';
            if (activeTable === 'samples') endpoint = '/api/v1/samples';
            else if (activeTable === 'inoculums') endpoint = '/api/v1/inoculum';
            else if (activeTable === 'tests') endpoint = '/api/v1/tests?include_devices=true';

            const response = await fetch(endpoint);
            const result = await response.json();
            // Sort by ID descending (newest first) in case backend sorting isn't working
            const sortedData = result.sort((a, b) => b.id - a.id);
            setData(sortedData);
        } catch (error) {
            console.error('Error fetching data:', error);
        } finally {
            setLoading(false);
        }
    };

    // Define columns for each table type
    const samplesColumns = useMemo(() => [
        { accessorKey: 'sample_name', header: 'Sample Name', size: 150 },
        { accessorKey: 'substrate_source', header: 'Substrate Source', size: 150 },
        { accessorKey: 'description', header: 'Description', size: 200 },
        { accessorKey: 'substrate_type', header: 'Type', size: 120 },
        { accessorKey: 'reactor', header: 'Reactor', size: 100 },
        { accessorKey: 'temperature', header: 'Temperature', size: 100 },
    ], []);

    const inoculumsColumns = useMemo(() => [

        { accessorKey: 'sample_name', header: 'Name', size: 150 },
        { accessorKey: 'inoculum_source', header: 'Source', size: 200 },
        { accessorKey: 'inoculum_percent_ts', header: '%TS', size: 80 },
        { accessorKey: 'inoculum_percent_vs', header: '%VS', size: 80 },
        {
            accessorKey: 'date_created',
            header: 'Date Created',
            size: 120,
            cell: info => info.getValue() ? new Date(info.getValue()).toLocaleDateString() : '-'
        },
    ], []);

    const testsColumns = useMemo(() => [
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
            accessorKey: 'date_started',
            header: 'Started',
            size: 100,
            cell: info => info.getValue() ? new Date(info.getValue()).toLocaleDateString() : '-'
        },
        {
            accessorKey: 'date_ended',
            header: 'Ended',
            size: 100,
            cell: info => info.getValue() ? new Date(info.getValue()).toLocaleDateString() : '-'
        },
        { accessorKey: 'created_by', header: 'Created By', size: 120 },
        {
            id: 'actions',
            header: 'Actions',
            size: 280,
            cell: info => {
                const test = info.row.original;
                const hasDevices = test.devices && test.devices.length > 0;

                return (
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => hasDevices && onViewPlot(test.id, test.devices[0].id, 'database')}
                            disabled={!hasDevices}
                            className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            View Plot
                        </button>
                        <button
                            onClick={() => window.open(`/api/v1/tests/${test.id}/download`, '_blank')}
                            className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                            Download
                        </button>
                        {test.status === 'running' ? (
                            <button
                                onClick={async () => {
                                    if (window.confirm('Are you sure you want to stop this test?')) {
                                        try {
                                            const response = await fetch(`/api/v1/tests/${test.id}/stop`, {
                                                method: 'POST'
                                            });
                                            if (response.ok) {
                                                fetchData(); // Refresh list
                                            } else {
                                                const err = await response.json();
                                                alert('Failed to stop test: ' + (err.error || 'Unknown error'));
                                            }
                                        } catch (error) {
                                            console.error('Error stopping test:', error);
                                            alert('Error stopping test');
                                        }
                                    }
                                }}
                                className="px-3 py-1.5 text-xs font-medium text-orange-600 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors"
                            >
                                Stop
                            </button>
                        ) : (
                            <button
                                onClick={async () => {
                                    if (window.confirm('Are you sure you want to delete this test? This action cannot be undone.')) {
                                        try {
                                            const response = await fetch(`/api/v1/tests/${test.id}`, {
                                                method: 'DELETE'
                                            });
                                            if (response.ok) {
                                                fetchData(); // Refresh list
                                            } else {
                                                const err = await response.json();
                                                alert('Failed to delete test: ' + err.error);
                                            }
                                        } catch (error) {
                                            console.error('Error deleting test:', error);
                                            alert('Error deleting test');
                                        }
                                    }
                                }}
                                className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                            >
                                Delete
                            </button>
                        )}
                    </div>
                );
            }
        }
    ], [onViewPlot, fetchData]);

    const columns = useMemo(() => {
        if (activeTable === 'samples') return samplesColumns;
        if (activeTable === 'inoculums') return inoculumsColumns;
        if (activeTable === 'tests') return testsColumns;
        return [];
    }, [activeTable, samplesColumns, inoculumsColumns, testsColumns]);

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

    return (
        <div className="space-y-4">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Database</h1>

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
                            Samples
                        </button>
                        <button
                            onClick={() => setActiveTable('inoculums')}
                            className={`px-4 py-2 rounded-lg font-medium border-2 transition-all ${activeTable === 'inoculums'
                                ? '!border-blue-600 !bg-white !text-black'
                                : '!border-gray-300 !bg-gray-100 !text-gray-700'
                                } hover:!bg-gray-200`}
                        >
                            Inoculum
                        </button>
                        <button
                            onClick={() => setActiveTable('tests')}
                            className={`px-4 py-2 rounded-lg font-medium border-2 transition-all ${activeTable === 'tests'
                                ? '!border-blue-600 !bg-white !text-black'
                                : '!border-gray-300 !bg-gray-100 !text-gray-700'
                                } hover:!bg-gray-200`}
                        >
                            Tests
                        </button>
                    </div>

                    {/* Search and Refresh */}
                    <div className="flex items-center space-x-4">
                        <input
                            type="text"
                            placeholder="Search all columns..."
                            value={globalFilter ?? ''}
                            onChange={e => setGlobalFilter(e.target.value)}
                            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <button
                            onClick={fetchData}
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
                                        <tr key={row.id} className="hover:bg-gray-50">
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
                                    Showing {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1} to{' '}
                                    {Math.min(
                                        (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
                                        table.getFilteredRowModel().rows.length
                                    )}{' '}
                                    of {table.getFilteredRowModel().rows.length} entries
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
                                    Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
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
                                            Show {pageSize}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Empty State */}
                        {table.getFilteredRowModel().rows.length === 0 && (
                            <div className="text-center py-8 text-gray-500">
                                No {activeTable} found
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

export default Database;
