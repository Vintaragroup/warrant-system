import axios from 'axios';
import pRetry from 'p-retry';
import { config, logger } from '@inmate/shared';

export async function whitepagesLookup({ phones, subject }: { phones: string[]; subject: any }) {
  if (!config.whitepagesApiKey) {
    logger.warn('Whitepages API key missing; using demo payload');
    return { data: phones.map((p) => ({ phone: p, reputation: 'medium' })) };
  }
  const url = 'https://proapi.whitepages.com/3.5/phone';
  return pRetry(
    async () => {
      const results = [] as any[];
      for (const p of phones) {
        const resp = await axios.get(url, { params: { api_key: config.whitepagesApiKey!, phone: p }, timeout: 8000 });
        results.push(resp.data);
      }
      return { data: results };
    },
    { retries: 1 }
  );
}
