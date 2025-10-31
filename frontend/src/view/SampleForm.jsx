import React, { useState } from 'react';

function SampleForm() {
    const [formData, setFormData] = useState({
        sample_name: '',
        substrate_source: '',
        description: '',
        substrate_type: '',
        substrate_subtype: '',
        ash_content: '',
        c_content: '',
        n_content: '',
        substrate_percent_ts: '',
        substrate_percent_vs: '',
        author: ''
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
            const response = await fetch('/api/v1/samples', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(formData)
            });

            if (response.ok) {
                const result = await response.json();
                console.log('Sample created:', result);
                
                // Reset form
                setFormData({
                    sample_name: '',
                    substrate_source: '',
                    description: '',
                    substrate_type: '',
                    substrate_subtype: '',
                    ash_content: '',
                    c_content: '',
                    n_content: '',
                    substrate_percent_ts: '',
                    substrate_percent_vs: '',
                    author: ''
                });
                
                alert('Sample created successfully!');
            } else {
                const error = await response.json();
                alert(`Failed to create sample: ${error.error || 'Unknown error'}`);
            }
        } catch (error) {
            alert(`Failed to create sample: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-6">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 mb-6 rounded-lg">
                <h1 className="text-2xl font-bold text-gray-900">Create Sample</h1>
            </div>

            <div className="bg-white rounded-lg shadow-sm">
                <div className="p-6">
                    <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* Left Column - Substrate */}
                        <div className="space-y-6">
                            <div>
                                <h2 className="text-xl font-semibold text-gray-800 mb-4">Substrate</h2>
                                
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            Name <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            name="sample_name"
                                            value={formData.sample_name}
                                            onChange={handleChange}
                                            required
                                            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            Source
                                        </label>
                                        <input
                                            type="text"
                                            name="substrate_source"
                                            value={formData.substrate_source}
                                            onChange={handleChange}
                                            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            Description
                                        </label>
                                        <input
                                            type="text"
                                            name="description"
                                            value={formData.description}
                                            onChange={handleChange}
                                            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            Type
                                        </label>
                                        <input
                                            type="text"
                                            name="substrate_type"
                                            value={formData.substrate_type}
                                            onChange={handleChange}
                                            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            Sub-Type
                                        </label>
                                        <input
                                            type="text"
                                            name="substrate_subtype"
                                            value={formData.substrate_subtype}
                                            onChange={handleChange}
                                            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            C Content (g/kg)
                                        </label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            name="c_content"
                                            value={formData.c_content}
                                            onChange={handleChange}
                                            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            N Content (g/kg)
                                        </label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            name="n_content"
                                            value={formData.n_content}
                                            onChange={handleChange}
                                            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                        />
                                    </div>
                                </div>
                            </div>

                         
                        </div>

                        {/* Right Column - Substrate Characteristics */}
                        <div className="space-y-6">
                               {/* Substrate Characteristics */}
                               <div>
                                <h3 className="text-lg font-semibold text-gray-800 mb-4">Substrate Characteristics</h3>
                                
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-4">
                                            %TS (of wet weight)
                                        </label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            name="substrate_percent_ts"
                                            value={formData.substrate_percent_ts}
                                            onChange={handleChange}
                                            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                        />
                                    </div>

                                 <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            %VS (of wet weight)
                                        </label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            name="substrate_percent_vs"
                                            value={formData.substrate_percent_vs}
                                            onChange={handleChange}
                                            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                        />
                                    </div>
                                </div>
                            </div>

                        </div>

                        {/* Submit Button */}
                        <div className="col-span-1 lg:col-span-2 pt-6">
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full max-w-md mx-auto px-6 py-3 bg-blue-600 text-black rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {loading && (
                                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                                )}
                                {loading ? 'Creating Sample...' : 'Create Sample'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}

export default SampleForm;