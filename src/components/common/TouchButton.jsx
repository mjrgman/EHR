import React from 'react';

const VARIANTS = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
  success: 'bg-green-600 text-white hover:bg-green-700 focus:ring-green-500',
  danger: 'bg-red-100 text-red-700 hover:bg-red-200 focus:ring-red-500',
  warning: 'bg-amber-100 text-amber-800 hover:bg-amber-200 focus:ring-amber-500',
  secondary: 'bg-gray-100 text-gray-700 hover:bg-gray-200 focus:ring-gray-400',
  ghost: 'bg-transparent text-gray-600 hover:bg-gray-100 focus:ring-gray-400',
};

const SIZES = {
  sm: 'min-h-[36px] px-3 py-1.5 text-sm rounded-lg',
  md: 'min-h-[48px] px-4 py-3 rounded-xl',
  lg: 'min-h-[56px] px-6 py-4 text-lg rounded-xl',
};

export default function TouchButton({
  children, variant = 'primary', size = 'md',
  icon, disabled, loading, className = '', ...props
}) {
  return (
    <button
      disabled={disabled || loading}
      className={`
        inline-flex items-center justify-center gap-2 font-semibold
        transition-all duration-150 active:scale-95 select-none
        focus:outline-none focus:ring-2 focus:ring-offset-2
        disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100
        ${VARIANTS[variant]} ${SIZES[size]} ${className}
      `}
      {...props}
    >
      {loading ? (
        <span className="animate-spin inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
      ) : icon ? (
        <span className="text-lg">{icon}</span>
      ) : null}
      {children}
    </button>
  );
}
