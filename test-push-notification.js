#!/usr/bin/env node

const http = require('http');

const baseUrl = "http://localhost:4000";

function makeAuthRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    if (token) {
      options.headers['cushy-access-key'] = 'Bearer ' + token;
    }

    if (body) {
      const bodyStr = JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: JSON.parse(data)
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            data: data
          });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTest() {
  console.log("=== Push Notification Test ===\n");

  try {
    // Step 1: Try logging in with existing patient or register with unique email
    const uniqueEmail = `testpatient${Date.now()}@test.com`;
    const uniqueMobile = `91533009${Math.random().toString().substring(2, 4)}`;
    console.log("[1/3] Registering patient with email:", uniqueEmail);
    const signupResp = await makeAuthRequest('POST', '/api/v1/auth/signup/customer', {
      email: uniqueEmail,
      firstName: "Test",
      lastName: "Patient",
      mobile: uniqueMobile,
      callingCode: "+1",
      countryCode: "US",
      password: "Test@1234"
    });

    console.log("  Status:", signupResp.status);
    console.log("  Response:", JSON.stringify(signupResp.data, null, 2));
    
    if (signupResp.status !== 201 && signupResp.status !== 200) {
      console.log("  ERROR: Registration failed");
      return;
    }

    const patientId = signupResp.data?.data?.user?.id;
    const patientToken = signupResp.data?.data?.access_token;
    
    if (!patientId || !patientToken) {
      console.log("  ERROR: Missing ID or token in response");
      console.log("  Full response:", signupResp);
      return;
    }
    
    console.log("  ✓ Patient registered:", patientId);
    console.log("  ✓ Token obtained:", patientToken.substring(0, 30) + "...");

    // Step 2: Send consultation request with authentication
    console.log("\n[2/3] Sending consultation request...");
    const consultResp = await makeAuthRequest('POST', '/api/v1/doctor/find-doctors', {
      symptoms: "Severe headache and high fever"
    }, patientToken);

    console.log("  ✓ Consultation request sent");
    console.log("  Response status:", consultResp.status);
    if (consultResp.status !== 200 && consultResp.status !== 201) {
      console.log("  ERROR - Response data:", JSON.stringify(consultResp.data, null, 2));
      console.log("\n  Check backend logs for detailed error information");
    } else {
      console.log("  ✓ Consultation request successful!");
    }

    // Step 3: Instructions
    console.log("\n[3/3] Next steps:");
    console.log("  📍 Check backend terminal for push notification logs:");
    console.log("    - 🔔 [PushNotificationEventHandler] Processing event");
    console.log("    - 🔍 [FCMTokenService] Querying tokens");
    console.log("    - 🚀 [Expo API] Sending message");

  } catch (error) {
    console.error("Error:", error.message);
  }
}

runTest();
