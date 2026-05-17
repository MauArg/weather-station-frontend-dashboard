import React, { useState } from 'react';
import Dashboard from './components/Dashboard';
import CalendarView from './components/CalendarView';
import { Calendar as CalendarIcon, Activity } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import './index.css';

function App() {
  const [view, setView] = useState('dashboard'); // 'dashboard' or 'calendar'

  return (
    <div className="app-container">
      <Toaster position="top-right" />
      <nav className="navbar">
        <div className="logo">
          <Activity className="logo-icon" />
          <h1>Weather Station<span className="highlight">UI</span></h1>
        </div>
        <div className="nav-actions">
          {view === 'dashboard' && (
            <button onClick={() => setView('calendar')} className="nav-btn">
              <CalendarIcon size={18} /> History
            </button>
          )}
          {view === 'calendar' && (
            <button onClick={() => setView('dashboard')} className="nav-btn">
              <Activity size={18} /> Live Dashboard
            </button>
          )}
        </div>
      </nav>

      <main className="main-content">
        {view === 'dashboard' ? <Dashboard /> : <CalendarView onBack={() => setView('dashboard')} />}
      </main>
    </div>
  );
}

export default App;
