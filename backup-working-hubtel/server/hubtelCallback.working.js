// server/api/hubtelCallback.js

const { getTrustedSdk } = require('../api-util/sdk');
const { types } = require('sharetribe-flex-sdk');

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const b = req.body || {};

    // accept both names (because you changed formats during testing)
    const rawTxId =
      q.stTransactionId ||
      b.stTransactionId ||
      q.transactionId ||
      b.transactionId;

    const status = q.status || b.status;
    const checkoutId = q.checkoutId || b.checkoutId || q.checkoutid || b.checkoutid;

    console.log('HUBTEL CALLBACK HIT ✅', {
      method: req.method,
      transactionId: rawTxId,
      status,
      checkoutId,
      query: q,
      body: b,
    });

    if (!rawTxId || rawTxId === 'null') {
      return res.status(400).json({ error: 'Missing transactionId in callback' });
    }

    // Cancel -> no Sharetribe transition
    if (String(status || '').toLowerCase().includes('cancel')) {
      return res.status(200).json({ ok: true, message: 'Cancelled - no transition' });
    }

    // Typed UUID (this is the key fix)
    let txUuid;
    try {
      txUuid = new types.UUID(rawTxId);
    } catch (e) {
      return res.status(400).json({ error: 'transactionId is not a valid UUID', got: rawTxId });
    }

    const sdk = await getTrustedSdk(req, res);

    // Your process has :transition/confirm-payment
    const transition = 'transition/confirm-payment';

    const response = await sdk.transactions.transition(
      {
        id: txUuid,
        transition,
        params: {
          protectedData: {
            hubtel: {
              status: status || 'success',
              checkoutId: checkoutId || null,
              receivedAt: new Date().toISOString(),
            },
          },
        },
      },
      { expand: true }
    );

    console.log('✅ SHARETRIBE TRANSITION OK', {
      id: response?.data?.data?.id?.uuid,
      transition,
      state: response?.data?.data?.attributes?.state,
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    // show the real Sharetribe error
    const errData = e?.data || e?.response?.data;
    console.error('❌ HUBTEL CALLBACK ERROR', {
      message: e?.message,
      status: e?.status || e?.response?.status,
      data: errData,
    });
    return res.status(500).json({ error: 'Callback failed', details: String(e?.message || e) });
  }
};