import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import './styles/globals.css'
import './index.css'
import ErrorBoundary from './components/ErrorBoundary'
// Intentionally defer importing App until after optional runtime env is loaded

// Optionally load runtime environment from /env.js if present, and block until it loads
async function loadRuntimeEnvIfPresent() {
  // Skip if server-side, dev mode, runtime already set, or build-time VITE_API_URL exists
  if (
    typeof window === 'undefined'
    || import.meta.env.DEV
    || window.__ENV__
    || (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL)
  ) return;
  await new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = '/env.js';
    script.async = false;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: 1,
      keepPreviousData: true,
    },
  },
})

// Defer app bootstrap until runtime env (if any) is loaded
loadRuntimeEnvIfPresent().then(async () => {
  const { default: App } = await import('./App.jsx');
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ErrorBoundary>
        {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </StrictMode>,
  )
});
