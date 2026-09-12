/** Liveness probe (`GET /health`); reachable even during maintenance mode. */
import { Hono } from 'hono';
import type { AppContext } from '../types';
import { appName } from '../lib/env';

export const healthRoutes = new Hono<AppContext>();

healthRoutes.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: appName(c.env),
    time: new Date().toISOString(),
  }),
);
