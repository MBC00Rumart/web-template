// server/api/hubtelStatus.js

const { getIntegrationSdk } = require('../api-util/sdk');

module.exports = async (req, res) => {
  try {
    const { clientReference, transactionId } = req.query;

    if (!clientReference) {
      return res.status(400).json({
        error: 'Missing clientReference query parameter',
      });
    }

    if (!transactionId) {
      return res.status(400).json({
        error: 'Missing transactionId query parameter',
      });
    }

    const statusBaseUrl =
      process.env.HUBTEL_STATUS_BASE_URL || 'https://rmsc.hubtel.com';

    const integrationSdk = getIntegrationSdk();

    // 1) Fetch transaction from Sharetribe
    let tx;
    try {
      const txRes = await integrationSdk.transactions.show({
        id: transactionId,
      });

      tx = txRes?.data?.data;
    } catch (e) {
      const status = e?.status || e?.response?.status;
      const data = e?.data || e?.response?.data;

      return res.status(502).json({
        error: 'Failed to fetch Sharetribe transaction',
        status,
        data,
        message: e?.message,
      });
    }

    const merchantId =
      tx?.attributes?.protectedData?.hubtel?.merchantAccountNumber;

    const sellerId =
      tx?.attributes?.protectedData?.hubtel?.sellerId;

    if (!merchantId) {
      return res.status(400).json({
        error: 'Missing merchant account number in transaction protectedData.hubtel',
      });
    }

    if (!sellerId) {
      return res.status(400).json({
        error: 'Missing sellerId in transaction protectedData.hubtel',
      });
    }

    // 2) Fetch seller private Hubtel credentials
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

    const sellerHubtelAppId =
      seller?.attributes?.profile?.privateData?.hubtelAppId;

    const sellerHubtelAppKey =
      seller?.attributes?.profile?.privateData?.hubtelAppKey;

    if (!sellerHubtelAppId || !sellerHubtelAppKey) {
      return res.status(400).json({
        error: 'Seller does not have Hubtel App ID and App Key configured',
      });
    }

    // 3) Call Hubtel status endpoint using seller-specific credentials
    const auth = Buffer.from(`${sellerHubtelAppId}:${sellerHubtelAppKey}`).toString('base64');

    const url =
      `${statusBaseUrl}/v1/merchantaccount/merchants/${merchantId}` +
      `/transactions/status?clientReference=${encodeURIComponent(clientReference)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
    });

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      data = { raw: rawText };
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Hubtel status check failed',
        hubtelHttpStatus: response.status,
        hubtelResponse: data,
        merchantId,
        sellerId,
      });
    }

    return res.status(200).json({
      merchantId,
      sellerId,
      clientReference,
      hubtelResponse: data,
    });
  } catch (error) {
    console.error('HUBTEL STATUS CRASH:', error);
    return res.status(500).json({
      error: 'Server error',
      details: error.message,
    });
  }
};