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
    const { fullName, email, amount, address, phone, returnUrl, cancelUrl, identityID } = req.body;

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
    
    // בדיקה שה-Environment Variables קיימים
    if (!process.env.SUMIT_COMPANY_ID || !process.env.SUMIT_API_KEY) {
      console.error('Missing environment variables:', {
        hasCompanyID: !!process.env.SUMIT_COMPANY_ID,
        hasAPIKey: !!process.env.SUMIT_API_KEY
      });
      return res.status(500).json({
        success: false,
        error: 'שגיאת תצורה: חסרים פרטי API'
      });
    }
    
    const credentials = {
      CompanyID: parseInt(process.env.SUMIT_COMPANY_ID, 10),
      APIKey: process.env.SUMIT_API_KEY
    };
    
    // בדיקה שה-CompanyID הוא מספר תקין
    if (isNaN(credentials.CompanyID)) {
      console.error('Invalid CompanyID:', process.env.SUMIT_COMPANY_ID);
      return res.status(500).json({
        success: false,
        error: 'שגיאת תצורה: CompanyID לא תקין'
      });
    }

    // נרמול מספר זהות לפני שליחה לסאמיט:
    // ת.ז ישראלית = 9 ספרות בלבד → מנקים מקפים/רווחים ושולחים 9 ספרות
    // דרכון / מספר זר = עלול להכיל אותיות → שולחים כמות שהוא (trim + uppercase)
    const rawID = identityID ? String(identityID).trim() : null;
    const digitsOnly = rawID ? rawID.replace(/\D/g, '') : '';
    const isIsraeliID = digitsOnly.length === 9;  // ת.ז = בדיוק 9 ספרות
    // padStart: מבטיח שאפס מוביל יישמר (036304327 ולא 36304327)
    const cleanIdentityID = rawID
      ? (isIsraeliID ? digitsOnly.padStart(9, '0') : rawID.toUpperCase())
      : null;

    // בניית הבקשה לפי הפורמט המדויק של סאמיט (לפי התיעוד)
    // חשוב: בדיוק כמו הדוגמה - כל השדות באותו סדר, null במקומות המתאימים
    const requestBody = {
      Customer: {
        // ExternalIdentifier נשמר כ-string ושומר אפס מוביל ("036304327")
        ExternalIdentifier: cleanIdentityID || null,
        NoVAT: null,
        SearchMode: cleanIdentityID ? 1 : 0,
        Name: fullName,
        Phone: phone || null,
        EmailAddress: email || null,
        City: null,
        Address: address || null,
        ZipCode: null,
        CompanyNumber: null,
        // ID=null: סאמיט ממיר ID למספר ומוחק אפס מוביל → משתמשים ב-ExternalIdentifier בלבד
        ID: null,
        Folder: null,
        Properties: null
      },
      Items: [{
        Item: {
          ID: null,
          Name: 'תרומה עבור עמותת משפחה מאוחדת',
          Description: null,
          Price: null,
          Currency: null,
          Cost: null,
          ExternalIdentifier: null,
          SKU: null,
          SearchMode: null,
          Properties: null
        },
        Quantity: 1,
        UnitPrice: parseFloat(amount),
        Total: null,
        Currency: null,
        Description: null
      }],
      VATIncluded: true,
      VATRate: null,
      DocumentType: null,
      RedirectURL: redirectUrl,
      CancelRedirectURL: cancelRedirectUrl,
      ExternalIdentifier: null,
      MaximumPayments: null,
      MinimumPaymentsCredit: null,
      SendUpdateByEmailAddress: email || null,
      ExpirationHours: null,
      Theme: null,
      Language: null,
      Header: null,
      UpdateOrganizationOnSuccess: null,
      UpdateOrganizationOnFailure: null,
      UpdateCustomerOnSuccess: null,
      DocumentDescription: null,
      DraftDocument: null,
      AutomaticallyRedirectToProviderPaymentPage: null,
      IPNURL: null,
      PreventSavingPaymentMethod: null,
      MerchantNumber: null,
      ResponseLanguage: null,
      Credentials: credentials
    };

    // URL עם סלאש בסוף (כמו בתיעוד)
    const sumitApiUrl = `${SUMIT_URL}/payments/beginredirect/`;

    // לוגים לבדיקה
    console.log('=== SUMIT API Request ===');
    console.log('URL:', sumitApiUrl);
    console.log('Request Body:', JSON.stringify(requestBody, null, 2));
    console.log('Request Body (compact):', JSON.stringify(requestBody));
    console.log('CompanyID:', credentials.CompanyID, '(type:', typeof credentials.CompanyID, ')');
    console.log('APIKey exists:', !!credentials.APIKey, '(length:', credentials.APIKey?.length, ')');
    
    const response = await fetch(sumitApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    console.log('=== SUMIT API Response ===');
    console.log('Status:', response.status);
    console.log('Status Text:', response.statusText);

    // בדיקה אם ה-response הצליח
    if (!response.ok) {
      const errorText = await response.text();
      console.log('Error Response:', errorText);
      
      let errorMessage = 'שגיאה בעיבוד התשלום';
      try {
        const errorData = JSON.parse(errorText);
        console.log('Parsed Error Data:', errorData);
        errorMessage = errorData.Message || errorData.UserErrorMessage || errorData.error || errorMessage;
      } catch (e) {
        console.log('Failed to parse error response:', e);
        errorMessage = `שגיאת API סאמיט (${response.status}): ${errorText || 'לא ניתן להתחבר לסאמיט'}`;
      }
      return res.status(500).json({
        success: false,
        error: errorMessage
      });
    }

    const responseText = await response.text();
    console.log('Response Text:', responseText);
    
    let data;
    try {
      data = JSON.parse(responseText);
      console.log('Parsed Response Data:', JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('Failed to parse response:', e);
      return res.status(500).json({
        success: false,
        error: `שגיאה בפענוח תגובת סאמיט: ${responseText}`
      });
    }

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
