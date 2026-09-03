/**
 * Vercel Serverless Function - IPN Webhook מסאמיט
 *
 * סאמיט קורא לכאן ישירות (server-to-server) מיד לאחר תשלום מוצלח -
 * ללא תלות בדפדפן של המשתמש. ה-URL מוגדר ב-IPNURL ב-process-donation.js
 * וכולל query params קבועים: id (זהות), amt (סכום), sp (1=בן/בת זוג).
 *
 * הגנת כפילות: לפני קריאה ל-addPayment, מנסים לתפוס מנעול אטומי (UNIQUE KEY)
 * ב-DB. אם הדפדפן כבר טיפל באותו תשלום (או להפך), אחד הצדדים ידלג.
 * Fail-open: אם בדיקת המנעול נכשלת, ממשיכים בכל זאת ל-addPayment כדי
 * לא לפספס תשלום אמיתי בגלל תקלה במנגנון ההגנה.
 */

const DB_API_BASE = process.env.DB_API_BASE || 'https://arvut.org.il/backend/public';
const DB_API_SECRET = process.env.DB_API_SECRET || 'arvut-api-secret-2024';
const SALESFORCE_API_BASE = 'https://uh-rescuers-ea539e69b913.herokuapp.com/extapi/website';
const SALESFORCE_TOKEN = process.env.SALESFORCE_TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbiI6IlUyRnNkR1ZrWDE5QkkwQVY0VmErS203UmExRGVrOHlzeFBRbFV2SmNjM2ZMU0U4amZGSEt2TmI1WDRmKzRwZklOK1BBTkJXcEJmTkNUKy8vUFVDRk55UVhrbHRWRmdOaGlLVHFyY2FoeXRrPSIsImlhdCI6MTc2ODM4MDQ0MCwiZXhwIjoxNzk5NDg0NDQwfQ.LVmuKHLx2Xp4b8OA4HYqYi01ydEsrd4jC6BW61hRi_U';

/**
 * ניסיון לתפוס מנעול אטומי ב-DB.
 * true = תפסנו בבירור, או שהתגובה עמומה/שגויה (fail-open - לא לפספס תשלום אמיתי).
 * false = מישהו אחר כבר תפס את המנעול בבירור (כפילות מאושרת).
 * apiSecret נשלח גם בגוף הבקשה (לא רק ב-header) - עוקף בעיות של שרתים
 * שלא מעבירים את כותרת ה-Authorization דרך mod_rewrite/PHP-FPM.
 */
async function tryAcquireLock(lockKey) {
  try {
    const r = await fetch(`${DB_API_BASE}/index.php?route=payment-lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DB_API_SECRET}` },
      body: JSON.stringify({ lockKey, apiSecret: DB_API_SECRET })
    });
    const j = await r.json().catch(() => ({}));
    console.log('payment-webhook: lock-check response:', r.status, JSON.stringify(j));

    if (r.ok && j.success === true && j.acquired === true) return true;
    if (r.ok && j.success === true && j.acquired === false) return false;

    // תגובה עמומה (401/404/500/JSON לא צפוי) - חשוב לראות את זה בבירור בלוגים
    console.error('payment-webhook: lock-check AMBIGUOUS response, proceeding anyway (fail-open):', r.status, JSON.stringify(j));
    return true;
  } catch (e) {
    console.error('payment-webhook: lock-check NETWORK error, proceeding anyway (fail-open):', e.message);
    return true;
  }
}

function getCurrentDateFormatted() {
  const today = new Date();
  const day = String(today.getDate()).padStart(2, '0');
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const year = today.getFullYear();
  return `${day}/${month}/${year}`;
}

/** ת.ז 9 ספרות → פורמט עם מקף (כמו ב-RegistrationFlow.tsx), אחרת מחזיר כמות שהוא */
function formatIdNumber(id) {
  const digits = String(id || '').replace(/\D/g, '');
  if (digits.length === 9) {
    return `${digits.slice(0, 8)}-${digits.slice(8)}`;
  }
  return String(id || '').trim();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    // סאמיט עשוי לשלוח GET או POST ל-IPN - קוראים משני המקורות
    const params = { ...(req.query || {}), ...(req.body || {}) };
    const rawId = params.id;
    const amount = parseFloat(params.amt);
    const onSpouse = params.sp === '1' || params.sp === 1;

    console.log('=== Sumit IPN Received ===', { rawId, amount, onSpouse, method: req.method });

    if (!rawId || !amount) {
      console.warn('IPN: missing id/amt params - skipping');
      // מחזירים 200 תמיד כדי שסאמיט לא ינסה שוב שוב (retry storm)
      return res.status(200).json({ success: true, skipped: true, reason: 'missing_params' });
    }

    const paymentDate = getCurrentDateFormatted();
    const formattedIdNumber = formatIdNumber(rawId);
    const digitsOnly = String(rawId).replace(/\D/g, '');

    // מנעול ייחודי - עדיפות ל-pid (מזהה ייחודי לניסיון תשלום ספציפי, מגיע
    // מ-process-donation.js ומועבר גם בקריאת addPayment מהדפדפן). אם pid לא
    // קיים (תאימות לאחור), נופלים חזרה למפתח המבוסס על זהות+תאריך+סכום+סוג.
    const rawPid = params.pid ? String(params.pid).trim() : '';
    const lockKey = rawPid || `${digitsOnly || rawId}_${paymentDate}_${amount}_${onSpouse ? 'spouse' : 'member'}`;
    const acquired = await tryAcquireLock(lockKey);

    if (!acquired) {
      console.log('IPN: payment already processed elsewhere (lock held) - skipping addPayment:', lockKey);
      return res.status(200).json({ success: true, skipped: true, reason: 'duplicate' });
    }

    // הוספת התשלום ישירות ל-Salesforce
    const paymentData = {
      identityID: formattedIdNumber,
      Amount: String(amount),
      PaymentDate: paymentDate,
      Status: 'שולם',
      ...(onSpouse ? { onSpouse: true } : {})
    };

    const sfRes = await fetch(`${SALESFORCE_API_BASE}/addPayment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SALESFORCE_TOKEN}` },
      body: JSON.stringify(paymentData)
    });

    const sfText = await sfRes.text();
    let sfData;
    try { sfData = JSON.parse(sfText); } catch { sfData = sfText; }

    console.log('IPN: Salesforce addPayment response:', sfRes.status, sfData);

    // עדכון DB מקומי - best effort, לא חוסם את תגובת ה-IPN
    try {
      await fetch(`${DB_API_BASE}/index.php?route=payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DB_API_SECRET}` },
        body: JSON.stringify({
          identityID: digitsOnly || rawId,
          paymentAmount: amount,
          paymentDate,
          status: 'פעיל'
        })
      });
    } catch (dbErr) {
      console.warn('IPN: local DB update failed (non-critical):', dbErr.message);
    }

    return res.status(200).json({ success: true, salesforce: sfRes.ok });
  } catch (err) {
    console.error('IPN webhook error:', err);
    // תמיד מחזירים 200 כדי שסאמיט לא ינסה שוב שוב ושוב
    return res.status(200).json({ success: false, error: err.message });
  }
}
