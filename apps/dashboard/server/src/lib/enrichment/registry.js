import whitepagesProvider from './providers/whitepages.js';
import piplProvider from './providers/pipl.js';

const BUILT_IN_PROVIDERS = [whitepagesProvider, piplProvider];

function resolveEnabledProviders() {
  const configured = (process.env.ENRICHMENT_PROVIDERS || process.env.ENRICHMENT_PROVIDER || 'whitepages')
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);

  const enabledIds = configured.length ? configured : BUILT_IN_PROVIDERS.map((provider) => provider.id);

  const providersById = new Map();
  BUILT_IN_PROVIDERS.forEach((provider) => {
    providersById.set(provider.id, provider);
  });

  const enabledProviders = [];
  enabledIds.forEach((id) => {
    const provider = providersById.get(id);
    if (provider) {
      enabledProviders.push(provider);
    }
  });

  return {
    enabledProviders,
    providersById,
  };
}

const { enabledProviders, providersById } = resolveEnabledProviders();

export function listProviders() {
  return enabledProviders.slice();
}

export function getProvider(id) {
  if (!id) return null;
  return providersById.get(id);
}

export function getDefaultProviderId() {
  return enabledProviders[0]?.id || null;
}

export function getDefaultProvider() {
  return enabledProviders[0] || null;
}
