import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PaymentForm } from '../PaymentForm';

const pushToast = vi.fn();
const mutateAsync = vi.fn();

vi.mock('../../ToastContext', () => ({
  useToast: () => ({ pushToast }),
}));

vi.mock('../../../hooks/payments', () => ({
  usePaymentMethods: () => ({ data: { methods: [] }, isLoading: false }),
  useCreatePayment: () => ({ mutateAsync, isLoading: false }),
}));

vi.mock('../../../lib/stripeClient', () => ({
  hasStripeKey: true,
}));

vi.mock('@stripe/react-stripe-js', () => ({
  useStripe: () => null,
  useElements: () => ({ getElement: () => null }),
  CardElement: () => <div data-testid="card-element" />,
}));

describe('PaymentForm', () => {
  beforeEach(() => {
    pushToast.mockClear();
    mutateAsync.mockClear();
  });

  it('keeps submit disabled when Stripe email is missing', () => {
    render(
      <MemoryRouter initialEntries={["/payments/new"]}>
        <PaymentForm onNavigate={vi.fn()} />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText(/Client Name/i), { target: { value: 'Ryan Morrow' } });
    fireEvent.change(screen.getByLabelText(/Payment Amount/i, { selector: 'input' }), { target: { value: '42.00' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /I acknowledge that this payment/i }));

    expect(screen.getByRole('button', { name: /Process Payment/i })).toBeDisabled();
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });
});
