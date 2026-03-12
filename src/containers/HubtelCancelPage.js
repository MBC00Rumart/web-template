import React, { useEffect } from 'react';
import Page from '../components/Page/Page';

export default function HubtelCancelPage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stTransactionId = params.get('stTransactionId');

    if (!stTransactionId) {
      return;
    }

    fetch(
      `/api/hubtel-callback?stTransactionId=${encodeURIComponent(
        stTransactionId
      )}&status=cancelled`
    )
      .then(r => r.json().catch(() => ({})))
      .then(console.log)
      .catch(console.error);
  }, []);

  return (
    <Page title="Payment cancelled">
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '48px 24px' }}>
        <div
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: '16px',
            padding: '32px',
            background: '#fff',
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: '14px',
              color: '#6b7280',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            RuMart
          </p>

          <h1 style={{ marginTop: '12px', marginBottom: '12px', fontSize: '40px', lineHeight: 1.1 }}>
            Payment cancelled ❌
          </h1>

          <p style={{ fontSize: '18px', color: '#374151' }}>
            Your payment was not completed. You can return to the marketplace and try again.
          </p>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '28px' }}>
            <button
              type="button"
              onClick={() => {
                window.history.back();
              }}
              style={{
                padding: '12px 18px',
                borderRadius: '10px',
                background: '#111827',
                color: '#fff',
                border: 'none',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>

            <button
              type="button"
              onClick={() => {
                window.location.href = '/';
              }}
              style={{
                padding: '12px 18px',
                borderRadius: '10px',
                border: '1px solid #d1d5db',
                background: '#fff',
                color: '#111827',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Back to marketplace
            </button>
          </div>
        </div>
      </div>
    </Page>
  );
}