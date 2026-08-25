# Complete test for push notification system (PS 5.1 compatible)
Write-Host "Starting push notification test..." -ForegroundColor Cyan

# Test 1: Create patient
$random = Get-Random
$patientEmail = "patient$random@test.com"
Write-Host "`nCreating patient account: $patientEmail" -ForegroundColor Yellow

$signupBody = @{
  firstName = "Test"
  lastName = "Patient"  
  email = $patientEmail
  password = "Test@12345"
} | ConvertTo-Json

try {
  $signupResp = Invoke-WebRequest -Uri "http://localhost:4000/api/v1/auth/signup/patient" `
    -Method POST `
    -Headers @{"Content-Type" = "application/json"} `
    -Body $signupBody `
    -UseBasicParsing
} catch {
  $signupResp = $_.Exception.Response
}

Write-Host "Signup Status: $($signupResp.StatusCode)"
if ($signupResp.StatusCode -ne 200 -and $signupResp.StatusCode -ne 201) {
  Write-Host "ERROR: $($_.Exception.Response.StatusCode)"
  exit 1
}

# Test 2: Login
Write-Host "`nLogging in patient..." -ForegroundColor Yellow

$loginBody = @{
  email = $patientEmail
  password = "Test@12345"
} | ConvertTo-Json

try {
  $loginResp = Invoke-WebRequest -Uri "http://localhost:4000/api/v1/auth/login" `
    -Method POST `
    -Headers @{"Content-Type" = "application/json"} `
    -Body $loginBody `
    -UseBasicParsing
  
  $loginData = $loginResp.Content | ConvertFrom-Json
  $token = $loginData.data.access_token
  $patientId = $loginData.data.user.id
  Write-Host "Login Status: $($loginResp.StatusCode)"
  Write-Host "Logged in as: $patientId"
} catch {
  Write-Host "ERROR: Login failed - $($_.Exception.Message)"
  exit 1
}

# Test 3: Request consultation
Write-Host "`nSending consultation request..." -ForegroundColor Yellow

$consultBody = @{
  symptoms = "Severe headache and fever"
} | ConvertTo-Json

try {
  $consultResp = Invoke-WebRequest -Uri "http://localhost:4000/api/v1/doctor/find-doctor" `
    -Method POST `
    -Headers @{
      "Authorization" = "Bearer $token"
      "Content-Type" = "application/json"
    } `
    -Body $consultBody `
    -UseBasicParsing
  
  Write-Host "Consultation Status: $($consultResp.StatusCode)"
  if ($consultResp.StatusCode -eq 200) {
    Write-Host "✅ Consultation request sent!"
  }
} catch {
  Write-Host "ERROR: Consultation request failed - $($_.Exception.Message)"
}

Write-Host "`nWaiting 3 seconds for backend logs..." -ForegroundColor Cyan
Start-Sleep -Seconds 3

Write-Host "`n✅ Test complete! Check backend terminal for push notification logs" -ForegroundColor Green
