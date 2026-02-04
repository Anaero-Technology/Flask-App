import React, { useState } from 'react';
import { Save, FlaskConical, Tag, Scale, Atom, ArrowLeft } from 'lucide-react';
import { useToast } from '../components/Toast';
import { useAuth } from '../components/AuthContext';
import { useTranslation } from 'react-i18next';

function SampleForm({ returnView }) {
    const { authFetch } = useAuth();
    const { t: tPages } = useTranslation('pages');
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
            const response = await authFetch('/api/v1/samples', {
                method: 'POST',
                body: JSON.stringify(formData)
            });

            if (response.ok) {
                toast.success(tPages('sample_form.sample_created'));
                setFormData({
                    sample_name: '', substrate_source: '', description: '',
                    substrate_type: '', substrate_subtype: '', is_inoculum: false,
                    ash_content: '', c_content: '', n_content: '',
                    substrate_percent_ts: '', substrate_percent_vs: ''
                });
            } else {
                const error = await response.json();
                toast.error(error.error || tPages('sample_form.sample_creation_failed'));
            }
        } catch (error) {
            toast.error(error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleBackToTest = () => {
        if (!returnView) return;
        window.dispatchEvent(new CustomEvent('app:navigate', { detail: { view: returnView } }));
    };

    // Component moved outside


    return (
        <div className="h-[calc(100vh-64px)] flex flex-col p-6">

            {/* --- Header (Transparent) --- */}
            <div className="flex justify-between items-end mb-6 shrink-0">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">{tPages('sample_form.title')}</h1>
                    <p className="text-gray-500 mt-1">{tPages('sample_form.subtitle')}</p>
                </div>
                <div className="flex items-center gap-3">
                    {returnView && (
                        <button
                            type="button"
                            onClick={handleBackToTest}
                            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:text-blue-600 hover:shadow-sm transition-all"
                        >
                            <ArrowLeft size={14} />
                            {tPages('sample_form.back_to_test')}
                        </button>
                    )}
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
                                <h2 className="font-semibold">{tPages('sample_form.identification')}</h2>
                            </div>

                            <div className="flex flex-col gap-4">
                                {/* Name & Toggle Group */}
                                <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-4">
                                    <Field
                                        label={tPages('sample_form.sample_name')}
                                        name="sample_name"
                                        value={formData.sample_name}
                                        onChange={handleChange}
                                        placeholder={tPages('sample_form.sample_name_placeholder')}
                                        className="w-full"
                                    />

                                    {/* Inoculum Toggle - Inside Sample Section */}
                                    <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                                        <span className="text-xs font-bold text-gray-500 uppercase">{tPages('sample_form.is_inoculum')}</span>
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
                                        label={tPages('sample_form.source_origin')}
                                        name="substrate_source"
                                        value={formData.substrate_source}
                                        onChange={handleChange}
                                        placeholder={tPages('sample_form.source_origin_placeholder')}
                                    />
                                    <div className="grid grid-cols-2 gap-3">
                                        <Field
                                            label={tPages('sample_form.type')}
                                            name="substrate_type"
                                            value={formData.substrate_type}
                                            onChange={handleChange}

                                        />
                                        <Field
                                            label={tPages('sample_form.sub_type')}
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
                                <h2 className="font-semibold">{tPages('sample_form.physical_properties')}</h2>
                            </div>
                            <div className="grid grid-cols-3 gap-4 bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                <Field
                                    label={tPages('sample_form.total_solids')}
                                    name="substrate_percent_ts"
                                    type="number"
                                    step="0.01"
                                    suffix={tPages('sample_form.percent')}
                                    value={formData.substrate_percent_ts}
                                    onChange={handleChange}
                                />
                                <Field
                                    label={tPages('sample_form.volatile_solids')}
                                    name="substrate_percent_vs"
                                    type="number"
                                    step="0.01"
                                    suffix={tPages('sample_form.percent')}
                                    value={formData.substrate_percent_vs}
                                    onChange={handleChange}
                                />
                                <Field
                                    label={tPages('sample_form.ash_content')}
                                    name="ash_content"
                                    type="number"
                                    step="0.01"
                                    suffix={tPages('sample_form.g_per_kg')}
                                    value={formData.ash_content}
                                    onChange={handleChange}
                                />
                            </div>
                        </div>

                        {/* Chemical Comp */}
                        <div>
                            <div className="flex items-center gap-2 mb-3 text-gray-900">
                                <Atom size={18} className="text-gray-400" />
                                <h2 className="font-semibold">{tPages('sample_form.chemical_composition')}</h2>
                            </div>
                            <div className="grid grid-cols-2 gap-4 bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                <Field
                                    label={tPages('sample_form.carbon')}
                                    name="c_content"
                                    type="number"
                                    step="0.01"
                                    suffix={tPages('sample_form.g_per_kg')}
                                    value={formData.c_content}
                                    onChange={handleChange}
                                />
                                <Field
                                    label={tPages('sample_form.nitrogen')}
                                    name="n_content"
                                    type="number"
                                    step="0.01"
                                    suffix={tPages('sample_form.g_per_kg')}
                                    value={formData.n_content}
                                    onChange={handleChange}
                                />
                            </div>
                        </div>

                        {/* Description (Filling remaining space) */}
                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">{tPages('sample_form.notes_description')}</label>
                            <textarea
                                name="description"
                                value={formData.description}
                                onChange={handleChange}
                                className="h-32 w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-none shadow-sm"
                                placeholder={tPages('sample_form.notes_placeholder')}
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
                        <span>{tPages('sample_form.save_sample')}</span>
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
