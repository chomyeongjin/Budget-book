import React, { useState, useRef } from 'react';
import './Timetable.css';

interface ScheduleBlock {
  id: string;
  title: string;
  startHour: number; // 0.0 to 24.0
  endHour: number;
  color: string;
}

interface TimetableProps {
  date: string;
  schedules: ScheduleBlock[];
  onAddSchedule: (schedule: ScheduleBlock) => void;
  onUpdateSchedule: (schedule: ScheduleBlock) => void;
  onDeleteSchedule: (id: string) => void;
  onClose: () => void;
}

const PASTEL_COLORS = [
  'var(--pie-1)', 'var(--pie-2)', 'var(--pie-3)', 
  'var(--pie-4)', 'var(--pie-5)', 'var(--pie-6)'
];

const CircularTimetable: React.FC<TimetableProps> = ({ date, schedules, onAddSchedule, onUpdateSchedule, onDeleteSchedule, onClose }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartHour, setDragStartHour] = useState<number | null>(null);
  const [dragCurrentHour, setDragCurrentHour] = useState<number | null>(null);
  
  const svgRef = useRef<SVGSVGElement>(null);

  // Helper to convert mouse coordinates to hour (0 - 24)
  const getHourFromEvent = (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent): number => {
    if (!svgRef.current) return 0;
    
    // Support both mouse and touch events
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    const rect = svgRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    const x = clientX - centerX;
    const y = clientY - centerY;
    
    // Calculate angle in radians. Math.atan2(y, x) is 0 at 3 o'clock.
    // We want 0 at 12 o'clock (top), moving clockwise.
    let angle = Math.atan2(y, x) + Math.PI / 2;
    if (angle < 0) angle += 2 * Math.PI;

    // Convert angle to hour (0 - 24)
    // 2 * PI radians = 24 hours
    const hour = (angle / (2 * Math.PI)) * 24;
    return hour;
  };

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    const hour = getHourFromEvent(e);
    setIsDragging(true);
    setDragStartHour(hour);
    setDragCurrentHour(hour);
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDragging) return;
    const hour = getHourFromEvent(e);
    setDragCurrentHour(hour);
  };

  const handlePointerUp = () => {
    if (isDragging && dragStartHour !== null && dragCurrentHour !== null) {
      let start = dragStartHour;
      let end = dragCurrentHour;
      
      // Calculate snap to nearest 15 mins (0.25 hours) for neatness
      start = Math.round(start * 4) / 4;
      end = Math.round(end * 4) / 4;

      // Handle raw distance calculation (before sorting)
      // The issue user described: 23 to 1 -> Mathematical raw distance is -22.
      let sliceStart = start;
      let sliceEnd = end;

      // If user dragged across midnight physically but didn't actually 
      // want to wrap, or if they dragged 23->1, we clip it at 24.
      const rawDistance = Math.abs(start - end);
      
      if (rawDistance > 12) {
        // This usually means they crossed the 0-12 boundary in a way that
        // implies crossing Midnight (e.g. 23 to 1, or 1 to 23).
        // If they started late and dragged "forward" across zero:
        if (start > 12 && end < 12) {
            sliceStart = start;
            sliceEnd = 24; // Clip at midnight!
        }
        // If they started early and dragged "backward" across zero:
        else if (start < 12 && end > 12) {
            sliceStart = end;
            sliceEnd = 24; // Also clip at midnight
        }
      } else {
        // Normal drag without crossing the 0-12 boundary largely
        sliceStart = Math.min(start, end);
        sliceEnd = Math.max(start, end);
      }

      // Minimum time difference to be considered a drag
      if (Math.abs(sliceEnd - sliceStart) >= 0.25) {
        onAddSchedule({
          id: Date.now().toString(),
          title: 'New Task',
          startHour: sliceStart,
          endHour: sliceEnd,
          color: PASTEL_COLORS[schedules.length % PASTEL_COLORS.length]
        });
      }
    }
    setIsDragging(false);
    setDragStartHour(null);
    setDragCurrentHour(null);
  };

  // Helper to draw an SVG arc for schedule slices
  const createArcPath = (startHr: number, endHr: number, radius: number): string => {
    let actualStart = Math.min(startHr, endHr);
    let actualEnd = Math.max(startHr, endHr);
    
    // Safety clamp (though handled in Up event, just in case for rendering)
    if (actualEnd > 24) actualEnd = 24;
    
    // If you happen to cover exactly a full circle (e.g 0 to 24), SVG arc breaks
    // so we render 23.999 instead for visual completion
    if (actualEnd - actualStart >= 24) {
      actualEnd = actualStart + 23.999;
    }

    const startAngle = (actualStart / 24) * 2 * Math.PI - Math.PI / 2;
    const endAngle = (actualEnd / 24) * 2 * Math.PI - Math.PI / 2;

    const startX = Math.cos(startAngle) * radius + 50;
    const startY = Math.sin(startAngle) * radius + 50;
    const endX = Math.cos(endAngle) * radius + 50;
    const endY = Math.sin(endAngle) * radius + 50;

    const largeArcFlag = (actualEnd - actualStart) <= 12 ? "0" : "1";

    return [
      `M 50 50`, // move to center
      `L ${startX} ${startY}`, // line to arc start
      `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endX} ${endY}`, // draw arc
      `Z` // close back to center
    ].join(" ");
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-content glass-panel" onClick={e => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>Schedule for {date}</h3>
          <button className="close-btn" onClick={onClose}>X</button>
        </div>
        
        <div className="timetable-container">
          <svg 
            ref={svgRef}
            viewBox="0 0 100 100" 
            className="circular-clock"
            onMouseDown={handlePointerDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onMouseLeave={handlePointerUp}
            onTouchStart={handlePointerDown}
            onTouchMove={handlePointerMove}
            onTouchEnd={handlePointerUp}
          >
            {/* Base Circle Clock Face */}
            <circle cx="50" cy="50" r="48" fill="var(--bg-color)" stroke="var(--border-color)" strokeWidth="1" />
            
            {/* Draw 24-hour markers and text labels */}
            {Array.from({ length: 24 }).map((_, i) => {
              const angle = (i / 24) * 2 * Math.PI - Math.PI / 2;
              
              // Make every 6th hour (0, 6, 12, 18) more prominent
              const isPrimary = i % 6 === 0;
              const tickLength = isPrimary ? 5 : 3;
              
              const x1 = Math.cos(angle) * (48 - tickLength) + 50;
              const y1 = Math.sin(angle) * (48 - tickLength) + 50;
              const x2 = Math.cos(angle) * 48 + 50;
              const y2 = Math.sin(angle) * 48 + 50;
              
              const textX = Math.cos(angle) * 39 + 50;
              const textY = Math.sin(angle) * 39 + 50;

              return (
                <g key={`marker-${i}`}>
                  <line 
                    x1={x1} y1={y1} x2={x2} y2={y2} 
                    stroke="var(--border-color)" 
                    strokeWidth={isPrimary ? "1" : "0.5"} 
                  />
                  {/* Show all hours or every 2 hours depending on styling preference. We will show all for a classic planner look */}
                  <text 
                    x={textX} y={textY} 
                    fill={isPrimary ? "var(--text-primary)" : "var(--text-muted)"} 
                    fontSize="3" 
                    fontWeight={isPrimary ? "bold" : "normal"}
                    textAnchor="middle" 
                    dominantBaseline="central"
                  >
                    {i}
                  </text>
                </g>
              );
            })}

            {/* Currently Dragging Slice Preview */}
            {isDragging && dragStartHour !== null && dragCurrentHour !== null && (() => {
              const start = dragStartHour;
              const end = dragCurrentHour;
              
              const rawDistance = Math.abs(start - end);
              let previewStart = start;
              let previewEnd = end;
              
              if (rawDistance > 12) {
                if (start > 12 && end < 12) {
                    previewStart = start;
                    previewEnd = 24; // Clip preview at midnight
                } else if (start < 12 && end > 12) {
                    previewStart = end;
                    previewEnd = 24; 
                }
              } else {
                previewStart = Math.min(start, end);
                previewEnd = Math.max(start, end);
              }

              return (
                <path 
                  d={createArcPath(previewStart, previewEnd, 48)} 
                  fill="rgba(59, 130, 246, 0.3)" // Preview blue
                />
              );
            })()}

            {/* Render Saved Schedules */}
            {schedules.map(block => (
              <g key={block.id}>
                <path 
                  d={createArcPath(block.startHour, block.endHour, 48)} 
                  fill={block.color} 
                  opacity="0.8"
                />
              </g>
            ))}
            
            {/* Center dot */}
            <circle cx="50" cy="50" r="3" fill="var(--primary-color)" />
          </svg>
        </div>
        
        {/* Simple list of what's inside the pie */}
        <div className="task-list">
          {schedules.length === 0 ? (
            <p className="no-tasks">Drag on the circle to create a schedule</p>
          ) : (
            schedules.map(block => (
              <div key={block.id} className="task-item">
                <span className="task-color-dot" style={{ background: block.color }}></span>
                <span className="task-time">
                  {Math.floor(block.startHour)}:{(block.startHour % 1 * 60).toString().padStart(2, '0')} - 
                  {Math.floor(block.endHour)}:{(block.endHour % 1 * 60).toString().padStart(2, '0')}
                </span>
                <input 
                  className="task-input" 
                  value={block.title} 
                  onChange={(e) => onUpdateSchedule({ ...block, title: e.target.value })} 
                  placeholder="Task Name"
                />
                <button 
                  className="delete-task-btn" 
                  onClick={() => onDeleteSchedule(block.id)} 
                  title="Delete Task"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default CircularTimetable;
