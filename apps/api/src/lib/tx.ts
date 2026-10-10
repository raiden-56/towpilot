import { prisma, type Tx } from './prisma.js';
import { logger } from './logger.js';

export type AfterCommit = (fn: () => void | Promise<void>) => void;

/**
 * Run `fn` in a database transaction. Side effects registered with `after` (socket emits,
 * notifications that should not fire on rollback) run only once the transaction has committed.
 */
export async function withTx<T>(fn: (tx: Tx, after: AfterCommit) => Promise<T>, opts: { timeout?: number } = {}): Promise<T> {
  const effects: (() => void | Promise<void>)[] = [];
  const result = await prisma.$transaction((tx) => fn(tx, (e) => effects.push(e)), { timeout: opts.timeout ?? 20_000, maxWait: 10_000 });
  for (const e of effects) {
    try {
      await e();
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'post-commit effect failed');
    }
  }
  return result;
}
