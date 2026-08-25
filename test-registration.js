#!/usr/bin/env node

const http = require('http');

function makeRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, "http://localhost:4000");
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: JSON.parse(data),
            raw: data
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            data: data,
            raw: data
          });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test() {
  const email = `test${Date.now()}@example.com`;
  const randomPart = Math.floor(Math.random() * 10000000).toString().padStart(10, '0'); // 10-digit random
  console.log("Testing registration with email:", email);
  console.log("Testing registration with mobile:", randomPart);
  console.log("Body:", JSON.stringify({
    email: email,
    firstName: "Test",
    lastName: "User",
    mobile: randomPart,
    callingCode: "+1",
    countryCode: "US",
    password: "Test@1234"
  }, null, 2));

  try {
    const response = await makeRequest('POST', '/api/v1/auth/signup/customer', {
      email: email,
      firstName: "Test",
      lastName: "User",
      mobile: randomPart,
      callingCode: "+1",
      countryCode: "US",
      password: "Test@1234"
    });

    console.log("\nResponse Status:", response.status);
    console.log("Response Data:", JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error("Error:", error.message);
  }
}

test();
