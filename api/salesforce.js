// Vercel Serverless Function for Salesforce API calls
// This keeps the TOKEN secure on the server side

export default async function handler(req, res) {
  // Enable CORS.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { action, data } = req.body;

    const API_BASE_URL = 'https://uh-rescuers-ea539e69b913.herokuapp.com/extapi/website';
    const TOKEN = process.env.SALESFORCE_TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbiI6IlUyRnNkR1ZrWDE5QkkwQVY0VmErS203UmExRGVrOHlzeFBRbFV2SmNjM2ZMU0U4amZGSEt2TmI1WDRmKzRwZklOK1BBTkJXcEJmTkNUKy8vUFVDRk55UVhrbHRWRmdOaGlLVHFyY2FoeXRrPSIsImlhdCI6MTc2ODM4MDQ0MCwiZXhwIjoxNzk5NDg0NDQwfQ.LVmuKHLx2Xp4b8OA4HYqYi01ydEsrd4jC6BW61hRi_U';

    let response;
    let endpoint;

    switch (action) {
      case 'registerMembers':
        endpoint = `${API_BASE_URL}/registerMembers`;
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${TOKEN}`
          },
          body: JSON.stringify(data)
        });
        break;

      case 'updateMemberStatus':
        endpoint = `${API_BASE_URL}/updateMemberStatus`;
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${TOKEN}`
          },
          body: JSON.stringify(data)
        });
        break;

      case 'addPayment':
        endpoint = `${API_BASE_URL}/addPayment`;
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${TOKEN}`
          },
          body: JSON.stringify(data)
        });
        break;

      case 'getMember':
        endpoint = `${API_BASE_URL}/getMember`;
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${TOKEN}`
          },
          body: JSON.stringify(data)
        });
        break;

      case 'numberOfMembers':
        endpoint = `${API_BASE_URL}/numberOfMembers`;
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${TOKEN}`
          },
          body: JSON.stringify(data)
        });
        break;

      case 'updateSumitCustomer': {
        // עדכון פרטי לקוח בסאמיט ללא תרומה
        const SUMIT_CUSTOMERS_URL = 'https://api.sumit.co.il/customers/update/';
        const sumitCompanyId = parseInt(process.env.SUMIT_COMPANY_ID, 10);
        const sumitApiKey = process.env.SUMIT_API_KEY;

        if (!sumitCompanyId || !sumitApiKey) {
          return res.status(500).json({ success: false, error: 'חסרים פרטי SUMIT API' });
        }

        const rawID = data.identityID ? String(data.identityID).trim() : null;
        const digitsOnly = rawID ? rawID.replace(/\D/g, '') : '';
        const cleanID = digitsOnly.length === 9
          ? digitsOnly.padStart(9, '0')
          : (rawID ? rawID.toUpperCase() : null);

        response = await fetch(SUMIT_CUSTOMERS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            Customer: {
              ExternalIdentifier: cleanID || null,
              SearchMode: cleanID ? 1 : 0,
              Name: data.fullName || null,
              Phone: data.phone || null,
              EmailAddress: data.email || null,
              Address: data.address || null,
            },
            Credentials: { CompanyID: sumitCompanyId, APIKey: sumitApiKey }
          })
        });
        break;
      }

      default:
        return res.status(400).json({ error: 'Invalid action' });
    }

    const responseText = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      responseData = responseText;
    }

    if (!response.ok) {
      return res.status(response.status).json({ 
        success: false, 
        error: responseData,
        status: response.status 
      });
    }

    return res.status(200).json({ 
      success: true, 
      data: responseData 
    });

  } catch (error) {
    console.error('Salesforce API error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error' 
    });
  }
}
