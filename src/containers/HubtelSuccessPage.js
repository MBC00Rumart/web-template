import React, { useEffect } from 'react';
import Page from '../components/Page/Page';

export default function HubtelSuccessPage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stTransactionId = params.get('stTransactionId');
    const checkoutId = params.get('checkoutid') || params.get('checkoutId');

    // call backend to finalize
    fetch(`/api/hubtel-callback?stTransactionId=${encodeURIComponent(stTransactionId)}&status=success&checkoutId=${encodeURIComponent(checkoutId)}`)
      .then(r => r.json())
      .then(console.log)
      .catch(console.error);
  }, []);

  return (
    <Page title="Payment success">
      <div style={{ padding: 24 }}>
        <h1>Payment received ✅</h1>
        <p>You can close this page now.</p>
      </div>
    </Page>
  );
}