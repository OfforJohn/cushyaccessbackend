#!/usr/bin/env pwsh

# Configuration
$baseUrl = "http://localhost:4000"
$patientEmail = "testpatient2@test.com"
$patientPassword = "Test@1234"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Push Notification Test Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Step 1: Register patient
Write-Host "`n[1/4] Registering test patient..." -ForegroundColor Yellow

$signupBody = @{
  email = $patientEmail
  firstName = "Test"
  lastName = "Patient"
  mobile = "9153300908"
  callingCode = "+1"
  countryCode = "US"
  password = $patientPassword
} | ConvertTo-Json

try {
  $signupResp = Invoke-RestMethod -Uri "$baseUrl/api/v1/auth/signup/patient" `
    -Method POST `
    -Headers @{"Content-Type" = "application/json"} `
    -Body $signupBody -ErrorAction Stop
  
  $patientId = $signupResp.data.id
  $patientToken = $signupResp.data.accessToken
  Write-Host "✅ Patient registered: $patientId" -ForegroundColor Green
  
} catch {
  Write-Host "❌ Registration failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

# Step 2: Login to get fresh token
Write-Host "`n[2/4] Logging in patient..." -ForegroundColor Yellow

$loginBody = @{
  emailOrMobile = $patientEmail
  password = $patientPassword
} | ConvertTo-Json

try {
  $loginResp = Invoke-RestMethod -Uri "$baseUrl/api/v1/auth/login" `
    -Method POST `
    -Headers @{"Content-Type" = "application/json"} `
    -Body $loginBody -ErrorAction Stop
  
  $patientToken = $loginResp.data.accessToken
  Write-Host "✅ Logged in successfully" -ForegroundColor Green
  Write-Host "   Token: $($patientToken.Substring(0, 30))..." -ForegroundColor Gray
  
} catch {
  Write-Host "❌ Login failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

# Step 3: Send consultation request (triggers push notification)
Write-Host "`n[3/4] Sending consultation request..." -ForegroundColor Yellow
Write-Host "   This should trigger PushNotificationEvent" -ForegroundColor Gray

$consultBody = @{
  symptoms = "Severe headache and high fever"
} | ConvertTo-Json

try {
  $consultResp = Invoke-RestMethod -Uri "$baseUrl/api/v1/doctor/find-doctors" `
    -Method POST `
    -Headers @{
      "Content-Type" = "application/json"
      "Authorization" = "Bearer $patientToken"
    } `
    -Body $consultBody -ErrorAction Stop
  
  Write-Host "✅ Consultation request sent!" -ForegroundColor Green
  Write-Host "`nResponse:" -ForegroundColor Yellow
  $consultResp | ConvertTo-Json -Depth 4 | Write-Host -ForegroundColor Gray
  
} catch {
  Write-Host "❌ Consultation request failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

# Step 4: Instructions
Write-Host "`n[4/4] Next steps..." -ForegroundColor Yellow
Write-Host "`n📍 Check your backend terminal for these logs:" -ForegroundColor Cyan
Write-Host "   🔔 [PushNotificationEventHandler] Processing event" -ForegroundColor Gray
Write-Host "   🔍 [FCMTokenService] Querying tokens for userIds" -ForegroundColor Gray
Write-Host "   📤 [PushNotificationEventHandler] Sending push notification" -ForegroundColor Gray
Write-Host "   🚀 [Expo API] Sending message" -ForegroundColor Gray
Write-Host "   ✅ [Expo API] Response: 200" -ForegroundColor Gray

Write-Host "`n✨ Test completed! Watch for push notifications on the registered device." -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
