import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { EncounterProvider } from './context/EncounterContext';
import { ToastProvider } from './components/common/Toast';
import AppShell from './components/layout/AppShell';
import DashboardPage from './pages/DashboardPage';
import CheckInPage from './pages/CheckInPage';
import MAPage from './pages/MAPage';
import EncounterPage from './pages/EncounterPage';
import ReviewPage from './pages/ReviewPage';
import CheckOutPage from './pages/CheckOutPage';
import PatientPage from './pages/PatientPage';
import AuditPage from './pages/AuditPage';
import SchedulePage from './pages/SchedulePage';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, errorInfo) {
    // Don't log error details (may contain PHI)
    console.error('[ErrorBoundary] Component error caught');
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-screen bg-gray-50">
          <div className="text-center p-8">
            <h1 className="text-2xl font-bold text-gray-800 mb-4">Something went wrong</h1>
            <p className="text-gray-600 mb-6">The application encountered an error. Your work has been auto-saved.</p>
            <button
              onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <EncounterProvider>
          <ErrorBoundary>
          <AppShell>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/patient/:patientId" element={<PatientPage />} />
              <Route path="/checkin/:encounterId" element={<CheckInPage />} />
              <Route path="/ma/:encounterId" element={<MAPage />} />
              <Route path="/encounter/:encounterId" element={<EncounterPage />} />
              <Route path="/review/:encounterId" element={<ReviewPage />} />
              <Route path="/checkout/:encounterId" element={<CheckOutPage />} />
              <Route path="/audit" element={<AuditPage />} />
              <Route path="/schedule" element={<SchedulePage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AppShell>
          </ErrorBoundary>
        </EncounterProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
