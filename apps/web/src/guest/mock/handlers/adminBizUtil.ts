/** Small helpers shared by the guest admin commercial handlers. */

/** Form amounts arrive in rupees (as in the API's rupeesToPaise); store paise. */
export const paise = (v: unknown) => Math.round((Number(v) || 0) * 100);
export const bool = (v: unknown) => v === true || v === 'true' || v === '1';
