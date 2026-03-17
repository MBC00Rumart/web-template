// server/api/hubtelCallback.js

const { getTrustedSdk } = require('../api-util/sdk');
const { types } = require('sharetribe-flex-sdk');

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const b = req.body || {};

    const bodyStatus = b.status || b.Status || b?.Data?.Status;
    const bodyCheckoutId =
      b.checkoutId || b.checkoutid || b?.Data?.CheckoutId || b?.Data?.checkoutId;

    const rawTxId =
      q.stTransactionId ||
      b.stTransactionId ||
      q.transactionId ||
      b.transactionId;

    const status = q.status || bodyStatus;
    const checkoutId = q.checkoutId || q.checkoutid || bodyCheckoutId;

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

    const normalizedStatus = String(status || '').toLowerCase();

    // Cancel / cancelled / canceled -> no Sharetribe transition
    if (
      normalizedStatus.includes('cancel') ||
      normalizedStatus === 'cancelled' ||
      normalizedStatus === 'canceled'
    ) {
      return res.status(200).json({ ok: true, message: 'Cancelled - no transition' });
    }

    const looksSuccessful =
      normalizedStatus === 'success' ||
      b?.ResponseCode === '0000' ||
      String(b?.Status || '').toLowerCase() === 'success' ||
      String(b?.Data?.Status || '').toLowerCase() === 'success';

    if (!looksSuccessful) {
      return res.status(400).json({
        error: 'Callback did not indicate success or cancellation',
        got: {
          status,
          responseCode: b?.ResponseCode,
          bodyStatus: b?.Status,
          nestedStatus: b?.Data?.Status,
        },
      });
    }

    // IMPORTANT:
    // Hubtel POST callback comes from Hubtel server, not the buyer's browser,
    // so there is no user cookie available for getTrustedSdk(req).
    // We acknowledge the POST successfully and let the browser success return
    // complete the Sharetribe confirm-payment transition.
    if (req.method === 'POST') {
      console.log('ℹ️ HUBTEL POST CALLBACK ACCEPTED (no transition on server-to-server callback)', {
        transactionId: rawTxId,
        checkoutId,
      });

      return res.status(200).json({
        ok: true,
        message: 'POST callback accepted',
      });
    }

    let txUuid;
    try {
      txUuid = new types.UUID(rawTxId);
    } catch (e) {
      return res.status(400).json({ error: 'transactionId is not a valid UUID', got: rawTxId });
    }

    const sdk = await getTrustedSdk(req);
    const transition = 'transition/confirm-payment';

    try {
      const response = await sdk.transactions.transition(
        {
          id: txUuid,
          transition,
          params: {
            protectedData: {
              hubtel: {
                status: status || 'success',
                checkoutId: checkoutId || null,
                responseCode: b?.ResponseCode || null,
                salesInvoiceId: b?.Data?.SalesInvoiceId || null,
                clientReference: b?.Data?.ClientReference || null,
                amount: b?.Data?.Amount || null,
                receivedAt: new Date().toISOString(),
                callbackMethod: req.method,
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
      const errStatus = e?.status || e?.response?.status;

      if (errStatus === 409) {
        console.log('ℹ️ DUPLICATE CALLBACK / ALREADY CONFIRMED', {
          transactionId: rawTxId,
          transition,
        });
        return res.status(200).json({ ok: true, message: 'Already confirmed' });
      }

      throw e;
    }
  } catch (e) {
    const errData = e?.data || e?.response?.data;
    console.error('❌ HUBTEL CALLBACK ERROR', {
      message: e?.message,
      status: e?.status || e?.response?.status,
      data: errData,
    });
    return res.status(500).json({ error: 'Callback failed', details: String(e?.message || e) });
  }
};