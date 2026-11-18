import { defineConfig } from 'vitest/config';
// Отдельный конфиг для ML-задач (экспорт метаданных и сравнение с эвристикой) — не входит в `npm test`.
export default defineConfig({ test: { include: ['ml/**/*.task.ts'], environment: 'node', setupFiles: ['./tests/setup.ts'], testTimeout: 600_000 } });
