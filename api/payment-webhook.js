/**
 * Vercel Serverless Function - IPN Webhook מסאמיט
 * סאמיט קורא לכאן אוטומטית לאחר תשלום מוצלח.
 * ה-ExternalIdentifier שהוגדר ביצירת התשלום מכיל: "identityId:amount"
 * הפונקציה מעדכנת את בסיס הנתונים ישירות, ללא שהמשתמש צריך לחזור לאתר.
 */

export default async function handler(req, res) {
  // סאמיט שולח POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    console.log('=== Sumit IPN Received ===', JSON.stringify(body, null, 2));

    // סאמיט שולח את ה-ExternalIdentifier בתוך ה-payload
    // שדות אפשריים לפי תיעוד סאמיט:
    const externalId =
      body.ExternalIdentifier ||
      body.externalidentifier ||
      body.external_identifier ||
      body?.Data?.ExternalIdentifier ||
      null;

    if (!externalId) {
      console.warn('IPN received without ExternalIdentifier – skipping DB update');
      // עדיין מחזירים 200 כדי שסאמיט לא ינסה שוב
      return res.status(200).json({ success: true, skipped: true });
    }

    // פורמט: "identityId:amount"
    const [identityId, amountStr] = externalId.split(':');
    const amount = parseFloat(amountStr) || 100;

    if (!identityId) {
      console.warn('IPN: could not parse identityId from ExternalIdentifier:', externalId);
      return res.status(200).json({ success: true, skipped: true });
    }

    const DB_API_BASE   = 'https://arvut.org.il/new/backend/public';
    const DB_API_SECRET = 'arvut-api-secret-2024';

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    console.log(`IPN: updating payment for identityId=${identityId}, amount=${amount}`);

    const dbRes = await fetch(`${DB_API_BASE}/index.php?route=payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DB_API_SECRET}`,
      },
      body: JSON.stringify({
        identityID:    identityId,
        paymentAmount: amount,
        paymentDate:   today,
        status:        'פעיל',
      }),
    });

    const dbData = await dbRes.json();
    console.log('DB payment update response:', dbData);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('IPN webhook error:', err);
    // גם שגיאה מחזירה 200 – סאמיט לא ינסה שוב
    return res.status(200).json({ success: false, error: err.message });
  }
}
