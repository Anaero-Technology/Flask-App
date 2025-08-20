import React, { useState } from 'react';

function InoculumForm() {
    const [formData, setFormData] = useState({
        inoculum_source: '',
        inoculum_percent_ts: '',
        inoculum_percent_vs: ''
    });

    const [loading, setLoading] = useState(false);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        
        try {
            const response = await fetch('/api/v1/inoculum', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(formData)
            });

            if (response.ok) {
                const result = await response.json();
                console.log('Inoculum created:', result);
                
                // Reset form
                setFormData({
                    inoculum_source: '',
                    inoculum_percent_ts: '',
                    inoculum_percent_vs: ''
                });
                
                alert('Inoculum created successfully!');
            } else {
                const error = await response.json();
                alert(`Failed to create inoculum: ${error.error || 'Unknown error'}`);
            }
        } catch (error) {
            alert(`Failed to create inoculum: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-6">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 mb-6 rounded-lg">
                <h1 className="text-2xl font-bold text-gray-900">Create Inoculum</h1>
            </div>

            <div className="bg-white rounded-lg shadow-sm">
                <div className="p-6">
                    <form onSubmit={handleSubmit} className="w-full">
                        {/* Inoculum Information */}
                        <div className="space-y-6">
                            <div>
                                <h2 className="text-xl font-semibold text-gray-800 mb-4">Inoculum</h2>
                                
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            Source <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            name="inoculum_source"
                                            value={formData.inoculum_source}
                                            onChange={handleChange}
                                            required
                                            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                            placeholder="Enter inoculum source"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            %TS (of wet weight)
                                        </label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            name="inoculum_percent_ts"
                                            value={formData.inoculum_percent_ts}
                                            onChange={handleChange}
                                            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                            placeholder="0.00"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            %VS (of wet weight)
                                        </label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            name="inoculum_percent_vs"
                                            value={formData.inoculum_percent_vs}
                                            onChange={handleChange}
                                            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                            placeholder="0.00"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Submit Button */}
                            <div className="pt-6">
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full max-w-md mx-auto px-6 py-3 bg-yellow-600 text-black rounded-lg hover:bg-yellow-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {loading && (
                                        <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                                    )}
                                    {loading ? 'Creating Inoculum...' : 'Create Inoculum'}
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}

export default InoculumForm;