import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext();

const API_BASE = '/api/v1';

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Get tokens from localStorage
    const getAccessToken = () => localStorage.getItem('access_token');
    const getRefreshToken = () => localStorage.getItem('refresh_token');

    // Store tokens
    const setTokens = (accessToken, refreshToken) => {
        if (accessToken) localStorage.setItem('access_token', accessToken);
        if (refreshToken) localStorage.setItem('refresh_token', refreshToken);
    };

    // Clear tokens and user
    const clearAuth = () => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        setUser(null);
    };

    // Make authenticated API request
    const authFetch = useCallback(async (url, options = {}) => {
        const accessToken = getAccessToken();

        const headers = {
            ...options.headers,
        };

        // Only set Content-Type to JSON if body is not FormData
        // FormData needs the browser to set Content-Type automatically with boundary
        if (!(options.body instanceof FormData)) {
            headers['Content-Type'] = 'application/json';
        }

        if (accessToken) {
            headers['Authorization'] = `Bearer ${accessToken}`;
        } else {
            console.warn('[AuthFetch] No access token available for request:', url);
        }

        let response = await fetch(url, { ...options, headers });

        // If 401, try to refresh token
        if (response.status === 401 && getRefreshToken()) {
            const refreshed = await refreshAccessToken();
            if (refreshed) {
                // Retry with new token
                headers['Authorization'] = `Bearer ${getAccessToken()}`;
                response = await fetch(url, { ...options, headers });
            }
        }

        // If still 401 after refresh attempt, logout
        if (response.status === 401) {
            clearAuth();
        }

        return response;
    }, []);

    // Refresh access token
    const refreshAccessToken = async () => {
        const refreshToken = getRefreshToken();
        if (!refreshToken) return false;

        try {
            const response = await fetch(`${API_BASE}/auth/refresh`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${refreshToken}`,
                    'Content-Type': 'application/json',
                },
            });

            if (response.ok) {
                const data = await response.json();
                localStorage.setItem('access_token', data.access_token);
                return true;
            }
        } catch (err) {
            console.error('Token refresh failed:', err);
        }

        clearAuth();
        return false;
    };

    // Login
    const login = async (username, password) => {
        setError(null);
        try {
            const response = await fetch(`${API_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });

            const data = await response.json();

            if (response.ok) {
                setTokens(data.access_token, data.refresh_token);
                setUser(data.user);
                return { success: true };
            } else {
                setError(data.error || 'Login failed');
                return { success: false, error: data.error };
            }
        } catch (err) {
            const errorMsg = 'Network error. Please try again.';
            setError(errorMsg);
            return { success: false, error: errorMsg };
        }
    };

    // Logout
    const logout = async () => {
        try {
            await authFetch(`${API_BASE}/auth/logout`, { method: 'POST' });
        } catch (err) {
            // Ignore errors on logout
        }
        clearAuth();
    };

    // Check if user has required role
    const hasRole = (allowedRoles) => {
        if (!user) return false;
        if (typeof allowedRoles === 'string') {
            return user.role === allowedRoles;
        }
        return allowedRoles.includes(user.role);
    };

    // Check if user can perform action based on role hierarchy
    const canPerform = (action) => {
        if (!user) return false;

        const permissions = {
            // View permissions - all roles
            'view_data': ['admin', 'operator', 'technician', 'viewer'],
            'view_tests': ['admin', 'operator', 'technician', 'viewer'],
            'view_devices': ['admin', 'operator', 'technician', 'viewer'],

            // Test operations - not viewer
            'start_test': ['admin', 'operator', 'technician'],
            'stop_test': ['admin', 'operator', 'technician'],

            // Modify operations - admin and operator only
            'create_sample': ['admin', 'operator'],
            'modify_sample': ['admin', 'operator'],
            'delete_sample': ['admin', 'operator'],
            'modify_test': ['admin', 'operator'],
            'delete_test': ['admin', 'operator'],
            'manage_devices': ['admin', 'operator'],

            // Admin only
            'manage_users': ['admin'],
            'system_settings': ['admin'],
            'manage_database': ['admin'],
        };

        const allowedRoles = permissions[action];
        if (!allowedRoles) return false;
        return allowedRoles.includes(user.role);
    };

    // Fetch current user on mount
    useEffect(() => {
        const fetchUser = async () => {
            const accessToken = getAccessToken();
            if (!accessToken) {
                setLoading(false);
                return;
            }

            try {
                const response = await fetch(`${API_BASE}/auth/me`, {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                    },
                });

                if (response.ok) {
                    const userData = await response.json();
                    setUser(userData);
                } else if (response.status === 401) {
                    // Try refresh
                    const refreshed = await refreshAccessToken();
                    if (refreshed) {
                        // Retry fetching user
                        const retryResponse = await fetch(`${API_BASE}/auth/me`, {
                            headers: {
                                'Authorization': `Bearer ${getAccessToken()}`,
                            },
                        });
                        if (retryResponse.ok) {
                            const userData = await retryResponse.json();
                            setUser(userData);
                        } else {
                            clearAuth();
                        }
                    }
                }
            } catch (err) {
                console.error('Failed to fetch user:', err);
                clearAuth();
            } finally {
                setLoading(false);
            }
        };

        fetchUser();
    }, []);

    // Set up token refresh interval (refresh 5 minutes before expiry)
    useEffect(() => {
        if (!user) return;

        // Refresh token every 50 minutes (tokens expire in 1 hour)
        const refreshInterval = setInterval(() => {
            refreshAccessToken();
        }, 50 * 60 * 1000);

        return () => clearInterval(refreshInterval);
    }, [user]);

    const value = {
        user,
        loading,
        error,
        isAuthenticated: !!user,
        login,
        logout,
        hasRole,
        canPerform,
        authFetch,
        clearError: () => setError(null),
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export default AuthContext;
