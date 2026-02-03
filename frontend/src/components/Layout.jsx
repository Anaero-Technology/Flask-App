import React, { useState } from 'react';
import Sidebar from './Sidebar';
import { Menu } from 'lucide-react';
import { useAppSettings } from './AppSettingsContext';

const Layout = ({ children, currentView, onNavigate }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { companyName } = useAppSettings();

  const handleNavigate = (view) => {
    onNavigate(view);
    setSidebarOpen(false); // Close sidebar on mobile after navigation
  };

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-slate-950 font-sans">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-white border-b border-gray-200 dark:bg-slate-900 dark:border-slate-800 flex items-center px-4 z-40">
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
          aria-label="Open menu"
        >
          <Menu size={24} className="text-gray-600 dark:text-slate-300" />
        </button>
        <span className="ml-3 font-semibold text-gray-900 dark:text-slate-100">{companyName}</span>
      </div>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <Sidebar
        currentView={currentView}
        onNavigate={handleNavigate}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main Content Area */}
      <main className="flex-1 lg:ml-64 overflow-y-auto p-4 pt-16 lg:pt-4 text-gray-900 dark:text-slate-100">
        <div className="max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
