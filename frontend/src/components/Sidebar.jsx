import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import { useTranslation } from 'react-i18next';
import logo from '../assets/logo.png';
import { useTheme } from './ThemeContext';
import { useAppSettings } from './AppSettingsContext';
import { useToast } from './Toast';
import {
  LayoutDashboard,
  FlaskConical,
  Database,
  LineChart,
  Upload,
  Settings,
  PlusCircle,
  User,
  Users,
  X,
  LogOut,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Eye
} from 'lucide-react';

const ROLE_CONFIG = {
  admin: { icon: ShieldAlert, color: 'text-red-600', label: 'Admin' },
  operator: { icon: ShieldCheck, color: 'text-blue-600', label: 'Operator' },
  technician: { icon: Shield, color: 'text-green-600', label: 'Technician' },
  viewer: { icon: Eye, color: 'text-gray-600', label: 'Viewer' },
};

function Sidebar({ onNavigate, currentView, isOpen, onClose }) {
  const { user, logout, canPerform, authFetch } = useAuth();
  const { t: tSidebar } = useTranslation('sidebar');
  const { t: tPages } = useTranslation('pages');
  const { theme, toggleTheme } = useTheme();
  const { companyName, logoUrl } = useAppSettings();
  const toast = useToast();
  const isDark = theme === 'dark';
  const [showProfileUpload, setShowProfileUpload] = useState(false);
  const [profilePicturePreview, setProfilePicturePreview] = useState(user?.profile_picture_url);
  const [uploadingProfile, setUploadingProfile] = useState(false);

  const menuItems = [
    { id: 'dashboard', labelKey: 'dashboard', icon: LayoutDashboard },
    { id: 'test', labelKey: 'start_test', icon: FlaskConical, permission: 'start_test' },
    { id: 'database', labelKey: 'database', icon: Database },
    { id: 'plot', labelKey: 'plot', icon: LineChart },
    { id: 'upload', labelKey: 'upload_data', icon: Upload, permission: 'modify_test' },
    { id: 'settings', labelKey: 'settings', icon: Settings },
  ];

  const adminItems = [
    { id: 'users', labelKey: 'user_management', icon: Users, permission: 'manage_users' },
  ];

  const handleLogout = async () => {
    await logout();
  };

  const handleProfilePictureUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size
    if (file.size > 2 * 1024 * 1024) {
      toast.error('File too large (max 2 MB)');
      return;
    }

    setUploadingProfile(true);

    try {
      const formData = new FormData();
      formData.append('profile_picture', file);

      const response = await authFetch(`/api/v1/users/${user.id}/profile-picture`, {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        toast.success('Profile picture uploaded');
        // Show preview
        const reader = new FileReader();
        reader.onload = (event) => {
          setProfilePicturePreview(event.target?.result);
        };
        reader.readAsDataURL(file);
        setShowProfileUpload(false);
      } else {
        const data = await response.json();
        toast.error(data.error || 'Failed to upload profile picture');
      }
    } catch (error) {
      toast.error('Error uploading profile picture');
    } finally {
      setUploadingProfile(false);
      e.target.value = '';
    }
  };

  const deleteProfilePicture = async () => {
    setUploadingProfile(true);

    try {
      const response = await authFetch(`/api/v1/users/${user.id}/profile-picture`, {
        method: 'DELETE'
      });

      if (response.ok) {
        toast.success('Profile picture removed');
        setProfilePicturePreview(null);
        setShowProfileUpload(false);
      } else {
        const data = await response.json();
        toast.error(data.error || 'Failed to remove profile picture');
      }
    } catch (error) {
      toast.error('Error removing profile picture');
    } finally {
      setUploadingProfile(false);
    }
  };

  // Filter items based on permissions
  const filterItems = (items) => {
    return items.filter(item => {
      if (!item.permission) return true;
      return canPerform(item.permission);
    });
  };

  const NavItem = ({ item }) => {
    const Icon = item.icon;
    const isActive = currentView === item.id;

    return (
      <li
        className={`
          px-4 py-3 mx-2 mb-1 rounded-lg flex items-center cursor-pointer transition-all duration-200 group
          ${isActive
            ? 'bg-blue-50 text-blue-700 shadow-sm dark:bg-blue-500/10 dark:text-blue-200'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100'}
        `}
        onClick={() => onNavigate(item.id)}
      >
        <Icon size={20} className={`mr-3 ${isActive ? 'text-blue-600 dark:text-blue-300' : 'text-gray-400 group-hover:text-gray-600 dark:text-slate-500 dark:group-hover:text-slate-200'}`} />
        <span className="text-sm font-medium">{tSidebar(item.labelKey)}</span>
        {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-blue-300" />}
      </li>
    );
  };

  const roleConfig = user ? ROLE_CONFIG[user.role] || ROLE_CONFIG.viewer : ROLE_CONFIG.viewer;
  const RoleIcon = roleConfig.icon;

  return (
    <div className={`
      w-64 h-screen bg-white border-r border-gray-200 dark:bg-slate-900 dark:border-slate-800
      flex flex-col fixed left-0 top-0 z-50 shadow-sm
      transition-transform duration-300 ease-in-out
      ${isOpen ? 'translate-x-0' : '-translate-x-full'}
      lg:translate-x-0
    `}>
      {/* Header */}
      <div className="h-16 flex items-center justify-between px-6 border-b border-gray-100 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <button
            onClick={toggleTheme}
            aria-label={isDark ? tSidebar('light_mode') : tSidebar('dark_mode')}
            title={isDark ? tSidebar('light_mode') : tSidebar('dark_mode')}
            className={`
              h-9 w-9 rounded-lg flex items-center justify-center app-logo-wrap cursor-pointer
              transition-all duration-300 ease-in-out
              ${isDark
                ? 'hover:shadow-[0_0_20px_8px_rgba(251,191,36,0.4)] hover:scale-105'
                : 'hover:shadow-[0_0_20px_8px_rgba(15,23,42,0.3)] hover:scale-105'}
            `}
          >
            <img src={logoUrl || logo} className="h-7 w-7 object-contain app-logo" alt="Logo" />
          </button>
          <span className="text-lg font-bold text-gray-900 dark:text-slate-100 tracking-tight">{companyName}</span>
        </div>
        {/* Close button for mobile */}
        <button
          onClick={onClose}
          className="lg:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
          aria-label="Close menu"
        >
          <X size={20} className="text-gray-500 dark:text-slate-400" />
        </button>
      </div>

      {/* CTA - Only show if user can create samples */}
      {canPerform('create_sample') && (
        <div className="p-4">
          <button
            onClick={() => onNavigate('create-sample')}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 text-sm font-medium"
          >
            <PlusCircle size={16} />
            {tSidebar('create_sample')}
          </button>
        </div>
      )}

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-2">
        <div className="px-6 py-2 text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">{tSidebar('main')}</div>
        <ul>
          {filterItems(menuItems).map(item => <NavItem key={item.id} item={item} />)}
        </ul>

        {/* Admin Section - Only show if user has admin permissions */}
        {filterItems(adminItems).length > 0 && (
          <>
            <div className="px-6 py-2 mt-4 text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">{tSidebar('admin')}</div>
            <ul>
              {filterItems(adminItems).map(item => <NavItem key={item.id} item={item} />)}
            </ul>
          </>
        )}
      </div>

      {/* Footer with User Info */}
      <div className="p-4 border-t border-gray-200 bg-gray-50 dark:bg-slate-900 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowProfileUpload(!showProfileUpload)}
            className="w-10 h-10 bg-white dark:bg-slate-800 rounded-full border border-gray-200 dark:border-slate-700 flex items-center justify-center shadow-sm hover:border-blue-400 hover:shadow-md transition-all flex-shrink-0 overflow-hidden"
            title="Click to upload profile picture"
          >
            {profilePicturePreview ? (
              <img src={profilePicturePreview} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              <User size={20} className="text-gray-500 dark:text-slate-400" />
            )}
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-900 dark:text-slate-100 truncate">
                {user?.username || 'User'}
              </span>
              <RoleIcon size={14} className={roleConfig.color} title={roleConfig.label} />
            </div>
            <span className="text-xs text-gray-500 dark:text-slate-400 truncate block">{user?.email || ''}</span>
          </div>
          <button
            onClick={handleLogout}
            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors dark:hover:bg-red-500/10"
            title={tSidebar('logout')}
          >
            <LogOut size={18} />
          </button>
        </div>

        {/* Profile Picture Upload Modal */}
        {showProfileUpload && (
          <div className="mt-3 p-3 bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 space-y-2">
            <p className="text-xs text-gray-600 dark:text-slate-400 mb-2">{tSidebar('upload_profile_picture')}</p>
            <label className="flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 cursor-pointer transition-colors w-full">
              <span>{tSidebar('choose_image')}</span>
              <input
                type="file"
                accept="image/*"
                onChange={handleProfilePictureUpload}
                disabled={uploadingProfile}
                className="hidden"
              />
            </label>
            {profilePicturePreview && (
              <button
                onClick={deleteProfilePicture}
                disabled={uploadingProfile}
                className="w-full px-3 py-2 bg-red-600 text-white text-xs rounded-lg hover:bg-red-700 disabled:bg-gray-400 transition-colors"
              >
                {tSidebar('remove_picture')}
              </button>
            )}
            <button
              onClick={() => setShowProfileUpload(false)}
              className="w-full px-3 py-2 bg-gray-300 text-gray-900 text-xs rounded-lg hover:bg-gray-400 transition-colors dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
            >
              {tSidebar('close')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default Sidebar;
