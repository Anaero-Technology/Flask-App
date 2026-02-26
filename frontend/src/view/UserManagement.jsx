import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../components/AuthContext';
import { useToast } from '../components/Toast';
import {
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
    Loader2,
    Download
} from 'lucide-react';

function UserManagement() {
    const { authFetch, user: currentUser } = useAuth();
    const { t: tPages } = useTranslation('pages');
    const toast = useToast();

    const ROLES = [
        { id: 'admin', name: tPages('user_management.role_admin'), icon: ShieldAlert, color: 'text-red-600 bg-red-50', description: tPages('user_management.role_admin_desc') },
        { id: 'operator', name: tPages('user_management.role_operator'), icon: ShieldCheck, color: 'text-blue-600 bg-blue-50', description: tPages('user_management.role_operator_desc') },
        { id: 'technician', name: tPages('user_management.role_technician'), icon: Shield, color: 'text-green-600 bg-green-50', description: tPages('user_management.role_technician_desc') },
        { id: 'viewer', name: tPages('user_management.role_viewer'), icon: Eye, color: 'text-gray-600 bg-gray-50', description: tPages('user_management.role_viewer_desc') },
    ];
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
    const [selectedUser, setSelectedUser] = useState(null);
    const [formData, setFormData] = useState({ username: '', email: '', password: '', role: 'viewer' });
    const [newPassword, setNewPassword] = useState('');
    const [saving, setSaving] = useState(false);
    const [downloadingAuditLog, setDownloadingAuditLog] = useState(false);

    const fetchUsers = async () => {
        try {
            const response = await authFetch('/api/v1/users');
            if (response.ok) {
                const data = await response.json();
                setUsers(data);
            } else {
                toast.error(tPages('user_management.failed_load_users'));
            }
        } catch (err) {
            toast.error(tPages('user_management.failed_load_users'));
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
                toast.success(tPages('user_management.user_created_success', { username: data.username }));
                setShowCreateModal(false);
                setFormData({ username: '', email: '', password: '', role: 'viewer' });
                fetchUsers();
            } else {
                toast.error(data.error || tPages('user_management.failed_create_user'));
            }
        } catch (err) {
            toast.error(tPages('user_management.failed_create_user'));
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
                toast.success(tPages('user_management.user_updated_success', { username: data.username }));
                setShowEditModal(false);
                setSelectedUser(null);
                fetchUsers();
            } else {
                toast.error(data.error || tPages('user_management.failed_update_user'));
            }
        } catch (err) {
            toast.error(tPages('user_management.failed_update_user'));
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
                toast.success(tPages('user_management.password_reset_success', { username: selectedUser.username }));
                setShowResetPasswordModal(false);
                setSelectedUser(null);
                setNewPassword('');
            } else {
                toast.error(data.error || tPages('user_management.failed_reset_password'));
            }
        } catch (err) {
            toast.error(tPages('user_management.failed_reset_password'));
        } finally {
            setSaving(false);
        }
    };

    const handleDeactivate = async (user) => {
        if (!confirm(tPages('user_management.deactivate_confirmation', { username: user.username }))) return;

        try {
            const response = await authFetch(`/api/v1/users/${user.id}`, {
                method: 'DELETE',
            });

            if (response.ok) {
                toast.success(tPages('user_management.user_deactivated_success', { username: user.username }));
                fetchUsers();
            } else {
                const data = await response.json();
                toast.error(data.error || tPages('user_management.failed_deactivate_user'));
            }
        } catch (err) {
            toast.error(tPages('user_management.failed_deactivate_user'));
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

    const handleDownloadAuditLog = async () => {
        setDownloadingAuditLog(true);
        try {
            const response = await authFetch('/api/v1/audit-logs/download');
            if (response.ok) {
                // Get the filename from the Content-Disposition header
                const contentDisposition = response.headers.get('content-disposition');
                let filename = 'audit_logs.csv';
                if (contentDisposition) {
                    const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
                    if (filenameMatch) filename = filenameMatch[1];
                }

                // Get the blob and download
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);

                toast.success(tPages('user_management.audit_log_downloaded'));
            } else {
                toast.error(tPages('user_management.failed_download_audit_log'));
            }
        } catch (err) {
            toast.error(tPages('user_management.failed_download_audit_log'));
        } finally {
            setDownloadingAuditLog(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="space-y-4 max-w-6xl">
            {/* Header */}
            <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{tPages('user_management.title')}</h1>
                        <p className="text-gray-500 text-xs">{users.length} {tPages('user_management.users_total')}</p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <button
                        onClick={handleDownloadAuditLog}
                        disabled={downloadingAuditLog}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:bg-gray-400 transition-colors w-full sm:w-auto justify-center"
                        title={tPages('user_management.download_audit_log_tooltip')}
                    >
                        {downloadingAuditLog ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            <Download size={14} />
                        )}
                        {tPages('user_management.download_audit_log')}
                    </button>
                    <button
                        onClick={() => {
                            setFormData({ username: '', email: '', password: '', role: 'viewer' });
                            setShowCreateModal(true);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors w-full sm:w-auto justify-center"
                    >
                        <UserPlus size={14} />
                        {tPages('user_management.add_user')}
                    </button>
                </div>
            </div>

            {/* Users Table */}
            <div className="overflow-hidden border border-gray-200 rounded-lg">
                <div className="px-3 py-2 text-[11px] text-gray-500 bg-gray-50 border-b border-gray-200 sm:hidden">
                    Swipe left/right to view all columns.
                </div>
                <div className="overflow-x-auto">
                <table className="min-w-[720px] w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tPages('user_management.user_header')}</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tPages('user_management.role_header')}</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tPages('user_management.status_header')}</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tPages('user_management.created_header')}</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">{tPages('user_management.actions_header')}</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {users.map((user) => {
                            const roleInfo = getRoleInfo(user.role);
                            const RoleIcon = roleInfo.icon;
                            const isCurrentUser = user.id === currentUser?.id;

                            return (
                                <tr key={user.id} className={`hover:bg-gray-50 ${!user.is_active ? 'opacity-60' : ''}`}>
                                    <td className="px-3 py-2 text-sm text-gray-900">
                                        <div>
                                            <div className="font-medium">
                                                {user.username}
                                                {isCurrentUser && (
                                                    <span className="ml-2 text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">{tPages('user_management.you')}</span>
                                                )}
                                            </div>
                                            <div className="text-xs text-gray-500">{user.email}</div>
                                        </div>
                                    </td>
                                    <td className="px-3 py-2 text-sm text-gray-900">
                                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${roleInfo.color}`}>
                                            <RoleIcon size={12} />
                                            {roleInfo.name}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2 text-sm text-gray-900">
                                        {user.is_active ? (
                                            <span className="inline-flex items-center gap-1 text-green-600 text-xs">
                                                <Check size={14} /> {tPages('user_management.active')}
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 text-gray-400 text-xs">
                                                <X size={14} /> {tPages('user_management.inactive')}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2 text-sm text-gray-500 whitespace-nowrap">
                                        {user.created_at ? new Date(user.created_at).toLocaleDateString() : '-'}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <button
                                                onClick={() => openEditModal(user)}
                                                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                title={tPages('user_management.edit_user_tooltip')}
                                            >
                                                <Edit2 size={14} />
                                            </button>
                                            <button
                                                onClick={() => openResetPasswordModal(user)}
                                                className="p-1.5 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                                                title={tPages('user_management.reset_password_tooltip')}
                                            >
                                                <Key size={14} />
                                            </button>
                                            {!isCurrentUser && user.is_active && (
                                                <button
                                                    onClick={() => handleDeactivate(user)}
                                                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                    title={tPages('user_management.deactivate_user_tooltip')}
                                                >
                                                    <Trash2 size={14} />
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
            </div>

            {/* Create User Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
                        <h2 className="text-xl font-bold text-gray-900 mb-4">{tPages('user_management.create_new_user')}</h2>
                        <form onSubmit={handleCreate} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">{tPages('user_management.username_label')}</label>
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
                                <label className="block text-sm font-medium text-gray-700 mb-1">{tPages('user_management.email_label')}</label>
                                <input
                                    type="email"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">{tPages('user_management.password_label')}</label>
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
                                <label className="block text-sm font-medium text-gray-700 mb-1">{tPages('user_management.role_label')}</label>
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
                                    {tPages('user_management.cancel')}
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400 transition-colors flex items-center gap-2"
                                >
                                    {saving && <Loader2 size={16} className="animate-spin" />}
                                    {tPages('user_management.create_user_button')}
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
                        <h2 className="text-xl font-bold text-gray-900 mb-4">{tPages('user_management.edit_user')}</h2>
                        <form onSubmit={handleUpdate} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">{tPages('user_management.username_label')}</label>
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
                                <label className="block text-sm font-medium text-gray-700 mb-1">{tPages('user_management.email_label')}</label>
                                <input
                                    type="email"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">{tPages('user_management.role_label')}</label>
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
                                    <p className="text-xs text-gray-500 mt-1">{tPages('user_management.cannot_change_own_role')}</p>
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
                                <label htmlFor="is_active" className="text-sm text-gray-700">{tPages('user_management.active_checkbox')}</label>
                            </div>
                            <div className="flex justify-end gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setShowEditModal(false)}
                                    className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                                >
                                    {tPages('user_management.cancel')}
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400 transition-colors flex items-center gap-2"
                                >
                                    {saving && <Loader2 size={16} className="animate-spin" />}
                                    {tPages('user_management.save_changes')}
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
                        <h2 className="text-xl font-bold text-gray-900 mb-4">{tPages('user_management.reset_password')}</h2>
                        <p className="text-gray-600 mb-4">
                            {tPages('user_management.set_new_password_for')} <strong>{selectedUser.username}</strong>
                        </p>
                        <form onSubmit={handleResetPassword} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">{tPages('user_management.new_password_label')}</label>
                                <input
                                    type="password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    required
                                    minLength={6}
                                    placeholder={tPages('user_management.min_characters_placeholder')}
                                />
                            </div>
                            <div className="flex justify-end gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setShowResetPasswordModal(false)}
                                    className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                                >
                                    {tPages('user_management.cancel')}
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:bg-orange-400 transition-colors flex items-center gap-2"
                                >
                                    {saving && <Loader2 size={16} className="animate-spin" />}
                                    {tPages('user_management.reset_password_button')}
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
