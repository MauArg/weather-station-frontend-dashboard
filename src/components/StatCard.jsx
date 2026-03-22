import React from 'react';

const StatCard = ({ title, value, unit, icon: Icon, color = "blue" }) => {
    // Using inline styles for dynamic colors to avoid Tailwind dependency if not fully set up,
    // but classNames for structure assuming standard CSS or Tailwind if available.
    // The user asked for "Nice UI" so I'll assume I will add global CSS for these classes later.
    return (
        <div className="stat-card">
            <div className="stat-header">
                <span className="stat-title">{title}</span>
                {Icon && <Icon size={20} color={color} />}
            </div>
            <div className="stat-value">
                {value} <span className="stat-unit">{unit}</span>
            </div>
        </div>
    );
};

export default StatCard;
