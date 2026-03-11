// server/api/hubtelInitiate.js

const { hubtelTxMap } = require('./hubtelStore');
const { getTrustedSdk } = require('../api-util/sdk');

const baseUrlFromReq = req => {
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
};

// Hubtel clientReference must be max 32 chars.
const makeClientReference = listingId => {
  const shortListing = (listingId || '').replace(/-/g, '').slice(0, 8);
  const shortTime = String(Date.now()).slice(-11); // last 11 digits
  return `odr_${shortListing}_${shortTime}`.slice(0, 32);
};

module.exports = async (req, res) => {
  try {
    const { listingId, totalAmount, description, lineItems, stockReservationQuantity } = req.body || {};

    // Validate
    const amountNum = Number.parseFloat(totalAmount);
    if (!listingId || !Number.isFinite(amountNum)) {
      return res.status(400).json({
        error: 'listingId and numeric totalAmount are required',
        got: { listingId, totalAmount, totalAmountType: typeof totalAmount },
      });
    }

    // Validate lineItems and stockReservationQuantity
    if (!Array.isArray(lineItems) || !lineItems.length) {
      return res.status(400).json({ error: 'lineItems are required and must be a non-empty array' });
    }
    if (!stockReservationQuantity) {
      return res.status(400).json({ error: 'stockReservationQuantity is required' });
    }

    // Hubtel wants 2 decimals
    const amount2dp = Number(amountNum.toFixed(2));

    // Sharetribe (trusted) SDK
    const sdk = await getTrustedSdk(req, res);

    // IMPORTANT:
    // This must be the alias your Console listing types use.
    // You already updated default-purchase/release-1 to version 4.
    const processAlias = 'default-purchase/release-1';

    // This must exist in your process.edn for default-purchase (v4).
    // It can be privileged; trusted SDK can initiate it.
    const initTransition = 'transition/request-payment';

    // We store Hubtel metadata in protectedData so we can read it later.
    const clientRef = makeClientReference(listingId);

    // 1) Create Sharetribe transaction FIRST
    let initiated;
    try {
      initiated = await sdk.transactions.initiate(
        {
          processAlias,
          transition: initTransition,
          params: {
            listingId,
            lineItems,
            stockReservationQuantity,
            protectedData: {
              hubtel: {
                status: 'initiated',
                clientReference: clientRef,
                initiatedAt: new Date().toISOString(),
                amount: amount2dp,
              },
            },
          },
        },
        { expand: true }
      );
    } catch (e) {
      // If this fails, Hubtel should not be called.
      // Usually means your process still has Stripe actions, or transition name/alias mismatch.
      const status = e?.status || e?.response?.status;
      const data = e?.data || e?.response?.data;
      console.error('❌ Sharetribe initiate failed:', { status, data, message: e?.message });
      return res.status(502).json({
        error: 'Sharetribe transaction initiate failed',
        status,
        data,
        message: e?.message,
      });
    }

    const createdTxId = initiated?.data?.data?.id?.uuid;
    if (!createdTxId) {
      return res.status(500).json({ error: 'Failed to create Sharetribe transaction (missing id)' });
    }

    // 2) Read Hubtel env vars
    const hubtelAppId = process.env.HUBTEL_APP_ID;
    const hubtelAppKey = process.env.HUBTEL_APP_KEY;
    const hubtelBaseUrl = process.env.HUBTEL_BASE_URL || 'https://payproxyapi.hubtel.com';
    const merchantAccountNumber = process.env.HUBTEL_MERCHANT_ACCOUNT_NUMBER;

    if (!hubtelAppId || !hubtelAppKey || !merchantAccountNumber) {
      return res.status(500).json({
        error:
          'Missing HUBTEL env vars (HUBTEL_APP_ID, HUBTEL_APP_KEY, HUBTEL_MERCHANT_ACCOUNT_NUMBER)',
      });
    }

    // 3) Build Hubtel request
    const basicAuth = Buffer.from(`${hubtelAppId}:${hubtelAppKey}`).toString('base64');
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Basic ${basicAuth}`,
      'Cache-Control': 'no-cache',
    };

    const baseUrl = baseUrlFromReq(req);

    // Use a single parameter name consistently everywhere:
    // stTransactionId = Sharetribe transaction UUID
    const callbackUrl =
      process.env.HUBTEL_CALLBACK_URL ||
      `${baseUrl}/api/hubtel-callback?stTransactionId=${createdTxId}`;

    const returnUrl =
      process.env.HUBTEL_RETURN_URL || `${baseUrl}/hubtel-success?stTransactionId=${createdTxId}`;

    const cancellationUrl =
      process.env.HUBTEL_CANCELLATION_URL || `${baseUrl}/hubtel-cancel?stTransactionId=${createdTxId}`;

    // Keep mapping (useful for debugging)
    hubtelTxMap.set(clientRef, createdTxId);
    console.log(`Stored mapping: ${clientRef} -> ${createdTxId}`);

    const payload = {
      totalAmount: amount2dp,
      description: description || 'RuMart order',
      callbackUrl,
      returnUrl,
      cancellationUrl,
      merchantAccountNumber,
      clientReference: clientRef,
    };

    console.log('HUBTEL INITIATE payload:', payload);

    const hubtelRes = await fetch(`${hubtelBaseUrl}/items/initiate`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const data = await hubtelRes.json().catch(() => null);

    if (!hubtelRes.ok) {
      console.log('❌ HUBTEL ERROR status:', hubtelRes.status, data);
      return res.status(502).json({
        error: 'Hubtel initiate failed',
        hubtelStatus: hubtelRes.status,
        hubtelResponse: data,
      });
    }

    // 4) Extract checkout url from common Hubtel shapes
    const checkoutDirectUrl =
      data?.data?.checkoutDirectUrl ||
      data?.data?.checkoutUrl ||
      data?.checkoutDirectUrl ||
      data?.checkoutUrl;

    if (!checkoutDirectUrl) {
      return res.status(502).json({
        error: 'Hubtel did not return a checkout URL',
        hubtelResponse: data,
      });
    }

    // Return what frontend needs
    return res.status(200).json({
      checkoutDirectUrl,
      // helpful for debugging / later reconciliation:
      stTransactionId: createdTxId,
      clientReference: clientRef,
      hubtel: data,
    });
  } catch (e) {
    console.error('hubtelInitiate crash:', e);
    return res.status(500).json({ error: 'Server error', details: String(e) });
  }
};