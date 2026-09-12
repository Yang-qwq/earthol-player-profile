/**
 * Worker entry point. `createApp` (src/app.tsx) builds the Hono app with all
 * routers and global middleware; this file only hands it to the runtime.
 */
import { createApp } from './app';

export default createApp();
