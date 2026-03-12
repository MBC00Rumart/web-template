import React, { useEffect, useState } from 'react';
import Page from '../components/Page/Page';

export default function HubtelSuccessPage() {
  const [status, setStatus] = useState('processing');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stTransactionId = params.get('stTransactionId');
    const checkoutId = params.get('checkoutid') || params.get('checkoutId');

    if (!stTransactionId) {
      setStatus('error');
      return;
    }

    const callbackKey = `hubtel-success-processed-${stTransactionId}`;
    const alreadyProcessed = window.sessionStorage.getItem(callbackKey);

    if (alreadyProcessed) {
      setStatus('success');
      return;
    }

    fetch(
      `/api/hubtel-callback?stTransactionId=${encodeURIComponent(
        stTransactionId
      )}&status=success&checkoutId=${encodeURIComponent(checkoutId || '')}`
    )
      .then(async r => {
        const data = await r.json().catch(() => ({}));

        if (r.ok || r.status === 409) {
          window.sessionStorage.setItem(callbackKey, 'true');
          setStatus('success');
        } else {
          console.error('Hubtel success callback failed:', data);
          setStatus('error');
        }
      })
      .catch(err => {
        console.error(err);
        setStatus('error');
      });
  }, []);

  return (
    <Page title="Payment received">
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
            Payment received ✅
          </h1>

          {status === 'processing' ? (
            <p style={{ fontSize: '18px', color: '#374151' }}>
              We are confirming your payment. Please wait a moment.
            </p>
          ) : status === 'success' ? (
            <p style={{ fontSize: '18px', color: '#374151' }}>
              Your payment has been confirmed successfully. You can now return to the marketplace.
            </p>
          ) : (
            <p style={{ fontSize: '18px', color: '#b91c1c' }}>
              Your payment may have gone through, but we could not confirm it on this page.
              Please check your orders or inbox.
            </p>
          )}

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '28px' }}>
            <button
              type="button"
              onClick={() => {
                window.location.href = '/';
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
              Back to marketplace
            </button>

            <button
              type="button"
              onClick={() => {
                window.location.href = '/inbox';
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
              View my inbox
            </button>
          </div>
        </div>
      </div>
    </Page>
  );
}