import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';

const DashboardLayout = () => {
  const location = useLocation();
  const [isPageLoaded, setIsPageLoaded] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Trigger smooth transition animation on route change
  useEffect(() => {
    setIsPageLoaded(false);
    const timer = setTimeout(() => setIsPageLoaded(true), 50);
    return () => clearTimeout(timer);
  }, [location.pathname]);

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
      
      {/* Sidebar Component */}
      <Sidebar isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />

      {/* Main Content Wrapper */}
      {/* Note: dynamic padding pushes the content to the right to accommodate the expanded/collapsed sidebar. */}
      <div 
        className={`flex-1 flex flex-col h-full w-full transition-all duration-500 ease-in-out ${isCollapsed ? 'lg:pl-20' : 'lg:pl-72'}`}
      >
        
        {/* Main Scrollable Content Area */}
        <main 
          id="main-scroll-container" 
          className="flex-1 overflow-y-auto p-4 lg:p-8 custom-scrollbar"
        >
          {/* Page Transition Wrapper */}
          <div 
            className={`max-w-7xl mx-auto w-full transition-all duration-500 ease-out transform ${
              isPageLoaded 
                ? 'opacity-100 translate-y-0' 
                : 'opacity-0 translate-y-4'
            }`}
          >
            <Outlet />
          </div>
        </main>

      </div>
    </div>
  );
};

export default DashboardLayout;