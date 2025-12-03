import React, { useState } from 'react';
import { Save, FlaskConical, Tag, Scale, Atom } from 'lucide-react';
import { useToast } from '../components/Toast';

function SampleForm() {
    const toast = useToast();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        sample_name: '',
        substrate_source: '',
        description: '',
        substrate_type: '',
        substrate_subtype: '',
        is_inoculum: false,
        ash_content: '',
        c_content: '',
        n_content: '',
        substrate_percent_ts: '',
        substrate_percent_vs: '',
    });

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const response = await fetch('/api/v1/samples', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            if (response.ok) {
                toast.success('Sample created successfully!');
                setFormData({
                    sample_name: '', substrate_source: '', description: '',
                    substrate_type: '', substrate_subtype: '', is_inoculum: false,
                    ash_content: '', c_content: '', n_content: '',
                    substrate_percent_ts: '', substrate_percent_vs: ''
                });
            } else {
                const error = await response.json();
                toast.error(error.error || 'Failed to create sample');
            }
        } catch (error) {
            toast.error(error.message);
        } finally {
            setLoading(false);
        }
    };

    // Component moved outside


    return (
        <div className="h-[calc(100vh-64px)] flex flex-col p-6">

            {/* --- Header (Transparent) --- */}
            <div className="flex justify-between items-end mb-6 shrink-0">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Create Sample</h1>
                    <p className="text-gray-500 mt-1">Register a new substrate or inoculum.</p>
                </div>
                {/* Visual Indicator only, toggle is below */}
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide border ${formData.is_inoculum ? 'bg-purple-100 text-purple-700 border-purple-200' : 'bg-blue-100 text-blue-700 border-blue-200'
                    }`}>
                    <FlaskConical size={14} />
                    {formData.is_inoculum ? 'Inoculum' : 'Substrate'}
                </div>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 flex flex-col gap-6 min-h-0">

                {/* --- Main Content Grid --- */}
                <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0">

                    {/* LEFT COLUMN: Identity (4 cols) */}
                    <div className="lg:col-span-4 flex flex-col gap-6">
                        {/* Identity Section */}
                        <div className="flex-1">
                            <div className="flex items-center gap-2 mb-3 text-gray-900">
                                <Tag size={18} className="text-gray-400" />
                                <h2 className="font-semibold">Identification</h2>
                            </div>

                            <div className="flex flex-col gap-4">
                                {/* Name & Toggle Group */}
                                <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-4">
                                    <Field
                                        label="Sample Name"
                                        name="sample_name"
                                        value={formData.sample_name}
                                        onChange={handleChange}
                                        placeholder="e.g. WW-Batch-001"
                                        className="w-full"
                                    />

                                    {/* Inoculum Toggle - Inside Sample Section */}
                                    <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                                        <span className="text-xs font-bold text-gray-500 uppercase">Is Inoculum?</span>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input
                                                type="checkbox"
                                                name="is_inoculum"
                                                checked={formData.is_inoculum}
                                                onChange={handleChange}
                                                className="sr-only peer"
                                            />
                                            <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-600"></div>
                                        </label>
                                    </div>
                                </div>

                                <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-4">
                                    <Field
                                        label="Source / Origin"
                                        name="substrate_source"
                                        value={formData.substrate_source}
                                        onChange={handleChange}
                                        placeholder="e.g. Local Farm"
                                    />
                                    <div className="grid grid-cols-2 gap-3">
                                        <Field
                                            label="Type"
                                            name="substrate_type"
                                            value={formData.substrate_type}
                                            onChange={handleChange}

                                        />
                                        <Field
                                            label="Sub-Type"
                                            name="substrate_subtype"
                                            value={formData.substrate_subtype}
                                            onChange={handleChange}

                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* RIGHT COLUMN: Metrics (8 cols) */}
                    <div className="lg:col-span-8 flex flex-col gap-6">
                        {/* Physical Props */}
                        <div>
                            <div className="flex items-center gap-2 mb-3 text-gray-900">
                                <Scale size={18} className="text-gray-400" />
                                <h2 className="font-semibold">Physical Properties</h2>
                            </div>
                            <div className="grid grid-cols-2 gap-4 bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                <Field
                                    label="Total Solids (TS)"
                                    name="substrate_percent_ts"
                                    type="number"
                                    step="0.01"
                                    suffix="%"
                                    value={formData.substrate_percent_ts}
                                    onChange={handleChange}
                                />
                                <Field
                                    label="Volatile Solids (VS)"
                                    name="substrate_percent_vs"
                                    type="number"
                                    step="0.01"
                                    suffix="%"
                                    value={formData.substrate_percent_vs}
                                    onChange={handleChange}
                                />
                            </div>
                        </div>

                        {/* Chemical Comp */}
                        <div>
                            <div className="flex items-center gap-2 mb-3 text-gray-900">
                                <Atom size={18} className="text-gray-400" />
                                <h2 className="font-semibold">Chemical Composition</h2>
                            </div>
                            <div className="grid grid-cols-3 gap-4 bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                <Field
                                    label="Carbon"
                                    name="c_content"
                                    type="number"
                                    step="0.01"
                                    suffix="g/kg"
                                    value={formData.c_content}
                                    onChange={handleChange}
                                />
                                <Field
                                    label="Nitrogen"
                                    name="n_content"
                                    type="number"
                                    step="0.01"
                                    suffix="g/kg"
                                    value={formData.n_content}
                                    onChange={handleChange}
                                />
                                <Field
                                    label="Ash Content"
                                    name="ash_content"
                                    type="number"
                                    step="0.01"
                                    suffix="g/kg"
                                    value={formData.ash_content}
                                    onChange={handleChange}
                                />
                            </div>
                        </div>

                        {/* Description (Filling remaining space) */}
                        <div className="flex-1 flex flex-col">
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Notes & Description</label>
                            <textarea
                                name="description"
                                value={formData.description}
                                onChange={handleChange}
                                className="flex-1 w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-none shadow-sm"
                                placeholder="Add any specific details..."
                            />
                        </div>
                    </div>
                </div>

                {/* --- Footer --- */}
                <div className="flex justify-end pt-4 border-t border-gray-200 mt-auto">
                    <button
                        type="submit"
                        disabled={loading}
                        className={`
                            flex items-center gap-2 px-8 py-3 rounded-xl font-bold text-white shadow-lg transition-all transform hover:-translate-y-0.5
                            ${formData.is_inoculum
                                ? 'bg-purple-600 hover:bg-purple-700 shadow-purple-200'
                                : 'bg-blue-600 hover:bg-blue-700 shadow-blue-200'}
                            disabled:opacity-70 disabled:cursor-not-allowed
                        `}
                    >
                        {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={20} />}
                        <span>Save Sample</span>
                    </button>
                </div>

            </form>
        </div>
    );
}

// Component: Simple Input Field with Label
const Field = ({ label, name, type = "text", placeholder, step, suffix, className, value, onChange }) => (
    <div className={`relative ${className}`}>
        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">{label}</label>
        <div className="relative">
            <input
                type={type}
                name={name}
                step={step}
                value={value}
                onChange={onChange}
                placeholder={placeholder}
                className={`w-full bg-white border border-gray-200 text-gray-900 text-sm rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all shadow-sm ${suffix ? 'pr-10' : ''} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
            />
            {suffix && <span className="absolute right-3 top-2.5 text-xs text-gray-500 font-medium pointer-events-none">{suffix}</span>}
        </div>
    </div>
);

export default SampleForm;