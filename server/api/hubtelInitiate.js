// server/api/hubtelInitiate.js

const { hubtelTxMap } = require('./hubtelStore');
const { getTrustedSdk, getIntegrationSdk } = require('../api-util/sdk');

const baseUrlFromReq = req => {
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
};

// Hubtel clientReference must be max 32 chars.
const makeClientReference = listingId => {
  const shortListing = (listingId || '').replace(/-/g, '').slice(0, 8);
  const shortTime = String(Date.now()).slice(-11);
  return `odr_${shortListing}_${shortTime}`.slice(0, 32);
};

module.exports = async (req, res) => {
  try {
    const { listingId, totalAmount, description, lineItems, stockReservationQuantity } = req.body || {};

    const amountNum = Number.parseFloat(totalAmount);
    if (!listingId || !Number.isFinite(amountNum)) {
      return res.status(400).json({
        error: 'listingId and numeric totalAmount are required',
        got: { listingId, totalAmount, totalAmountType: typeof totalAmount },
      });
    }

    if (!Array.isArray(lineItems) || !lineItems.length) {
      return res.status(400).json({ error: 'lineItems are required and must be a non-empty array' });
    }

    if (!stockReservationQuantity) {
      return res.status(400).json({ error: 'stockReservationQuantity is required' });
    }

    const amount2dp = Number(amountNum.toFixed(2));

    const trustedSdk = await getTrustedSdk(req, res);
    const integrationSdk = getIntegrationSdk();

    const processAlias = 'default-purchase/release-1';
    const initTransition = 'transition/request-payment';
    const clientRef = makeClientReference(listingId);

    // 1) Fetch listing to get seller ID
    let sellerId;
    try {
      const listingRes = await integrationSdk.listings.show({
        id: listingId,
        include: ['author'],
      });

      const sellerRef = listingRes?.data?.data?.relationships?.author?.data;
      sellerId = sellerRef?.id;

      if (!sellerId) {
        return res.status(400).json({
          error: 'Could not determine seller from listing',
        });
      }
    } catch (e) {
      const status = e?.status || e?.response?.status;
      const data = e?.data || e?.response?.data;
      return res.status(502).json({
        error: 'Failed to fetch seller from listing',
        status,
        data,
        message: e?.message,
      });
    }

    // 2) Fetch seller private credentials through Integration API
    let seller;
    try {
      const sellerRes = await integrationSdk.users.show({
        id: sellerId,
      });

      seller = sellerRes?.data?.data;
    } catch (e) {
      const status = e?.status || e?.response?.status;
      const data = e?.data || e?.response?.data;
      return res.status(502).json({
        error: 'Failed to fetch seller user record',
        status,
        data,
        message: e?.message,
      });
    }

    const merchantAccountNumber =
      seller?.attributes?.privateData?.hubtelMerchantAccountNumber ||
      seller?.attributes?.profile?.publicData?.hubtelMerchantAccountNumber;

    const sellerHubtelAppId =
      seller?.attributes?.profile?.privateData?.hubtelAppId;

    const sellerHubtelAppKey =
      seller?.attributes?.profile?.privateData?.hubtelAppKey;

    if (!merchantAccountNumber) {
      return res.status(400).json({
        error: 'Seller does not have a Hubtel merchant account number',
      });
    }

    if (!sellerHubtelAppId || !sellerHubtelAppKey) {
      return res.status(400).json({
        error: 'Seller does not have Hubtel App ID and App Key configured',
      });
    }

    const hubtelBaseUrl = process.env.HUBTEL_BASE_URL || 'https://payproxyapi.hubtel.com';

    // 3) Create Sharetribe transaction FIRST
    let initiated;
    try {
      initiated = await trustedSdk.transactions.initiate(
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
                merchantAccountNumber,
                hubtelAppId: sellerHubtelAppId,
                sellerId: sellerId?.uuid || sellerId,
              },
            },
          },
        },
        { expand: true }
      );
    } catch (e) {
      const status = e?.status || e?.response?.status;
      const data = e?.data || e?.response?.data;
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

    // 4) Build Hubtel request using seller-specific credentials
    const basicAuth = Buffer.from(`${sellerHubtelAppId}:${sellerHubtelAppKey}`).toString('base64');
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Basic ${basicAuth}`,
      'Cache-Control': 'no-cache',
    };

    const baseUrl = baseUrlFromReq(req);

    const callbackUrl =
      process.env.HUBTEL_CALLBACK_URL ||
      `${baseUrl}/api/hubtel-callback?stTransactionId=${createdTxId}`;

    const returnUrl =
      process.env.HUBTEL_RETURN_URL || `${baseUrl}/hubtel-success?stTransactionId=${createdTxId}`;

    const cancellationUrl =
      process.env.HUBTEL_CANCELLATION_URL || `${baseUrl}/hubtel-cancel?stTransactionId=${createdTxId}`;

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

    return res.status(200).json({
      checkoutDirectUrl,
      stTransactionId: createdTxId,
      clientReference: clientRef,
      merchantAccountNumber,
      hubtel: data,
    });
  } catch (e) {
    console.error('hubtelInitiate crash:', e);
    return res.status(500).json({ error: 'Server error', details: String(e) });
  }
};