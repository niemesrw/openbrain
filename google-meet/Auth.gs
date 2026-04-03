/**
 * Cognito authentication for AWS Enterprise Open Brain.
 * Uses USER_PASSWORD_AUTH flow against the CLI Cognito client.
 * Caches tokens in Script Properties until expiry.
 */

var AUTH_CACHE_KEY = 'COGNITO_CACHED_TOKEN';
var AUTH_CACHE_EXPIRY_KEY = 'COGNITO_TOKEN_EXPIRY';

/**
 * Get a valid Cognito access token, refreshing if expired.
 * @return {string} JWT access token
 */
function getAccessToken() {
  var props = PropertiesService.getScriptProperties();
  var cached = props.getProperty(AUTH_CACHE_KEY);
  var expiry = props.getProperty(AUTH_CACHE_EXPIRY_KEY);

  if (cached && expiry && Date.now() < parseInt(expiry, 10)) {
    return cached;
  }

  var token = authenticateWithCognito_();
  return token;
}

/**
 * Call Cognito InitiateAuth and cache the result.
 * @return {string} JWT ID token
 * @private
 */
function authenticateWithCognito_() {
  var props = PropertiesService.getScriptProperties();
  var region = props.getProperty('COGNITO_USER_POOL_ID').split('_')[0];
  var endpoint = 'https://cognito-idp.' + region + '.amazonaws.com/';

  var payload = {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: props.getProperty('COGNITO_CLIENT_ID'),
    AuthParameters: {
      USERNAME: props.getProperty('COGNITO_USERNAME'),
      PASSWORD: props.getProperty('COGNITO_PASSWORD')
    }
  };

  var response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/x-amz-json-1.1',
    headers: {
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  if (code !== 200) {
    throw new Error('Cognito auth failed (' + code + '): ' + response.getContentText());
  }

  var result = JSON.parse(response.getContentText());
  var idToken = result.AuthenticationResult.IdToken;
  var expiresIn = result.AuthenticationResult.ExpiresIn || 3600;

  // Cache with 5-minute buffer before actual expiry
  var expiryMs = Date.now() + (expiresIn - 300) * 1000;
  props.setProperty(AUTH_CACHE_KEY, idToken);
  props.setProperty(AUTH_CACHE_EXPIRY_KEY, String(expiryMs));

  return idToken;
}
