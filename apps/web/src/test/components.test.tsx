import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import type { ReactNode } from 'react';
import { buildTheme } from '@/theme';
import { QuoteBreakdown } from '@/components/QuoteBreakdown';
import { BookingTimeline } from '@/components/BookingTimeline';
import { StatusChip } from '@/components/common';
import type { Quote, StatusHistory } from '@/api/types';

const wrap = (ui: ReactNode) => render(<ThemeProvider theme={buildTheme('light')}>{ui}</ThemeProvider>);

const item = (o: Partial<Quote['items'][number]>) => ({ id: o.code ?? 'x', code: 'BASE', description: 'Base', quantity: 1, unitAmount: 0, amount: 0, taxable: true, isPassThrough: false, isEstimate: false, isAdditional: false, reason: null, ...o });

const quote: Quote = {
  id: 'q1',
  version: 1,
  kind: 'INITIAL',
  status: 'PENDING_CUSTOMER_APPROVAL',
  subtotal: 186000,
  discountTotal: 0,
  taxableValue: 186000,
  taxTotal: 33480,
  passThroughTotal: 0,
  total: 219480,
  expiresAt: new Date(Date.now() + 1800_000).toISOString(),
  reason: null,
  createdAt: new Date().toISOString(),
  items: [item({ code: 'BASE', description: 'Base service charge', amount: 150000 }), item({ code: 'TOW_KM', description: 'Towing distance beyond 10 km', amount: 36000, quantity: 12, unitAmount: 3000, isEstimate: true })],
};

describe('QuoteBreakdown', () => {
  it('labels estimated lines and shows the estimated total with GST', () => {
    wrap(<QuoteBreakdown quote={quote} />);
    expect(screen.getByText('Base service charge')).toBeInTheDocument();
    expect(screen.getByText('estimate')).toBeInTheDocument();
    expect(screen.getByText('Estimated total')).toBeInTheDocument();
    expect(screen.getByText('₹2,194.80')).toBeInTheDocument();
    expect(screen.getByText(/approve any additional chargeable work/i)).toBeInTheDocument();
  });

  it('highlights increases versus a previously approved quote', () => {
    const revised: Quote = { ...quote, id: 'q2', kind: 'REVISION', items: [...quote.items, item({ code: 'ADDL_1', description: 'Winch recovery from ditch', amount: 50000, isAdditional: true, reason: 'Vehicle stuck' })], total: 278480 };
    wrap(<QuoteBreakdown quote={revised} compareTo={quote} />);
    expect(screen.getByText('additional')).toBeInTheDocument();
    expect(screen.getByText(/Reason: Vehicle stuck/)).toBeInTheDocument();
    expect(screen.getByText(/Increase of ₹590.00/)).toBeInTheDocument();
  });
});

describe('BookingTimeline', () => {
  const h = (toStatus: StatusHistory['toStatus'], reason: string | null = null): StatusHistory => ({ id: toStatus + (reason ?? ''), fromStatus: null, toStatus, actorRole: 'SYSTEM', reason, isOverride: false, createdAt: new Date().toISOString() });

  it('marks only steps that actually happened and lists exceptions', () => {
    wrap(<BookingTimeline current="ACCEPTED" history={[h('REQUESTED'), h('CONFIRMED'), h('SEARCHING_FOR_PROVIDER'), h('ASSIGNED'), h('REJECTED', 'Driver declined'), h('ASSIGNED'), h('ACCEPTED')]} />);
    const list = screen.getByLabelText('Booking progress');
    expect(within(list).getByText('Driver accepted')).toBeInTheDocument();
    expect(within(list).getByText('Driver declined')).toBeInTheDocument();
    expect(within(list).queryByText('In transit')).toBeInTheDocument(); // future step shown greyed
  });

  it('hides loading/transit steps for on-site services', () => {
    wrap(<BookingTimeline current="EN_ROUTE" onsite history={[h('REQUESTED')]} />);
    expect(screen.queryByText('Loading vehicle')).not.toBeInTheDocument();
  });
});

describe('StatusChip', () => {
  it('renders a human label', () => {
    wrap(<StatusChip status="SEARCHING_FOR_PROVIDER" />);
    expect(screen.getByText('Finding provider')).toBeInTheDocument();
  });
});
