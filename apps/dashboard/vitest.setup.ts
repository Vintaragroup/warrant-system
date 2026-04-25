import '@testing-library/jest-dom/vitest';
// Stub bullmq during tests to avoid requiring Redis/worker runtime
import { vi } from 'vitest';
vi.mock('bullmq', () => {
	class Queue {
		constructor(name: string, opts?: any) { /* no-op */ }
		async add() { return { id: 'mock' } }
		async close() { /* no-op */ }
	}
	class Worker {
		constructor(name: string, processor: any, opts?: any) { /* no-op */ }
		on() { return this }
		async close() { /* no-op */ }
	}
	return { Queue, Worker }
});

	// Also stub ioredis to prevent network calls / module load during tests
	vi.mock('ioredis', () => {
		class MockRedis {
			constructor(url?: string, opts?: any) {}
			on() { return this }
			quit() { return Promise.resolve() }
		}
		return { default: MockRedis };
	});

		// Stub twilio client factory
		vi.mock('twilio', () => {
			function createTwilio() {
				return {
					messages: {
						create: async () => ({ sid: 'SM_mock' })
					},
				};
			}
			return { default: createTwilio };
		});
