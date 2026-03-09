import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly webClient: cognito.UserPoolClient;
  public readonly cliClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Enforce @blanxlait.com email domain at sign-up time.
    // This trigger also runs for federated sign-ins (Google OIDC), providing
    // a consistent domain gate before and after federation is added.
    const preSignUpFn = new lambda.Function(this, "PreSignUpFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromInline(
        [
          "exports.handler = async (event) => {",
          "  const email = (event.request.userAttributes.email || '').toLowerCase();",
          "  if (!email.endsWith('@blanxlait.com')) {",
          "    throw new Error('Only @blanxlait.com accounts are permitted.');",
          "  }",
          "  return event;",
          "};",
        ].join("\n")
      ),
    });

    this.userPool = new cognito.UserPool(this, "BrainUserPool", {
      userPoolName: "enterprise-brain-users",
      // Self sign-up is disabled: accounts are admin-created or provisioned via Google federation.
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      customAttributes: {
        // Used for team-scoped thought sharing.
        // When Google federation is configured, map this from the OIDC group/team claim.
        team_id: new cognito.StringAttribute({ mutable: true }),
      },
      passwordPolicy: {
        minLength: 12,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lambdaTriggers: {
        preSignUp: preSignUpFn,
      },
    });

    // TODO: Add Google federation when ready.
    // 1. Create an OAuth 2.0 Client ID in Google Cloud Console
    //    (APIs & Services → Credentials → OAuth client ID → Web application).
    //    Set the authorized redirect URI to:
    //    https://<your-cognito-domain>.auth.<region>.amazoncognito.com/oauth2/idpresponse
    //
    // 2. Uncomment and fill in your Google client ID and secret:
    // const googleProvider = new cognito.UserPoolIdentityProviderGoogle(this, "Google", {
    //   userPool: this.userPool,
    //   clientId: "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
    //   clientSecretValue: cdk.SecretValue.secretsManager("openbrain/google-oauth-secret"),
    //   scopes: ["openid", "email", "profile"],
    //   attributeMapping: {
    //     email: cognito.ProviderAttribute.GOOGLE_EMAIL,
    //     fullname: cognito.ProviderAttribute.GOOGLE_NAME,
    //   },
    // });
    //
    // 3. Add hosted UI domain and update app clients' supportedIdentityProviders
    //    to include cognito.UserPoolClientIdentityProvider.GOOGLE.

    const readAttributes = new cognito.ClientAttributes()
      .withStandardAttributes({ email: true, emailVerified: true })
      .withCustomAttributes("team_id");

    // Web client (browser / future hosted UI)
    this.webClient = this.userPool.addClient("WebClient", {
      userPoolClientName: "brain-web",
      authFlows: {
        userSrp: true,
      },
      generateSecret: false,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      readAttributes,
    });

    // CLI client (Claude Code, curl, etc.) — longer token lifetime for dev use
    this.cliClient = this.userPool.addClient("CliClient", {
      userPoolClientName: "brain-cli",
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false,
      accessTokenValidity: cdk.Duration.hours(8),
      idTokenValidity: cdk.Duration.hours(8),
      refreshTokenValidity: cdk.Duration.days(90),
      readAttributes,
    });

    new cdk.CfnOutput(this, "UserPoolId", {
      value: this.userPool.userPoolId,
      exportName: "BrainUserPoolId",
    });
    new cdk.CfnOutput(this, "WebClientId", {
      value: this.webClient.userPoolClientId,
      exportName: "BrainWebClientId",
    });
    new cdk.CfnOutput(this, "CliClientId", {
      value: this.cliClient.userPoolClientId,
      exportName: "BrainCliClientId",
    });
  }
}
