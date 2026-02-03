import React, { createContext, useContext, useState, useEffect } from 'react';

const AppSettingsContext = createContext();

const API_BASE = '/api/v1';

export const useAppSettings = () => {
    const context = useContext(AppSettingsContext);
    if (!context) {
        throw new Error('useAppSettings must be used within an AppSettingsProvider');
    }
    return context;
};

export const AppSettingsProvider = ({ children }) => {
    const [companyName, setCompanyName] = useState('Anaero Technology');
    const [logoUrl, setLogoUrl] = useState(null);
    const [loading, setLoading] = useState(true);

    const refreshSettings = async () => {
        try {
            const response = await fetch(`${API_BASE}/app-settings`);
            if (response.ok) {
                const data = await response.json();
                setCompanyName(data.company_name || 'Anaero Technology');
                setLogoUrl(data.logo_url || null);
            }
        } catch (err) {
            console.error('Failed to fetch app settings:', err);
        }
    };

    // Fetch settings on mount
    useEffect(() => {
        const fetchSettings = async () => {
            await refreshSettings();
            setLoading(false);
        };

        fetchSettings();
    }, []);

    const value = {
        companyName,
        logoUrl,
        loading,
        refreshSettings,
    };

    return (
        <AppSettingsContext.Provider value={value}>
            {children}
        </AppSettingsContext.Provider>
    );
};

export default AppSettingsContext;
