import React from 'react';
import logo from '../assets/logo.png';

function Sidebar({ onNavigate, currentView }) {

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'test', label: 'Start Test' },
    { id: 'database', label: 'Database' },
    { id: 'plot', label: 'Plot' },
    { id: 'upload', label: 'Upload Data' },
  ];

  const secondaryItems = [
    { id: 'blackbox', label: 'BlackBox' },
    { id: 'chimera', label: 'Chimera' },
    { id: 'monitor', label: 'Monitor' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <div className="w-64 h-screen bg-white border-r border-gray-200 flex flex-col fixed left-0 top-0 z-50">
      <div className="p-5 border-b border-gray-200 flex items-center">
        <div className="flex items-center gap-3">
          <img src={logo} className="h-13 w-13 object-contain" alt="Logo" />
          <span className="text-base font-semibold text-gray-900">Anaero Technology</span>
        </div>
      </div>

      <div className="mx-4 my-4 space-y-2">
        <button
          onClick={() => onNavigate('create-sample')}
          className="w-full px-4 py-2.5 bg-green-500 hover:bg-green-600 text-black rounded-lg flex items-center gap-2 transition-colors"
        >
          <span className="font-bold">+</span>
          <span className="font-medium">Create Sample</span>
        </button>
      </div>

      <div className="py-4">
        <div className="px-5 text-xs font-semibold text-gray-400 uppercase mb-2">Main</div>
        <ul>
          {menuItems.map(item => (
            <li 
              key={item.id}
              className={`px-5 py-2.5 flex items-center cursor-pointer transition-colors relative
                ${currentView === item.id 
                  ? 'bg-blue-50 text-blue-600 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-blue-600' 
                  : 'text-gray-600 hover:bg-gray-50'}`}
              onClick={() => onNavigate(item.id)}
            >
              <span className="text-sm font-medium">{item.label}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="py-4">
        <div className="px-5 text-xs font-semibold text-gray-400 uppercase mb-2">Tools</div>
        <ul>
          {secondaryItems.map(item => (
            <li 
              key={item.id}
              className={`px-5 py-2.5 flex items-center cursor-pointer transition-colors relative
                ${currentView === item.id 
                  ? 'bg-blue-50 text-blue-600 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-blue-600' 
                  : 'text-gray-600 hover:bg-gray-50'}`}
              onClick={() => onNavigate(item.id)}
            >
              <span className="text-sm font-medium">{item.label}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-auto p-5 border-t border-gray-200">
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 bg-gray-200 rounded-full flex items-center justify-center text-lg">👤</span>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-gray-900">Admin</span>
            <span className="text-xs text-gray-500">admin@anaero.tech</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Sidebar;