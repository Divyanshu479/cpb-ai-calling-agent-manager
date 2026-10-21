import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { logout } from '../../store/slices/authSlice';
import { ROLES } from '../../utils/constants';

// --- Custom SVG Icons ---
const Icons = {
  Dashboard: () => (
    <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  ),
  Queue: () => (
    <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  ),
  Users: () => (
    <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  ),
  Settings: () => (
    <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  Robot: () => (
    <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ),
  Phone: () => (
    <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  ),
  Logs: () => (
    <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  ),
  Chart: () => (
    <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
  Logo: () => (
    <svg className="w-6 h-6 text-white flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  ),
  User: () => (
    <svg className="w-5 h-5 text-indigo-200 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  Logout: () => (
    <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  ),
  ChevronLeft: () => (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
    </svg>
  ),
  ChevronRight: () => (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
    </svg>
  )
};

const Sidebar = ({ isCollapsed, setIsCollapsed }) => {
  const dispatch = useDispatch();
  const location = useLocation();
  const { user } = useSelector((state) => state.auth);
  
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Close mobile menu on route change for better UX
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  const handleLogout = () => dispatch(logout());

  const adminNavItems = [
    { name: 'Dashboard', path: '/admin/dashboard', icon: <Icons.Dashboard /> },
    { name: 'Queue Monitor', path: '/admin/queue', icon: <Icons.Queue /> },
    { name: 'Campaign Managers', path: '/admin/managers', icon: <Icons.Users /> },
    { name: 'Custom Integrations', path: '/admin/integrations', icon: <Icons.Settings /> },
    { name: 'Telephony Settings', path: '/admin/telephony', icon: <Icons.Phone /> },
    { name: 'All Campaigns', path: '/admin/campaigns', icon: <Icons.Robot /> },
    { name: 'All Logs', path: '/admin/logs', icon: <Icons.Logs /> },
    { name: 'Usage Reports', path: '/admin/reports', icon: <Icons.Chart /> },
  ];

  const cmNavItems = [
    { name: 'Dashboard', path: '/cm/dashboard', icon: <Icons.Dashboard /> },
    { name: 'AI Callers', path: '/cm/callers', icon: <Icons.Robot /> },
    { name: 'Campaigns', path: '/cm/campaigns', icon: <Icons.Queue /> },
    { name: 'Call Logs', path: '/cm/logs', icon: <Icons.Logs /> },
  ];

  const navItems = user?.role === ROLES.ADMIN ? adminNavItems : cmNavItems;

  return (
    <>
      {/* Mobile Menu Toggle Button */}
      <button
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        aria-label="Toggle navigation menu"
        className="lg:hidden fixed top-4 left-4 z-50 p-2.5 bg-slate-900 border border-slate-700 text-white rounded-xl shadow-lg hover:bg-slate-800 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <svg 
          className={`h-5 w-5 transition-transform duration-300 ${isMobileMenuOpen ? 'rotate-90 scale-0 hidden' : 'rotate-0 scale-100 block'}`} 
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        <svg 
          className={`h-5 w-5 transition-transform duration-300 ${isMobileMenuOpen ? 'rotate-0 scale-100 block' : '-rotate-90 scale-0 hidden'}`} 
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Mobile Overlay */}
      <div
        className={`lg:hidden fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 transition-opacity duration-300 ${
          isMobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setIsMobileMenuOpen(false)}
      />

      {/* Sidebar Container */}
      <aside 
        className={`flex flex-col h-screen bg-slate-900 text-slate-300 fixed left-0 top-0 shadow-2xl border-r border-slate-800 z-40 transition-all duration-500 cubic-bezier(0.4, 0, 0.2, 1) 
        ${isMobileMenuOpen ? 'translate-x-0 w-72' : '-translate-x-full lg:translate-x-0'} 
        ${isCollapsed ? 'lg:w-20' : 'lg:w-72'}`}
      >
        
        {/* Desktop Collapse Toggle Button */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="hidden lg:flex absolute -right-3.5 top-8 h-7 w-7 bg-slate-800 border border-slate-600 rounded-full items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 hover:scale-110 hover:shadow-lg transition-all duration-300 z-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="Toggle sidebar collapse"
        >
          {isCollapsed ? <Icons.ChevronRight /> : <Icons.ChevronLeft />}
        </button>

        {/* Logo Section */}
        <div className={`p-6 border-b border-slate-800 flex-shrink-0 flex items-center transition-all duration-300 ${isCollapsed ? 'justify-center px-4' : ''}`}>
          <div className="h-10 w-10 min-w-[40px] bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20 hover:scale-105 hover:bg-blue-500 transition-all duration-300 cursor-pointer">
            <Icons.Logo />
          </div>
          <div className={`overflow-hidden whitespace-nowrap transition-all duration-300 ${isCollapsed ? 'w-0 opacity-0 ml-0' : 'w-auto opacity-100 ml-4'}`}>
            <h1 className="font-bold text-lg text-white tracking-wide">AI<span className="text-blue-500">Caller</span></h1>
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-widest mt-0.5">Workspace</p>
          </div>
        </div>

        {/* Navigation Section */}
        <nav className="flex-1 overflow-y-auto py-6 px-3 space-y-1.5 custom-scrollbar overflow-x-hidden">
          <p className={`text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4 transition-all duration-300 ${isCollapsed ? 'text-center' : 'px-3'}`}>
            {isCollapsed ? '—' : 'Menu'}
          </p>
          
          {navItems.map((item) => (
            <div key={item.path} className="relative group">
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center rounded-lg transition-all duration-300 ease-in-out ${
                    isCollapsed ? 'justify-center p-2.5 mx-auto w-11 h-11' : 'px-3 py-2.5'
                  } ${
                    isActive
                      ? 'bg-blue-500/10 text-blue-400 font-medium'
                      : 'hover:bg-slate-800/50 hover:text-slate-100'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <div className={`transition-transform duration-300 group-hover:scale-110 ${isActive ? 'text-blue-400' : 'text-slate-400 group-hover:text-slate-200'}`}>
                      {item.icon}
                    </div>
                    
                    <span className={`overflow-hidden whitespace-nowrap text-sm tracking-wide transition-all duration-300 ${
                      isCollapsed ? 'w-0 opacity-0 ml-0' : 'w-auto opacity-100 ml-3'
                    }`}>
                      {item.name}
                    </span>
                    
                    {/* Active Indicator Dot (Expanded Only) */}
                    {!isCollapsed && isActive && (
                      <div className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
                    )}
                  </>
                )}
              </NavLink>

              {/* Floating Tooltip for Collapsed State */}
              {isCollapsed && (
                <div className="absolute left-full ml-4 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-slate-700 text-white text-xs font-medium rounded-md shadow-xl opacity-0 scale-95 pointer-events-none group-hover:opacity-100 group-hover:scale-100 transition-all duration-200 z-50 whitespace-nowrap">
                  {item.name}
                  {/* Tooltip Triangle */}
                  <div className="absolute top-1/2 -left-1 -translate-y-1/2 border-[5px] border-transparent border-r-slate-700"></div>
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* User Info & Logout Section */}
        <div className="border-t border-slate-800 p-4 bg-slate-900/50 flex-shrink-0">
          <div className={`flex items-center mb-4 transition-all duration-300 ${
            isCollapsed ? 'justify-center p-0 bg-transparent border-0' : 'p-2 rounded-xl bg-slate-800/50 border border-slate-700/50 hover:border-slate-600'
          }`}>
            <div className="h-10 w-10 min-w-[40px] rounded-full bg-slate-700 flex items-center justify-center border border-slate-600">
              <Icons.User />
            </div>
            
            <div className={`overflow-hidden whitespace-nowrap transition-all duration-300 ${
              isCollapsed ? 'w-0 opacity-0 ml-0' : 'w-auto opacity-100 ml-3 flex-1'
            }`}>
              <p className="text-sm font-medium text-white truncate">{user?.name || 'Guest User'}</p>
              <div className="flex items-center mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 shadow-[0_0_5px_rgba(16,185,129,0.5)]"></span>
                <p className="text-[11px] text-slate-400 capitalize truncate font-medium">{user?.role || 'User'}</p>
              </div>
            </div>
          </div>
          
          <div className="relative group">
            <button
              onClick={handleLogout}
              className={`w-full flex items-center justify-center text-sm font-medium text-slate-300 bg-slate-800 hover:bg-rose-500/10 hover:text-rose-400 rounded-lg border border-transparent hover:border-rose-500/30 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-rose-500/40 ${
                isCollapsed ? 'p-2.5 h-11' : 'px-4 py-2.5'
              }`}
              aria-label="Sign out"
            >
              <div className={`transition-transform duration-300 ${isCollapsed ? 'group-hover:scale-110' : 'group-hover:-translate-x-1'}`}>
                <Icons.Logout />
              </div>
              <span className={`overflow-hidden whitespace-nowrap transition-all duration-300 ${
                isCollapsed ? 'w-0 opacity-0 ml-0' : 'w-auto opacity-100 ml-2'
              }`}>
                Sign Out
              </span>
            </button>

            {/* Logout Tooltip for Collapsed State */}
            {isCollapsed && (
              <div className="absolute left-full ml-4 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-rose-600 text-white text-xs font-medium rounded-md shadow-xl opacity-0 scale-95 pointer-events-none group-hover:opacity-100 group-hover:scale-100 transition-all duration-200 z-50 whitespace-nowrap">
                Sign Out
                <div className="absolute top-1/2 -left-1 -translate-y-1/2 border-[5px] border-transparent border-r-rose-600"></div>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;