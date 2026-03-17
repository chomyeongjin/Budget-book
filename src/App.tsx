import { useState, useEffect } from 'react';
import './App.css';
import CircularTimetable from './components/Timetable';

// Type definitions
interface ScheduleData {
  [date: string]: {
    [id: string]: { id: string; startHour: number; endHour: number; title: string; color: string }
  };
}

function App() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  
  // State for popup and schedules
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<ScheduleData>(() => {
    const saved = localStorage.getItem('dailyPlannerSchedules');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse schedules from storage');
      }
    }
    return {};
  });

  // Local Storage Persistence
  useEffect(() => {
    localStorage.setItem('dailyPlannerSchedules', JSON.stringify(schedules));
  }, [schedules]);

  // Theme Logic
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  // Calendar Logic
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const getDaysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
  const getFirstDayOfMonth = (y: number, m: number) => new Date(y, m, 1).getDay();

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);

  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };
  
  // Check if a cell is today
  const isToday = (day: number) => {
    const today = new Date();
    return day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
  };

  // Format YYYY-MM-DD for checking schedule
  const getDateString = (d: number) => {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };

  const handleDayClick = (day: number) => {
    const dateStr = getDateString(day);
    setSelectedDate(dateStr);
  };

  const handleAddSchedule = (dateStr: string, newSession: any) => {
    setSchedules(prev => {
      const dayData = prev[dateStr] || {};
      return {
        ...prev,
        [dateStr]: {
          ...dayData,
          [newSession.id]: newSession
        }
      };
    });
  };

  const handleUpdateSchedule = (dateStr: string, updatedSession: any) => {
    setSchedules(prev => {
      const dayData = prev[dateStr] || {};
      if (!dayData[updatedSession.id]) return prev;
      return {
        ...prev,
        [dateStr]: {
          ...dayData,
          [updatedSession.id]: updatedSession
        }
      };
    });
  };

  const handleDeleteSchedule = (dateStr: string, id: string) => {
    setSchedules(prev => {
      const dayData = { ...prev[dateStr] };
      if (dayData && dayData[id]) {
        delete dayData[id];
      }
      return {
        ...prev,
        [dateStr]: dayData
      };
    });
  };

  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  return (
    <div className="app-container">
      <header>
        <div className="header-title">Daily Planner</div>
        <button className="theme-toggle" onClick={toggleTheme}>
          {theme === 'light' ? '🌙 Dark' : '☀️ Light'}
        </button>
      </header>

      <main>
        <div className="calendar-card glass-panel">
          <div className="calendar-header">
            <button className="month-nav-btn" onClick={prevMonth}>&larr; Prev</button>
            <h2>{monthNames[month]} {year}</h2>
            <button className="month-nav-btn" onClick={nextMonth}>Next &rarr;</button>
          </div>

          <div className="calendar-grid">
            {weekdays.map(day => (
              <div key={day} className="weekday-header">{day}</div>
            ))}
            
            {/* Empty slots for days before the 1st of the month */}
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`empty-${i}`} className="day-cell empty"></div>
            ))}

            {/* Actual days */}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const d = i + 1;
              const dateStr = getDateString(d);
              const hasSchedule = schedules[dateStr] && Object.keys(schedules[dateStr]).length > 0;
              
              return (
                <div 
                  key={d} 
                  className={`day-cell ${isToday(d) ? 'today' : ''}`}
                  onClick={() => handleDayClick(d)}
                >
                  <span className="day-number">{d}</span>
                  <div className={`day-indicator ${hasSchedule ? 'active' : ''}`}></div>
                </div>
              );
            })}
          </div>
        </div>
      </main>

      {/* Render Timetable Popup conditionally */}
      {selectedDate && (
        <CircularTimetable 
          date={selectedDate}
          schedules={Object.values(schedules[selectedDate] || {})}
          onAddSchedule={(newBlock) => handleAddSchedule(selectedDate, newBlock)}
          onUpdateSchedule={(updatedBlock) => handleUpdateSchedule(selectedDate, updatedBlock)}
          onDeleteSchedule={(id) => handleDeleteSchedule(selectedDate, id)}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </div>
  );
}

export default App;
