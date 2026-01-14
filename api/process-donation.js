/**
 * Vercel Serverless Function ליצירת Redirect לתשלום עם סאמיט
 * 
 * הוראות:
 * 1. העלה את התיקייה הזו ל-Vercel
 * 2. הגדר Environment Variables ב-Vercel Dashboard:
 *    - SUMIT_COMPANY_ID=38780934
 *    - SUMIT_API_KEY=lQNyQ1OJCQNLuQMzEKjtH1ItXiQHWh7GkMmkVEr8JQ3gm2nZZY
 * 3. עדכן את DonationPage.tsx להצביע ל-API שלך
 * 
 * API זה משתמש ב-beginredirect של סאמיט - יוצר URL לעמוד תשלום חיצוני
 */

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // טיפול ב-OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // רק POST מותר
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { fullName, email, amount, address, phone, returnUrl, cancelUrl } = req.body;

    // בדיקות תקינות
    if (!fullName || !email || !amount) {
      return res.status(400).json({
        success: false,
        error: 'חסרים פרטים נדרשים'
      });
    }

    if (amount < 10) {
      return res.status(400).json({
        success: false,
        error: 'סכום התרומה חייב להיות לפחות 10 ₪'
      });
    }

    // בניית URL חזרה (אם לא נשלח)
    const baseUrl = req.headers.origin || 'https://your-domain.com';
    const redirectUrl = returnUrl || `${baseUrl}/donation?success=true`;
    const cancelRedirectUrl = cancelUrl || `${baseUrl}/donation?cancel=true`;

    // קריאה ל-API של סאמיט - beginredirect
    const SUMIT_URL = 'https://api.sumit.co.il/billing';
    const credentials = {
      CompanyID: parseInt(process.env.SUMIT_COMPANY_ID),
      APIKey: process.env.SUMIT_API_KEY
    };

    const response = await fetch(`${SUMIT_URL}/payments/beginredirect/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        Credentials: credentials,
        Customer: {
          Name: fullName,
          EmailAddress: email,
          Phone: phone || null,
          Address: address || null
        },
        Items: [{
          Item: {
            Name: 'תרומה עבור עמותת חסדי המצילים'
          },
          Quantity: 1,
          UnitPrice: parseFloat(amount)
        }],
        VATIncluded: true,
        RedirectURL: redirectUrl,
        CancelRedirectURL: cancelRedirectUrl,
        DocumentType: 400, // קבלה על תרומה
        SendUpdateByEmailAddress: email,
        Language: 'he' // עברית
      })
    });

    // בדיקה אם ה-response הצליח
    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = 'שגיאה בעיבוד התשלום';
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.Message || errorData.UserErrorMessage || errorMessage;
      } catch {
        errorMessage = `שגיאת API סאמיט (${response.status}): ${errorText || 'לא ניתן להתחבר לסאמיט'}`;
      }
      return res.status(500).json({
        success: false,
        error: errorMessage
      });
    }

    const data = await response.json();

    // בדיקה אם ה-API הצליח
    if (data.Status === 'Success (0)' || data.Status === 0) {
      // data.Data אמור להכיל את ה-URL להעברה
      const redirectUrl = data.Data?.RedirectURL || data.Data;
      
      if (!redirectUrl) {
        return res.status(500).json({
          success: false,
          error: 'לא התקבל URL להעברה מסאמיט'
        });
      }

      return res.status(200).json({
        success: true,
        redirectUrl: redirectUrl,
        transactionId: data.Data?.TransactionId || null
      });
    } else {
      return res.status(500).json({
        success: false,
        error: data.UserErrorMessage || data.Message || 'שגיאה בעיבוד התשלום'
      });
    }
  } catch (error) {
    console.error('Donation processing error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'שגיאה בעיבוד התרומה'
    });
  }
}
