import React from 'react';
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
  Cpu
} from 'lucide-react';

function Sidebar({ onNavigate, currentView }) {

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'test', label: 'Start Test', icon: FlaskConical },
    { id: 'database', label: 'Database', icon: Database },
    { id: 'plot', label: 'Plot', icon: LineChart },
    { id: 'upload', label: 'Upload Data', icon: Upload },
  ];

  const secondaryItems = [
    { id: 'blackbox', label: 'BlackBox', icon: Box },
    { id: 'chimera', label: 'Chimera', icon: Activity },
    { id: 'plc', label: 'PLC', icon: Cpu },
    { id: 'monitor', label: 'Monitor', icon: Monitor },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

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
        <span className="text-sm font-medium">{item.label}</span>
        {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-600" />}
      </li>
    );
  };

  return (
    <div className="w-64 h-screen bg-white border-r border-gray-200 flex flex-col fixed left-0 top-0 z-50 shadow-sm">
      {/* Header */}
      <div className="h-16 flex items-center px-6 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <img src={logo} className="h-8 w-8 object-contain" alt="Logo" />
          <span className="text-lg font-bold text-gray-900 tracking-tight">Anaero Technology</span>
        </div>
      </div>

      {/* CTA */}
      <div className="p-4">
        <button
          onClick={() => onNavigate('create-sample')}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 text-sm font-medium"
        >
          <PlusCircle size={18} />
          Create Sample
        </button>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-2">
        <div className="px-6 py-2 text-xs font-bold text-gray-400 uppercase tracking-wider">Main</div>
        <ul>
          {menuItems.map(item => <NavItem key={item.id} item={item} />)}
        </ul>

        <div className="px-6 py-2 mt-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Tools</div>
        <ul>
          {secondaryItems.map(item => <NavItem key={item.id} item={item} />)}
        </ul>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-200 bg-gray-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white rounded-full border border-gray-200 flex items-center justify-center shadow-sm text-gray-500">
            <User size={20} />
          </div>
          <div className="flex flex-col overflow-hidden">
            <span className="text-sm font-semibold text-gray-900 truncate">Admin User</span>
            <span className="text-xs text-gray-500 truncate">admin@anaero.tech</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Sidebar;