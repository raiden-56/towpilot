import { describe, expect, it } from 'vitest';
import { humanize, inr, inrCompact, paymentColor, statusColor, toPaise } from '@/lib/format';
import { ApiError } from '@/api/client';

describe('money formatting', () => {
  it('formats paise as Indian rupees with lakh grouping', () => {
    expect(inr(12345678)).toBe('₹1,23,456.78');
    expect(inr(0)).toBe('₹0.00');
    expect(inr(null)).toBe('—');
  });
  it('compacts large values for KPI tiles', () => {
    expect(inrCompact(150_00_000_00)).toBe('₹1.50Cr');
    expect(inrCompact(2_50_000_00)).toBe('₹2.50L');
    expect(inrCompact(-1_200_00)).toBe('-₹1.2K');
  });
  it('converts rupees to paise without float drift', () => {
    expect(toPaise(19.99)).toBe(1999);
    expect(toPaise(0.1 + 0.2)).toBe(30);
  });
});

describe('status helpers', () => {
  it('maps booking and payment statuses to semantic colours', () => {
    expect(statusColor('COMPLETED')).toBe('success');
    expect(statusColor('SAFETY_HOLD')).toBe('error');
    expect(statusColor('SEARCHING_FOR_PROVIDER')).toBe('warning');
    expect(paymentColor('PAID')).toBe('success');
    expect(paymentColor('PAYMENT_FAILED')).toBe('error');
  });
  it('humanizes enum values', () => {
    expect(humanize('REASSIGNMENT_REQUIRED')).toBe('Reassignment required');
  });
});

describe('ApiError', () => {
  it('exposes field-level validation errors', () => {
    const e = new ApiError(400, 'VALIDATION_ERROR', 'invalid', [{ path: 'pickup.lat', message: 'Required' }]);
    expect(e.fieldErrors).toEqual({ 'pickup.lat': 'Required' });
    expect(new ApiError(0, 'NETWORK', 'offline').isNetwork).toBe(true);
  });
});
