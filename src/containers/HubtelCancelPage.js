import React from 'react';
import Page from '../components/Page/Page';

export default function HubtelCancelPage() {
  return (
    <Page title="Payment cancelled">
      <div style={{ padding: 24 }}>
        <h1>Payment cancelled ❌</h1>
        <p>You can go back and try again.</p>
      </div>
    </Page>
  );
}