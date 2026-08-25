$email = "test$(Get-Random)@example.com"
$body = @{
  email = $email
  firstName = "Test"
  lastName = "User"  
  mobile = "1234567890"
  callingCode = "+1"
  countryCode = "US"
  password = "Test@1234"
} | ConvertTo-Json

Write-Host "Testing registration with email: $email" -ForegroundColor Cyan

try {
  $response = Invoke-WebRequest -Uri "http://localhost:4000/api/v1/auth/signup/customer" `
    -Method POST `
    -Headers @{"Content-Type" = "application/json"} `
    -Body $body `
    -ErrorAction Stop
  Write-Host "✓ Success! Status: $($response.StatusCode)" -ForegroundColor Green
  $response.Content | ConvertFrom-Json | ConvertTo-Json
} catch {
  Write-Host "✗ Error: $($_.Exception.Response.StatusCode)" -ForegroundColor Red
  try {
    $errorResponse = $_.Exception.Response.GetResponseStream() | ForEach-Object { [System.IO.StreamReader]$_ } | ForEach-Object { $_.ReadToEnd() }
    Write-Host "Error details: $errorResponse"
  } catch {
    Write-Host "Could not read error response"
  }
}
