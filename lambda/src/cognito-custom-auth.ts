/**
 * Cognito Custom Auth Challenge Lambda triggers.
 *
 * Used by the native Apple sign-in flow to issue Cognito tokens without
 * mutating the user's password. The server generates a random nonce,
 * passes it via ClientMetadata, and responds to the challenge with it.
 *
 * Security: only the Lambda role can call AdminInitiateAuth with CUSTOM_AUTH,
 * and the nonce is random per-request and never exposed to end users.
 *
 * These triggers fire for ALL auth flows on the user pool, so they must
 * handle SRP flows correctly by passing them through.
 */

// --- Define Auth Challenge ---

export const defineAuthChallenge = async (event: any): Promise<any> => {
  const session = event.request.session;

  if (session.length === 0) {
    // First round — issue a custom challenge
    event.response.issueTokens = false;
    event.response.failAuthentication = false;
    event.response.challengeName = "CUSTOM_CHALLENGE";
  } else {
    const last = session[session.length - 1];
    if (last.challengeName === "CUSTOM_CHALLENGE" && last.challengeResult) {
      // Challenge answered correctly — issue tokens
      event.response.issueTokens = true;
      event.response.failAuthentication = false;
    } else {
      // Challenge failed
      event.response.issueTokens = false;
      event.response.failAuthentication = true;
    }
  }

  return event;
};

// --- Create Auth Challenge ---

export const createAuthChallenge = async (event: any): Promise<any> => {
  if (event.request.challengeName === "CUSTOM_CHALLENGE") {
    // Store the server-generated nonce as the expected answer
    const nonce = event.request.clientMetadata?.nonce ?? "";
    event.response.publicChallengeParameters = {};
    event.response.privateChallengeParameters = { answer: nonce };
  }
  return event;
};

// --- Verify Auth Challenge ---

export const verifyAuthChallenge = async (event: any): Promise<any> => {
  const expected = event.request.privateChallengeParameters?.answer;
  const provided = event.request.challengeAnswer;
  event.response.answerCorrect = !!expected && expected === provided;
  return event;
};
