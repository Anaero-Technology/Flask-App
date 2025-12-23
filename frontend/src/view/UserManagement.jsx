import React, { useState, useEffect } from 'react';
import { useAuth } from '../components/AuthContext';
import { useToast } from '../components/Toast';
import {
    Users,
    UserPlus,
    Edit2,
    Trash2,
    Key,
    Check,
    X,
    Shield,
    ShieldCheck,
    ShieldAlert,
    Eye,
    Loader2
} from 'lucide-react';

const ROLES = [
    { id: 'admin', name: 'Admin', icon: ShieldAlert, color: 'text-red-600 bg-red-50', description: 'Full access' },
    { id: 'operator', name: 'Operator', icon: ShieldCheck, color: 'text-blue-600 bg-blue-50', description: 'Manage tests & devices' },
    { id: 'technician', name: 'Technician', icon: Shield, color: 'text-green-600 bg-green-50', description: 'Run tests' },
    { id: 'viewer', name: 'Viewer', icon: Eye, color: 'text-gray-600 bg-gray-50', description: 'View only' },
];

function UserManagement() {
    const { authFetch, user: currentUser } = useAuth();
    const toast = useToast();
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
    const [selectedUser, setSelectedUser] = useState(null);
    const [formData, setFormData] = useState({ username: '', email: '', password: '', role: 'viewer' });
    const [newPassword, setNewPassword] = useState('');
    const [saving, setSaving] = useState(false);

    const fetchUsers = async () => {
        try {
            const response = await authFetch('/api/v1/users');
            if (response.ok) {
                const data = await response.json();
                setUsers(data);
            } else {
                toast.error('Failed to load users');
            }
        } catch (err) {
            toast.error('Failed to load users');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchUsers();
    }, []);

    const handleCreate = async (e) => {
        e.preventDefault();
        setSaving(true);

        try {
            const response = await authFetch('/api/v1/users', {
                method: 'POST',
                body: JSON.stringify(formData),
            });

            const data = await response.json();

            if (response.ok) {
                toast.success(`User ${data.username} created successfully`);
                setShowCreateModal(false);
                setFormData({ username: '', email: '', password: '', role: 'viewer' });
                fetchUsers();
            } else {
                toast.error(data.error || 'Failed to create user');
            }
        } catch (err) {
            toast.error('Failed to create user');
        } finally {
            setSaving(false);
        }
    };

    const handleUpdate = async (e) => {
        e.preventDefault();
        if (!selectedUser) return;
        setSaving(true);

        try {
            const response = await authFetch(`/api/v1/users/${selectedUser.id}`, {
                method: 'PUT',
                body: JSON.stringify({
                    username: formData.username,
                    email: formData.email,
                    role: formData.role,
                    is_active: formData.is_active,
                }),
            });

            const data = await response.json();

            if (response.ok) {
                toast.success(`User ${data.username} updated successfully`);
                setShowEditModal(false);
                setSelectedUser(null);
                fetchUsers();
            } else {
                toast.error(data.error || 'Failed to update user');
            }
        } catch (err) {
            toast.error('Failed to update user');
        } finally {
            setSaving(false);
        }
    };

    const handleResetPassword = async (e) => {
        e.preventDefault();
        if (!selectedUser) return;
        setSaving(true);

        try {
            const response = await authFetch(`/api/v1/users/${selectedUser.id}/reset-password`, {
                method: 'POST',
                body: JSON.stringify({ new_password: newPassword }),
            });

            const data = await response.json();

            if (response.ok) {
                toast.success(`Password reset for ${selectedUser.username}`);
                setShowResetPasswordModal(false);
                setSelectedUser(null);
                setNewPassword('');
            } else {
                toast.error(data.error || 'Failed to reset password');
            }
        } catch (err) {
            toast.error('Failed to reset password');
        } finally {
            setSaving(false);
        }
    };

    const handleDeactivate = async (user) => {
        if (!confirm(`Are you sure you want to deactivate ${user.username}?`)) return;

        try {
            const response = await authFetch(`/api/v1/users/${user.id}`, {
                method: 'DELETE',
            });

            if (response.ok) {
                toast.success(`User ${user.username} deactivated`);
                fetchUsers();
            } else {
                const data = await response.json();
                toast.error(data.error || 'Failed to deactivate user');
            }
        } catch (err) {
            toast.error('Failed to deactivate user');
        }
    };

    const openEditModal = (user) => {
        setSelectedUser(user);
        setFormData({
            username: user.username,
            email: user.email,
            role: user.role,
            is_active: user.is_active,
        });
        setShowEditModal(true);
    };

    const openResetPasswordModal = (user) => {
        setSelectedUser(user);
        setNewPassword('');
        setShowResetPasswordModal(true);
    };

    const getRoleInfo = (roleId) => ROLES.find(r => r.id === roleId) || ROLES[3];

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="p-6 max-w-6xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 rounded-lg">
                        <Users className="w-6 h-6 text-blue-600" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
                        <p className="text-gray-500 text-sm">{users.length} users total</p>
                    </div>
                </div>
                <button
                    onClick={() => {
                        setFormData({ username: '', email: '', password: '', role: 'viewer' });
                        setShowCreateModal(true);
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                    <UserPlus size={20} />
                    Add User
                </button>
            </div>

            {/* Users Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">User</th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Role</th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Created</th>
                            <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {users.map((user) => {
                            const roleInfo = getRoleInfo(user.role);
                            const RoleIcon = roleInfo.icon;
                            const isCurrentUser = user.id === currentUser?.id;

                            return (
                                <tr key={user.id} className={`hover:bg-gray-50 ${!user.is_active ? 'opacity-60' : ''}`}>
                                    <td className="px-6 py-4">
                                        <div>
                                            <div className="font-medium text-gray-900">
                                                {user.username}
                                                {isCurrentUser && (
                                                    <span className="ml-2 text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">You</span>
                                                )}
                                            </div>
                                            <div className="text-sm text-gray-500">{user.email}</div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium ${roleInfo.color}`}>
                                            <RoleIcon size={14} />
                                            {roleInfo.name}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        {user.is_active ? (
                                            <span className="inline-flex items-center gap-1 text-green-600 text-sm">
                                                <Check size={16} /> Active
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 text-gray-400 text-sm">
                                                <X size={16} /> Inactive
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-500">
                                        {user.created_at ? new Date(user.created_at).toLocaleDateString() : '-'}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                onClick={() => openEditModal(user)}
                                                className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                title="Edit user"
                                            >
                                                <Edit2 size={18} />
                                            </button>
                                            <button
                                                onClick={() => openResetPasswordModal(user)}
                                                className="p-2 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                                                title="Reset password"
                                            >
                                                <Key size={18} />
                                            </button>
                                            {!isCurrentUser && user.is_active && (
                                                <button
                                                    onClick={() => handleDeactivate(user)}
                                                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                    title="Deactivate user"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Create User Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
                        <h2 className="text-xl font-bold text-gray-900 mb-4">Create New User</h2>
                        <form onSubmit={handleCreate} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                                <input
                                    type="text"
                                    value={formData.username}
                                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    required
                                    minLength={3}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                                <input
                                    type="email"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                                <input
                                    type="password"
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    required
                                    minLength={6}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                                <select
                                    value={formData.role}
                                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                >
                                    {ROLES.map(role => (
                                        <option key={role.id} value={role.id}>
                                            {role.name} - {role.description}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex justify-end gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setShowCreateModal(false)}
                                    className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400 transition-colors flex items-center gap-2"
                                >
                                    {saving && <Loader2 size={16} className="animate-spin" />}
                                    Create User
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Edit User Modal */}
            {showEditModal && selectedUser && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
                        <h2 className="text-xl font-bold text-gray-900 mb-4">Edit User</h2>
                        <form onSubmit={handleUpdate} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                                <input
                                    type="text"
                                    value={formData.username}
                                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    required
                                    minLength={3}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                                <input
                                    type="email"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                                <select
                                    value={formData.role}
                                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    disabled={selectedUser.id === currentUser?.id}
                                >
                                    {ROLES.map(role => (
                                        <option key={role.id} value={role.id}>
                                            {role.name} - {role.description}
                                        </option>
                                    ))}
                                </select>
                                {selectedUser.id === currentUser?.id && (
                                    <p className="text-xs text-gray-500 mt-1">You cannot change your own role</p>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="is_active"
                                    checked={formData.is_active}
                                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                                    disabled={selectedUser.id === currentUser?.id}
                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <label htmlFor="is_active" className="text-sm text-gray-700">Active</label>
                            </div>
                            <div className="flex justify-end gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setShowEditModal(false)}
                                    className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400 transition-colors flex items-center gap-2"
                                >
                                    {saving && <Loader2 size={16} className="animate-spin" />}
                                    Save Changes
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Reset Password Modal */}
            {showResetPasswordModal && selectedUser && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
                        <h2 className="text-xl font-bold text-gray-900 mb-4">Reset Password</h2>
                        <p className="text-gray-600 mb-4">
                            Set a new password for <strong>{selectedUser.username}</strong>
                        </p>
                        <form onSubmit={handleResetPassword} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                                <input
                                    type="password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    required
                                    minLength={6}
                                    placeholder="Minimum 6 characters"
                                />
                            </div>
                            <div className="flex justify-end gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setShowResetPasswordModal(false)}
                                    className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:bg-orange-400 transition-colors flex items-center gap-2"
                                >
                                    {saving && <Loader2 size={16} className="animate-spin" />}
                                    Reset Password
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export default UserManagement;
