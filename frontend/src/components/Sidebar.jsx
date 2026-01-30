import React from 'react';
import { useAuth } from './AuthContext';
import { useTranslation } from 'react-i18next';
import logo from '../assets/logo.png';
import {
  LayoutDashboard,
  FlaskConical,
  Database,
  LineChart,
  Upload,
  Box,
  Activity,
  Monitor,
  Settings,
  PlusCircle,
  User,
  Users,
  Cpu,
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
  const { user, logout, canPerform } = useAuth();
  const { t: tSidebar } = useTranslation('sidebar');
  const { t: tCommon } = useTranslation('common');

  const menuItems = [
    { id: 'dashboard', labelKey: 'dashboard', icon: LayoutDashboard },
    { id: 'test', labelKey: 'start_test', icon: FlaskConical, permission: 'start_test' },
    { id: 'database', labelKey: 'database', icon: Database },
    { id: 'plot', labelKey: 'plot', icon: LineChart },
    { id: 'upload', labelKey: 'upload_data', icon: Upload, permission: 'modify_test' },
  ];

  const secondaryItems = [
    { id: 'blackbox', labelKey: 'blackbox', icon: Box },
    { id: 'chimera', labelKey: 'chimera', icon: Activity },
    { id: 'plc', labelKey: 'plc', icon: Cpu },
    { id: 'monitor', labelKey: 'monitor', icon: Monitor },
    { id: 'settings', labelKey: 'settings', icon: Settings },
  ];

  const adminItems = [
    { id: 'users', labelKey: 'user_management', icon: Users, permission: 'manage_users' },
  ];

  const handleLogout = async () => {
    await logout();
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
            ? 'bg-blue-50 text-blue-700 shadow-sm'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}
        `}
        onClick={() => onNavigate(item.id)}
      >
        <Icon size={20} className={`mr-3 ${isActive ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-600'}`} />
        <span className="text-sm font-medium">{tSidebar(item.labelKey)}</span>
        {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-600" />}
      </li>
    );
  };

  const roleConfig = user ? ROLE_CONFIG[user.role] || ROLE_CONFIG.viewer : ROLE_CONFIG.viewer;
  const RoleIcon = roleConfig.icon;

  return (
    <div className={`
      w-64 h-screen bg-white border-r border-gray-200 flex flex-col fixed left-0 top-0 z-50 shadow-sm
      transition-transform duration-300 ease-in-out
      ${isOpen ? 'translate-x-0' : '-translate-x-full'}
      lg:translate-x-0
    `}>
      {/* Header */}
      <div className="h-16 flex items-center justify-between px-6 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <img src={logo} className="h-8 w-8 object-contain" alt="Logo" />
          <span className="text-lg font-bold text-gray-900 tracking-tight">{tCommon('app_name')}</span>
        </div>
        {/* Close button for mobile */}
        <button
          onClick={onClose}
          className="lg:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors"
          aria-label="Close menu"
        >
          <X size={20} className="text-gray-500" />
        </button>
      </div>

      {/* CTA - Only show if user can create samples */}
      {canPerform('create_sample') && (
        <div className="p-4">
          <button
            onClick={() => onNavigate('create-sample')}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 text-sm font-medium"
          >
            <PlusCircle size={18} />
            {tSidebar('create_sample')}
          </button>
        </div>
      )}

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-2">
        <div className="px-6 py-2 text-xs font-bold text-gray-400 uppercase tracking-wider">{tSidebar('main')}</div>
        <ul>
          {filterItems(menuItems).map(item => <NavItem key={item.id} item={item} />)}
        </ul>

        <div className="px-6 py-2 mt-4 text-xs font-bold text-gray-400 uppercase tracking-wider">{tSidebar('tools')}</div>
        <ul>
          {filterItems(secondaryItems).map(item => <NavItem key={item.id} item={item} />)}
        </ul>

        {/* Admin Section - Only show if user has admin permissions */}
        {filterItems(adminItems).length > 0 && (
          <>
            <div className="px-6 py-2 mt-4 text-xs font-bold text-gray-400 uppercase tracking-wider">{tSidebar('admin')}</div>
            <ul>
              {filterItems(adminItems).map(item => <NavItem key={item.id} item={item} />)}
            </ul>
          </>
        )}
      </div>

      {/* Footer with User Info */}
      <div className="p-4 border-t border-gray-200 bg-gray-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white rounded-full border border-gray-200 flex items-center justify-center shadow-sm">
            <User size={20} className="text-gray-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-900 truncate">
                {user?.username || 'User'}
              </span>
              <RoleIcon size={14} className={roleConfig.color} title={roleConfig.label} />
            </div>
            <span className="text-xs text-gray-500 truncate block">{user?.email || ''}</span>
          </div>
          <button
            onClick={handleLogout}
            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            title={tSidebar('logout')}
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default Sidebar;
