$baseUrl = "http://localhost:4000"
$patientEmail = "testpatient3@test.com"
$patientPassword = "Test@1234"

Write-Host "Registering patient..." -ForegroundColor Yellow

$signupBody = @{
  email = $patientEmail
  firstName = "Test"
  lastName = "Patient"
  mobile = "9153300909"
  callingCode = "+1"
  countryCode = "US"
  password = $patientPassword
} | ConvertTo-Json

try {
  $signupResp = Invoke-RestMethod -Uri "$baseUrl/api/v1/auth/signup/patient" -Method POST -Headers @{"Content-Type" = "application/json"} -Body $signupBody
  $patientId = $signupResp.data.id
  $patientToken = $signupResp.data.accessToken
  Write-Host "Patient registered: $patientId" -ForegroundColor Green
} catch {
  Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

Write-Host "Logging in..." -ForegroundColor Yellow

$loginBody = @{
  emailOrMobile = $patientEmail
  password = $patientPassword
} | ConvertTo-Json

try {
  $loginResp = Invoke-RestMethod -Uri "$baseUrl/api/v1/auth/login" -Method POST -Headers @{"Content-Type" = "application/json"} -Body $loginBody
  $patientToken = $loginResp.data.accessToken
  Write-Host "Logged in successfully" -ForegroundColor Green
} catch {
  Write-Host "Login error: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

Write-Host "Sending consultation request..." -ForegroundColor Yellow

$consultBody = @{
  symptoms = "Severe headache and high fever"
} | ConvertTo-Json

try {
  $consultResp = Invoke-RestMethod -Uri "$baseUrl/api/v1/doctor/find-doctors" -Method POST -Headers @{"Content-Type" = "application/json"; "Authorization" = "Bearer $patientToken"} -Body $consultBody
  Write-Host "Consultation request sent successfully!" -ForegroundColor Green
  Write-Host ($consultResp | ConvertTo-Json -Depth 4)
} catch {
  Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

Write-Host "Check backend terminal for push notification logs" -ForegroundColor Cyan
