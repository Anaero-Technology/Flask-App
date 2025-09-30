import React, { useState, useEffect } from 'react';

function Database() {
    const [activeTable, setActiveTable] = useState('samples');
    const [samples, setSamples] = useState([]);
    const [inoculums, setInoculums] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [editingRow, setEditingRow] = useState(null);
    const [editData, setEditData] = useState({});

    useEffect(() => {
        fetchData();
    }, [activeTable]);

    const fetchData = async () => {
        setLoading(true);
        try {
            if (activeTable === 'samples') {
                const response = await fetch('/api/v1/samples');
                const data = await response.json();
                setSamples(data);
            } else if (activeTable === 'inoculums') {
                const response = await fetch('/api/v1/inoculum');
                const data = await response.json();
                setInoculums(data);
            }
        } catch (error) {
            console.error('Error fetching data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleEdit = (row) => {
        setEditingRow(row.id);
        setEditData({ ...row });
    };

    const handleSave = async () => {
        try {
            const endpoint = activeTable === 'samples' ? '/api/v1/samples' : '/api/v1/inoculum';
            const response = await fetch(`${endpoint}/${editData.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(editData)
            });

            if (response.ok) {
                await fetchData();
                setEditingRow(null);
                setEditData({});
                alert('Record updated successfully!');
            } else {
                alert('Failed to update record');
            }
        } catch (error) {
            console.error('Error updating record:', error);
            alert('Error updating record');
        }
    };

    const handleCancel = () => {
        setEditingRow(null);
        setEditData({});
    };

    const handleDelete = async (id) => {
        if (window.confirm('Are you sure you want to delete this record?')) {
            try {
                const endpoint = activeTable === 'samples' ? '/api/v1/samples' : '/api/v1/inoculum';
                const response = await fetch(`${endpoint}/${id}`, {
                    method: 'DELETE'
                });

                if (response.ok) {
                    await fetchData();
                    alert('Record deleted successfully!');
                } else {
                    alert('Failed to delete record');
                }
            } catch (error) {
                console.error('Error deleting record:', error);
                alert('Error deleting record');
            }
        }
    };

    const handleEditChange = (field, value) => {
        setEditData(prev => ({
            ...prev,
            [field]: value
        }));
    };

    const filteredData = () => {
        const data = activeTable === 'samples' ? samples : inoculums;
        if (!searchTerm) return data;

        return data.filter(item => {
            return Object.values(item).some(value => 
                value && value.toString().toLowerCase().includes(searchTerm.toLowerCase())
            );
        });
    };

    const renderSamplesTable = () => {
        const data = filteredData();

        return (
            <div className="overflow-x-auto">
                <table className="min-w-full bg-white border border-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sample Name</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Substrate Source</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reactor</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Temperature</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {data.map((sample) => (
                            <tr key={sample.id} className="hover:bg-gray-50">
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">{sample.id}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {editingRow === sample.id ? (
                                        <input
                                            type="text"
                                            value={editData.sample_name || ''}
                                            onChange={(e) => handleEditChange('sample_name', e.target.value)}
                                            className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        />
                                    ) : (
                                        sample.sample_name
                                    )}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {editingRow === sample.id ? (
                                        <input
                                            type="text"
                                            value={editData.substrate_source || ''}
                                            onChange={(e) => handleEditChange('substrate_source', e.target.value)}
                                            className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        />
                                    ) : (
                                        sample.substrate_source
                                    )}
                                </td>
                                <td className="px-4 py-4 text-sm text-gray-900 max-w-xs truncate">
                                    {editingRow === sample.id ? (
                                        <input
                                            type="text"
                                            value={editData.description || ''}
                                            onChange={(e) => handleEditChange('description', e.target.value)}
                                            className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        />
                                    ) : (
                                        sample.description
                                    )}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {editingRow === sample.id ? (
                                        <input
                                            type="text"
                                            value={editData.substrate_type || ''}
                                            onChange={(e) => handleEditChange('substrate_type', e.target.value)}
                                            className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        />
                                    ) : (
                                        sample.substrate_type
                                    )}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {editingRow === sample.id ? (
                                        <input
                                            type="text"
                                            value={editData.reactor || ''}
                                            onChange={(e) => handleEditChange('reactor', e.target.value)}
                                            className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        />
                                    ) : (
                                        sample.reactor
                                    )}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {editingRow === sample.id ? (
                                        <input
                                            type="number"
                                            step="0.1"
                                            value={editData.temperature || ''}
                                            onChange={(e) => handleEditChange('temperature', e.target.value)}
                                            className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        />
                                    ) : (
                                        sample.temperature
                                    )}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {editingRow === sample.id ? (
                                        <div className="space-x-2">
                                            <button
                                                onClick={handleSave}
                                                className="text-green-600 hover:text-green-900"
                                            >
                                                Save
                                            </button>
                                            <button
                                                onClick={handleCancel}
                                                className="text-gray-600 hover:text-gray-900"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="space-x-2">
                                            <button
                                                onClick={() => handleEdit(sample)}
                                                className="text-blue-600 hover:text-blue-900"
                                            >
                                                Edit
                                            </button>
                                            <button
                                                onClick={() => handleDelete(sample.id)}
                                                className="text-red-600 hover:text-red-900"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    };

    const renderInoculumsTable = () => {
        const data = filteredData();

        return (
            <div className="overflow-x-auto">
                <table className="min-w-full bg-white border border-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date Created</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">%TS</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">%VS</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {data.map((inoculum) => (
                            <tr key={inoculum.id} className="hover:bg-gray-50">
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">{inoculum.id}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {inoculum.date_created ? new Date(inoculum.date_created).toLocaleDateString() : 'N/A'}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {editingRow === inoculum.id ? (
                                        <input
                                            type="text"
                                            value={editData.inoculum_source || ''}
                                            onChange={(e) => handleEditChange('inoculum_source', e.target.value)}
                                            className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        />
                                    ) : (
                                        inoculum.inoculum_source
                                    )}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {editingRow === inoculum.id ? (
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={editData.inoculum_percent_ts || ''}
                                            onChange={(e) => handleEditChange('inoculum_percent_ts', e.target.value)}
                                            className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        />
                                    ) : (
                                        inoculum.inoculum_percent_ts
                                    )}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {editingRow === inoculum.id ? (
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={editData.inoculum_percent_vs || ''}
                                            onChange={(e) => handleEditChange('inoculum_percent_vs', e.target.value)}
                                            className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        />
                                    ) : (
                                        inoculum.inoculum_percent_vs
                                    )}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {editingRow === inoculum.id ? (
                                        <div className="space-x-2">
                                            <button
                                                onClick={handleSave}
                                                className="text-green-600 hover:text-green-900"
                                            >
                                                Save
                                            </button>
                                            <button
                                                onClick={handleCancel}
                                                className="text-gray-600 hover:text-gray-900"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="space-x-2">
                                            <button
                                                onClick={() => handleEdit(inoculum)}
                                                className="text-blue-600 hover:text-blue-900"
                                            >
                                                Edit
                                            </button>
                                            <button
                                                onClick={() => handleDelete(inoculum.id)}
                                                className="text-red-600 hover:text-red-900"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    };

    return (
        <div className="p-6">
            <h1 className="text-4xl font-bold text-black pl-6 m-6">Database</h1>
            
            <div className="bg-white rounded-lg shadow-sm p-6">
                {/* Table Selection */}
                <div className="mb-6">
                    <div className="flex space-x-4 mb-4">
                        <button
                            onClick={() => setActiveTable('samples')}
                            className={`px-4 py-2 rounded-lg font-medium border-2 transition-all ${
                                activeTable === 'samples'
                                    ? '!border-blue-600 !bg-white !text-black'
                                    : '!border-gray-300 !bg-gray-100 !text-gray-700'
                            } hover:!bg-gray-200`}
                        >
                            Samples
                        </button>
                        <button
                            onClick={() => setActiveTable('inoculums')}
                            className={`px-4 py-2 rounded-lg font-medium border-2 transition-all ${
                                activeTable === 'inoculums'
                                    ? '!border-blue-600 !bg-white !text-black'
                                    : '!border-gray-300 !bg-gray-100 !text-gray-700'
                            } hover:!bg-gray-200`}
                        >
                            Inoculum
                        </button>
                    </div>

                    {/* Search */}
                    <div className="flex items-center space-x-4">
                        <input
                            type="text"
                            placeholder="Search..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
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

                {/* Table Content */}
                {loading ? (
                    <div className="flex justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent"></div>
                    </div>
                ) : (
                    <div>
                        {activeTable === 'samples' ? renderSamplesTable() : renderInoculumsTable()}
                        
                        {filteredData().length === 0 && (
                            <div className="text-center py-8 text-gray-500">
                                No {activeTable} found
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default Database;