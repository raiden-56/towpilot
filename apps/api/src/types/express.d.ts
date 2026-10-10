import type { Principal } from '../middleware/auth.js';

declare global {
  namespace Express {
    interface Request {
      auth?: Principal;
    }
  }
}

export {};
